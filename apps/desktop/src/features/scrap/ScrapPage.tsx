import { translate } from "../../i18n/i18n";
import { errorMessage } from "../../i18n/error-message";
import type { ScrapComment, ScrapCommentFile, ScrapItem, ScrapKind, ScrapSnapshot, ScrapWriteInput } from "@mono/contracts";
import { formatByteSize, formatTimestamp } from "@mono/domain";
import { Button, Drawer, Icon, IconButton, Input, Modal, Select, TextArea, type IconName } from "@mono/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router";
import { externalUrlOf, PlatformExternalUrlOpener, type ExternalUrlOpener } from "../../infrastructure/external-url-opener";
import { httpGetBlob, isConflictError } from "../../infrastructure/http/http-client";
import { resyncConflictVersion } from "../../infrastructure/http/conflict-recovery";
import { useMedia, useMediaStore } from "../../infrastructure/media/media-store-context";
import { newMediaId } from "../../infrastructure/media/media-store";
import { saveObjectUrlToDisk } from "../../infrastructure/media/save-file";
import { scrapQueryKey, type ScrapRepository } from "./scrap-repository";
import { loadSortKey, sortItems, sortKeys, sortLabels, sortStorageKey, type SortKey } from "./scrap-sort";
import { scrapViewStateStoreOf, type ScrapViewStateStore } from "./scrap-view-state-store";
import { ScrapTagManager } from "./ScrapTagManager";

export { scrapQueryKey };

const kindMeta: Record<ScrapKind, { icon: IconName; label: string }> = {
  image: { icon: "image", label: translate("scrap.kind.image") },
  url: { icon: "layers", label: translate("scrap.kind.linkPreview") },
  text: { icon: "note", label: translate("common.field.note") },
  video: { icon: "video", label: translate("scrap.kind.video") },
  file: { icon: "file", label: translate("scrap.kind.file") },
};

type Draft = ScrapWriteInput;
// previewUrl is only filled in for images. If it's not an image, it's null and rendered as a file chip.
type PendingPhoto = { file: File; previewUrl: string | null };

const blankDraft: Draft = { title: "", memo: "", url: "", tag: translate("scrap.label.inbox") };
const maxPhotoBytes = 10 * 1024 * 1024;
const maxScrapFileBytes = 50 * 1024 * 1024;
const maxCommentFileBytes = 50 * 1024 * 1024;
const photoPickerDomId = "scrap-photo-picker";
const photoReplaceDomId = "scrap-photo-replace";
const externalUrlOpener = PlatformExternalUrlOpener.of();
const commentUrlPattern = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;
const trailingUrlPunctuationPattern = /[),.!?;:\]}]+$/u;
const commentStrikePattern = /~~(.+?)~~/g;

type CommentTextSegment = { text: string; externalUrl: string | null; strike?: boolean };

// Splits ~~strikethrough~~ markdown into segments. Doesn't touch the inside of URL segments.
function splitCommentStrike(text: string): CommentTextSegment[] {
  const segments: CommentTextSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(commentStrikePattern)) {
    if (match.index > cursor) segments.push({ text: text.slice(cursor, match.index), externalUrl: null });
    segments.push({ text: match[1], externalUrl: null, strike: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), externalUrl: null });
  return segments;
}

function commentTextSegmentsOf(text: string): CommentTextSegment[] {
  const segments: CommentTextSegment[] = [];
  let cursor = 0;

  for (const match of text.matchAll(commentUrlPattern)) {
    const index = match.index;
    const candidate = match[0];
    const linkText = candidate.replace(trailingUrlPunctuationPattern, "");
    const trailingText = candidate.slice(linkText.length);
    const externalUrl = externalUrlOf(linkText);

    if (index > cursor) segments.push({ text: text.slice(cursor, index), externalUrl: null });
    if (externalUrl) segments.push({ text: linkText, externalUrl });
    else segments.push({ text: candidate, externalUrl: null });
    if (externalUrl && trailingText) segments.push({ text: trailingText, externalUrl: null });
    cursor = index + candidate.length;
  }

  if (cursor < text.length) segments.push({ text: text.slice(cursor), externalUrl: null });
  const linked = segments.length > 0 ? segments : [{ text, externalUrl: null }];
  return linked.flatMap((segment) => segment.externalUrl ? [segment] : splitCommentStrike(segment.text));
}

function submitFormOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}

function photoTitle(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").trim() || translate("common.media.photo");
}

function isImageName(name: string) {
  return /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(name);
}

// Pulls the first file out of dataTransfer / clipboard.
function firstFileFrom(list: FileList | null | undefined, items?: DataTransferItemList): File | null {
  if (list && list.length > 0) return list[0];
  for (let index = 0; index < (items?.length ?? 0); index += 1) {
    const file = items?.[index]?.kind === "file" ? items[index].getAsFile() : null;
    if (file) return file;
  }
  return null;
}

export function ScrapPage({ repository, urlOpener = externalUrlOpener, viewStateStore }: { repository: ScrapRepository; urlOpener?: ExternalUrlOpener; viewStateStore?: ScrapViewStateStore }) {
  const [store] = useState(() => viewStateStore ?? scrapViewStateStoreOf());
  const [viewState, setViewState] = useState(() => store.read());
  const { activeTag } = viewState;
  const [sortKey, setSortKey] = useState<SortKey>(loadSortKey);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [commentFile, setCommentFile] = useState<File | null>(null);
  const [commentPreviewUrl, setCommentPreviewUrl] = useState<string | null>(null);
  const [commentDragging, setCommentDragging] = useState(false);
  const [commentBusyId, setCommentBusyId] = useState<string | null>(null);
  const [commentErrors, setCommentErrors] = useState<Record<string, string>>({});
  const commentFileInputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [pendingPhoto, setPendingPhoto] = useState<PendingPhoto | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const handledModalRef = useRef(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const photoPreviewUrlRef = useRef<string | null>(null);
  // Even if the pendingPhoto state is lost between renders (a WKWebView file-dialog quirk), on save
  // the selected file itself is held separately in a ref so the photo isn't lost. The preview is rendered from state alone.
  const photoFileRef = useRef<File | null>(null);
  const tagRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const queryClient = useQueryClient();
  const mediaStore = useMediaStore();
  const snapshotQuery = useQuery({ queryKey: scrapQueryKey, queryFn: () => repository.getSnapshot() });

  const invalidateSnapshots = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: scrapQueryKey }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
  };

  const createMutation = useMutation({
    mutationFn: async ({ input, photo }: { input: ScrapWriteInput; photo: File | null }) => {
      if (!photo) return repository.create(input);
      const mediaId = newMediaId();
      await mediaStore.save(mediaId, photo);
      const fileMeta = photo.type.startsWith("image/") ? {} : { fileName: photo.name, fileSize: photo.size };
      try {
        await repository.create({ ...input, mediaId, ...fileMeta });
      } catch (error) {
        try { await mediaStore.delete(mediaId); } catch { /* 고아 미디어 GC가 후속 정리한다. */ }
        throw error;
      }
    },
    onMutate: () => setFormError(null),
    onSuccess: async () => {
      await invalidateSnapshots();
      closeCreate(true);
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (scrapId: string) => repository.delete(scrapId),
    onMutate: () => setDeleteError(null),
    onSuccess: async () => {
      await invalidateSnapshots();
      setConfirmDeleteId(null);
      setDetailId(null);
      setCommentText("");
      setCommentFile(null);
      if (searchParams.has("detail")) setSearchParams({}, { replace: true });
    },
    onError: (error) => setDeleteError(errorMessage(error)),
  });

  // Only handles draft setup for the case of opening via URL (deep link, AppShell's "+ Add scrap").
  // handledModalRef is managed by openCreate/closeCreate, so even if a file-dialog focus event
  // briefly perturbs searchParams, this effect won't reset the draft/photo being composed.
  useEffect(() => {
    if (searchParams.get("modal") !== "new" || handledModalRef.current || !snapshotQuery.data) return;
    handledModalRef.current = true;
    replacePhoto();
    setDraft({ ...blankDraft, tag: snapshotQuery.data.tags.includes(translate("scrap.label.inbox")) ? translate("scrap.label.inbox") : snapshotQuery.data.tags[0] ?? translate("scrap.label.inbox") });
    setFormError(null);
  }, [searchParams, snapshotQuery.data]);

  useEffect(() => () => {
    if (photoPreviewUrlRef.current) URL.revokeObjectURL(photoPreviewUrlRef.current);
  }, []);

  // If the attachment is an image, creates a preview object URL and revokes it when the attachment changes or is removed.
  useEffect(() => {
    if (!commentFile || !commentFile.type.startsWith("image/")) {
      setCommentPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(commentFile);
    setCommentPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [commentFile]);

  useEffect(() => {
    const requestedId = searchParams.get("detail");
    if (requestedId && snapshotQuery.data?.items.some((item) => item.id === requestedId)) setDetailId(requestedId);
  }, [searchParams, snapshotQuery.data]);

  if (snapshotQuery.isPending) return <ScrapLoading />;
  if (snapshotQuery.isError) return <div className="scrap-state" role="alert"><Icon name="alert" size={18} />{translate("scrap.error.load")}</div>;

  const snapshot = snapshotQuery.data;
  const detail = snapshot.items.find((item) => item.id === detailId) ?? null;
  const visibleItems = sortItems(activeTag ? snapshot.items.filter((item) => item.tag === activeTag) : snapshot.items, sortKey);
  const createOpen = searchParams.get("modal") === "new";

  function changeSort(next: string) {
    setSortKey(next as SortKey);
    try { localStorage.setItem(sortStorageKey, next); } catch { /* 저장 실패는 무시 — 세션 내에서는 유지된다 */ }
  }

  function openCreate() {
    handledModalRef.current = true;
    replacePhoto();
    setDraft({ ...blankDraft, tag: snapshot.tags.includes(translate("scrap.label.inbox")) ? translate("scrap.label.inbox") : snapshot.tags[0] ?? translate("scrap.label.inbox") });
    setFormError(null);
    setTagManagerOpen(false);
    setSearchParams({ modal: "new" }, { replace: true });
  }

  function closeCreate(force = false) {
    if (createMutation.isPending && !force) return;
    handledModalRef.current = false;
    replacePhoto();
    setFormError(null);
    setTagManagerOpen(false);
    if (searchParams.has("modal")) setSearchParams({}, { replace: true });
  }

  function submitCreate(event: FormEvent) {
    event.preventDefault();
    const input = { ...draft, title: draft.title.trim(), memo: draft.memo.trim(), url: draft.url.trim() };
    if (!input.title) { setFormError(translate("common.validation.titleRequired")); return; }
    if (!input.tag) { setFormError(translate("common.validation.labelRequired")); return; }
    createMutation.mutate({ input, photo: photoFileRef.current ?? pendingPhoto?.file ?? null });
  }

  function replacePhoto(next: PendingPhoto | null = null) {
    if (photoPreviewUrlRef.current) URL.revokeObjectURL(photoPreviewUrlRef.current);
    photoPreviewUrlRef.current = next?.previewUrl ?? null;
    photoFileRef.current = next?.file ?? null;
    setPendingPhoto(next);
    if (photoInputRef.current) photoInputRef.current.value = "";
  }

  function choosePhoto(file: File | undefined) {
    if (!file) return;
    const isImage = file.type.startsWith("image/");
    if (file.size === 0) {
      setFormError(translate("scrap.photo.readFailed"));
      return;
    }
    if (file.size > (isImage ? maxPhotoBytes : maxScrapFileBytes)) {
      setFormError(translate(isImage ? "scrap.photo.tooLarge" : "scrap.file.tooLarge"));
      return;
    }
    replacePhoto({ file, previewUrl: isImage ? URL.createObjectURL(file) : null });
    setDraft((current) => current.title.trim() ? current : { ...current, title: photoTitle(file.name) });
    setFormError(null);
    requestAnimationFrame(() => document.getElementById(photoReplaceDomId)?.focus());
  }

  function removePhoto() {
    replacePhoto();
    requestAnimationFrame(() => document.getElementById(photoPickerDomId)?.focus());
  }

  function chooseCommentFile(file: File | null | undefined) {
    if (commentFileInputRef.current) commentFileInputRef.current.value = "";
    if (!file) return;
    if (file.size === 0) { setCommentErrors((current) => detail ? { ...current, [detail.id]: translate("scrap.photo.readFailed") } : current); return; }
    if (file.size > maxCommentFileBytes) { setCommentErrors((current) => detail ? { ...current, [detail.id]: translate("scrap.comment.fileTooLarge") } : current); return; }
    setCommentFile(file);
    if (detail) setCommentErrors((current) => ({ ...current, [detail.id]: "" }));
  }

  async function submitComment(event: FormEvent) {
    event.preventDefault();
    if (!detail) return;
    const text = commentText.trim();
    if (!text && !commentFile) return;
    const scrapId = detail.id;
    setCommentBusyId(scrapId);
    setCommentErrors((current) => ({ ...current, [scrapId]: "" }));
    let stagedMediaId: string | null = null;
    try {
      let file: ScrapCommentFile | undefined;
      if (commentFile) {
        stagedMediaId = newMediaId();
        await mediaStore.save(stagedMediaId, commentFile);
        file = { mediaId: stagedMediaId, name: commentFile.name, size: commentFile.size };
      }
      await repository.addComment(scrapId, { text, file });
      await invalidateSnapshots();
      setCommentText("");
      setCommentFile(null);
    } catch (error) {
      if (stagedMediaId) { try { await mediaStore.delete(stagedMediaId); } catch { /* 고아 미디어 GC가 후속 정리한다. */ } }
      setCommentErrors((current) => ({ ...current, [scrapId]: errorMessage(error) }));
    } finally {
      setCommentBusyId((current) => current === scrapId ? null : current);
    }
  }

  function onTagKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % snapshot.tags.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + snapshot.tags.length) % snapshot.tags.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = snapshot.tags.length - 1;
    else return;
    event.preventDefault();
    tagRefs.current[next]?.focus();
  }

  function changeActiveTag(next: string | null | ((current: string | null) => string | null)) {
    setViewState((current) => {
      const activeTag = typeof next === "function" ? next(current.activeTag) : next;
      const nextState = { activeTag };
      store.write(nextState);
      return nextState;
    });
  }

  return (
    <div className="scrap-page">
      <div className="scrap-toolbar">
        <div aria-label={translate("scrap.filter.label")} className="scrap-tags" role="toolbar">
          {snapshot.tags.map((tag, index) => (
            <button
              aria-pressed={activeTag === tag}
              className={activeTag === tag ? "scrap-tag scrap-tag--active" : "scrap-tag"}
              key={tag}
              onClick={() => changeActiveTag((current) => current === tag ? null : tag)}
              onKeyDown={(event) => onTagKeyDown(event, index)}
              ref={(element) => { tagRefs.current[index] = element; }}
              type="button"
            >{tag}</button>
          ))}
        </div>
        {snapshot.items.length > 0 && (
          <div className="scrap-sort">
            <Select
              align="end"
              label={translate("scrap.sort.label")}
              onChange={changeSort}
              options={sortKeys.map((key) => ({ value: key, label: sortLabels[key] }))}
              value={sortKey}
            />
          </div>
        )}
      </div>

      {snapshot.items.length === 0 ? <ScrapEmpty onCreate={openCreate} /> : visibleItems.length === 0 ? <ScrapFilterEmpty onReset={() => changeActiveTag(null)} /> : (
        <div className="scrap-list">
          {visibleItems.map((item) => <ScrapCard item={item} key={item.id} onOpen={() => { setDetailId(item.id); setCommentText(""); setCommentFile(null); setSearchParams({ detail: item.id }, { replace: true }); }} />)}
        </div>
      )}

      <Drawer
        className="scrap-detail-drawer"
        footer={detail ? <form
          className={commentDragging ? "scrap-comment-form scrap-comment-form--dragging" : "scrap-comment-form"}
          onDragOver={(event: DragEvent<HTMLFormElement>) => { if (commentBusyId !== detail.id && event.dataTransfer.types.includes("Files")) { event.preventDefault(); setCommentDragging(true); } }}
          onDragLeave={(event: DragEvent<HTMLFormElement>) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setCommentDragging(false); }}
          onDrop={(event: DragEvent<HTMLFormElement>) => { event.preventDefault(); setCommentDragging(false); if (commentBusyId !== detail.id) chooseCommentFile(firstFileFrom(event.dataTransfer.files, event.dataTransfer.items)); }}
          onSubmit={submitComment}
        >
          <input aria-label={translate("scrap.comment.filePicker")} className="capture-file-input" disabled={commentBusyId === detail.id} onChange={(event) => chooseCommentFile(event.currentTarget.files?.[0])} ref={commentFileInputRef} tabIndex={-1} type="file" />
          {commentFile && (
            <div className="scrap-comment-form__file">
              {commentPreviewUrl
                ? <img alt={translate("scrap.comment.imagePreview")} className="scrap-comment-form__thumb" src={commentPreviewUrl} />
                : <Icon name="file" size={13} strokeWidth={1.5} />}
              <span title={commentFile.name}>{commentFile.name}</span>
              <IconButton aria-label={translate("scrap.comment.fileRemove")} disabled={commentBusyId === detail.id} onClick={() => setCommentFile(null)} size="small" title={translate("scrap.comment.fileRemove")} type="button" variant="ghost"><Icon name="close" size={12} /></IconButton>
            </div>
          )}
          <div className="scrap-comment-form__row">
            <TextArea aria-label={translate("scrap.comment.new")} disabled={commentBusyId === detail.id} maxLength={2_000} onChange={(event) => setCommentText(event.target.value)} onKeyDown={submitFormOnEnter} onPaste={(event: ClipboardEvent<HTMLTextAreaElement>) => { const file = firstFileFrom(event.clipboardData.files, event.clipboardData.items); if (file) { event.preventDefault(); chooseCommentFile(file); } }} placeholder={translate("scrap.comment.placeholder")} rows={1} value={commentText} />
            <IconButton aria-label={translate("scrap.comment.fileAttach")} disabled={commentBusyId === detail.id} onClick={() => commentFileInputRef.current?.click()} size="small" title={translate("scrap.comment.fileAttach")} type="button" variant="ghost"><Icon name="file" size={15} strokeWidth={1.5} /></IconButton>
            <Button aria-label={translate("scrap.comment.title")} loading={commentBusyId === detail.id} title={translate("scrap.comment.submit")} type="submit" variant="primary">{commentBusyId !== detail.id && <Icon name="send" size={14} strokeWidth={1.8} />}</Button>
          </div>
          {commentErrors[detail.id] && <span className="scrap-comment-error" role="alert">{commentErrors[detail.id]}</span>}
          {commentDragging && <div className="scrap-comment-form__drop" aria-hidden="true"><Icon name="download" size={16} />{translate("scrap.comment.dropHint")}</div>}
        </form> : undefined}
        icon="scrap"
        onClose={() => { if (!commentBusyId) { setDetailId(null); setCommentText(""); setCommentFile(null); setCommentDragging(false); if (searchParams.has("detail")) setSearchParams({}, { replace: true }); } }}
        open={detail !== null}
        title={<span className="scrap-detail-title">{translate("app.navigation.scrap")}{detail && <small>{formatTimestamp(detail.savedAt)}</small>}</span>}
      >
        {detail && <ScrapDetail item={detail} onManageTags={() => setTagManagerOpen(true)} onRequestDelete={() => { setDeleteError(null); setConfirmDeleteId(detail.id); }} repository={repository} tags={snapshot.tags} urlOpener={urlOpener} />}
      </Drawer>

      <Modal
        className="scrap-delete-modal"
        footer={<><Button disabled={deleteMutation.isPending} onClick={() => setConfirmDeleteId(null)}>{translate("common.action.cancel")}</Button><Button loading={deleteMutation.isPending} onClick={() => confirmDeleteId && deleteMutation.mutate(confirmDeleteId)} variant="danger">{translate("common.action.delete")}</Button></>}
        icon="alert"
        onClose={() => { if (!deleteMutation.isPending) setConfirmDeleteId(null); }}
        open={confirmDeleteId !== null}
        title={translate("scrap.delete.title")}
      >
        <p>{translate("scrap.delete.confirm", { title: snapshot.items.find((item) => item.id === confirmDeleteId)?.title ?? "" })}</p>
        {deleteError && <div className="scrap-mutation-error" role="alert"><Icon name="alert" size={13} />{deleteError}</div>}
      </Modal>

      <Modal
        className="scrap-create-modal"
        footer={<><Button disabled={createMutation.isPending} onClick={() => closeCreate()}>{translate("common.action.cancel")}</Button><Button form="scrap-create-form" loading={createMutation.isPending} type="submit" variant="primary">{translate("common.action.save")}</Button></>}
        icon="scrap"
        onClose={closeCreate}
        open={createOpen}
        title={translate("app.action.newScrap")}
      >
        <form aria-busy={createMutation.isPending} className="scrap-create-form" id="scrap-create-form" onSubmit={submitCreate}>
          <label><span>{translate("common.field.title")}</span><Input autoFocus maxLength={500} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder={translate("scrap.editor.titlePlaceholder")} value={draft.title} /></label>
          <label><span>{translate("common.field.note")}</span><TextArea maxLength={4_000} onChange={(event) => setDraft((current) => ({ ...current, memo: event.target.value }))} placeholder={translate("common.field.notePlaceholder")} rows={3} value={draft.memo} /></label>
          <label><span>{translate("scrap.field.optionalLink")}</span><Input maxLength={2_000} onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))} placeholder="https://…" value={draft.url} /></label>
          <div className="scrap-create-form__photo-field">
            <span className="scrap-create-form__photo-legend">{translate("scrap.field.optionalPhoto")}</span>
            <input
              aria-label={translate("scrap.photo.filePicker")}
              className="capture-file-input"
              disabled={createMutation.isPending}
              onChange={(event) => choosePhoto(event.currentTarget.files?.[0])}
              ref={photoInputRef}
              tabIndex={-1}
              type="file"
            />
            {pendingPhoto ? (
              <div className="scrap-photo-preview">
                {pendingPhoto.previewUrl
                  ? <img alt={translate("scrap.photo.previewLabel", { name: pendingPhoto.file.name })} src={pendingPhoto.previewUrl} />
                  : <i className="scrap-photo-preview__file"><Icon name="file" size={19} strokeWidth={1.5} /></i>}
                <span><strong title={pendingPhoto.file.name}>{pendingPhoto.file.name}</strong><small>{formatByteSize(pendingPhoto.file.size)}</small></span>
                <Button disabled={createMutation.isPending} id={photoReplaceDomId} onClick={() => photoInputRef.current?.click()} size="small" type="button" variant="ghost">{translate("common.action.replace")}</Button>
                <IconButton aria-label={translate("scrap.photo.removeLabel", { name: pendingPhoto.file.name })} disabled={createMutation.isPending} onClick={removePhoto} size="small" title={translate("scrap.photo.remove")} type="button" variant="ghost"><Icon name="close" size={13} /></IconButton>
              </div>
            ) : (
              <button className="scrap-photo-picker" disabled={createMutation.isPending} id={photoPickerDomId} onClick={() => photoInputRef.current?.click()} type="button">
                <Icon name="file" size={17} strokeWidth={1.5} />
                <span><strong>{translate("scrap.photo.select")}</strong><small>{translate("scrap.photo.requirements")}</small></span>
              </button>
            )}
          </div>
          <div className="scrap-create-form__label-field">
            <div className="scrap-create-form__label-legend"><span>{translate("common.field.label")}</span><button disabled={createMutation.isPending} onClick={() => setTagManagerOpen(true)} type="button">{translate("common.action.manage")}</button></div>
            <Select disabled={createMutation.isPending} label={translate("common.field.label")} onChange={(tag) => setDraft((current) => ({ ...current, tag }))} options={snapshot.tags.map((tag) => ({ value: tag, label: tag }))} value={draft.tag} />
          </div>
          {formError && <div className="scrap-mutation-error" role="alert"><Icon name="alert" size={13} />{formError}</div>}
        </form>
      </Modal>

      <ScrapTagManager
        onClose={() => setTagManagerOpen(false)}
        onTagAdded={(tag) => setDraft((current) => ({ ...current, tag }))}
        onTagDeleted={(from, replacement) => {
          changeActiveTag((current) => current === from ? null : current);
          setDraft((current) => current.tag === from ? { ...current, tag: replacement } : current);
        }}
        onTagRenamed={(from, to) => {
          changeActiveTag((current) => current === from ? to : current);
          setDraft((current) => current.tag === from ? { ...current, tag: to } : current);
        }}
        open={tagManagerOpen}
        repository={repository}
        snapshot={snapshot}
      />
    </div>
  );
}

// The link preview image must also load from an authenticated remote server, so instead of <img src>
// it's fetched with the token header attached and turned into an object URL (the same approach as media images).
function useLinkPreviewImage(externalUrl: string | null) {
  return useQuery({
    queryKey: ["link-preview", externalUrl],
    queryFn: async () => {
      try {
        const blob = await httpGetBlob(`/link-previews/image?url=${encodeURIComponent(externalUrl as string)}`);
        return blob ? URL.createObjectURL(blob) : null;
      } catch {
        return null;
      }
    },
    enabled: Boolean(externalUrl),
    staleTime: Infinity,
    retry: false,
  });
}

function ScrapMediaPreview({ item, meta, iconSize }: { item: ScrapItem; meta: { icon: IconName; label: string }; iconSize: number }) {
  const { data: mediaSrc } = useMedia(item.kind === "image" ? item.mediaId : null);
  const externalUrl = item.kind === "url" && item.url ? externalUrlOf(item.url) : null;
  const { data: previewSrc } = useLinkPreviewImage(externalUrl);
  const src = mediaSrc ?? previewSrc;
  if (src) return <img alt={item.kind === "image" ? item.title : ""} decoding="async" loading="lazy" src={src} />;
  return <><Icon name={meta.icon} size={iconSize} strokeWidth={1.4} /><span>{item.kind === "file" ? (item.fileName ?? meta.label) : meta.label}</span></>;
}

function CommentContent({ text, urlOpener }: { text: string; urlOpener: ExternalUrlOpener }) {
  const segments = commentTextSegmentsOf(text);
  const previewUrl = segments.find((segment) => segment.externalUrl)?.externalUrl ?? null;

  function openExternalUrl(event: MouseEvent<HTMLAnchorElement>, externalUrl: string) {
    event.preventDefault();
    void urlOpener.open(externalUrl);
  }

  return <><p className="scrap-comment__text">{segments.map((segment, index) => segment.externalUrl ? <a href={segment.externalUrl} key={`${index}-${segment.text}`} onClick={(event) => openExternalUrl(event, segment.externalUrl as string)} rel="noreferrer" target="_blank">{segment.text}</a> : segment.strike ? <s key={`${index}-${segment.text}`}>{segment.text}</s> : segment.text)}</p>{previewUrl && <CommentLinkPreview externalUrl={previewUrl} onOpen={openExternalUrl} />}</>;
}

// ponytail: <a download> shows a save dialog on desktop WebView2/webkitgtk, but
// on macOS WKWebView it can fall back to opening a new tab. Doing this properly needs the tauri dialog+fs plugins.
function MediaFileChip({ mediaId, name, size, className = "scrap-comment__file", iconSize = 14 }: { mediaId: string; name: string; size: number; className?: string; iconSize?: number }) {
  const { data: href } = useMedia(mediaId);
  return (
    <a className={className} download={name} href={href ?? undefined} rel="noreferrer" target="_blank">
      <Icon name="file" size={iconSize} strokeWidth={1.5} />
      <span><strong title={name}>{name}</strong><small>{formatByteSize(size)}</small></span>
    </a>
  );
}

function CommentLinkPreview({ externalUrl, onOpen }: { externalUrl: string; onOpen: (event: MouseEvent<HTMLAnchorElement>, externalUrl: string) => void }) {
  const { data: previewSrc } = useLinkPreviewImage(externalUrl);
  if (!previewSrc) return null;

  const hostname = new URL(externalUrl).hostname.replace(/^www\./, "");
  return (
    <a aria-label={translate("scrap.linkPreview.openLabel", { title: hostname })} className="scrap-comment__link-preview" href={externalUrl} onClick={(event) => onOpen(event, externalUrl)} rel="noreferrer" target="_blank">
      <img alt="" decoding="async" loading="lazy" src={previewSrc} />
      <span><strong>{hostname}</strong><small>{externalUrl}</small></span>
    </a>
  );
}

function ScrapCard({ item, onOpen }: { item: ScrapItem; onOpen: () => void }) {
  const meta = kindMeta[item.kind];
  return <button className="scrap-list-card" onClick={onOpen} type="button"><div className={item.kind === "text" ? "scrap-list-card__media scrap-list-card__media--text" : "scrap-list-card__media"}><ScrapMediaPreview iconSize={20} item={item} meta={meta} /></div><div className="scrap-list-card__body"><strong title={item.title}>{item.title}</strong><p>{item.memo}</p><div className="scrap-list-card__footer"><span>{item.tag}</span><span className="scrap-list-card__comment-count"><Icon name="message" size={11} />{item.comments.length}</span></div></div></button>;
}

function ScrapDetail({ item, repository, tags, urlOpener, onRequestDelete, onManageTags }: { item: ScrapItem; repository: ScrapRepository; tags: string[]; urlOpener: ExternalUrlOpener; onRequestDelete: () => void; onManageTags: () => void }) {
  const meta = kindMeta[item.kind];
  const externalUrl = item.url ? externalUrlOf(item.url) : null;
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<ScrapWriteInput>({ title: item.title, memo: item.memo, url: item.url ?? "", tag: item.tag });
  const [editError, setEditError] = useState<string | null>(null);
  const [pendingPhoto, setPendingPhoto] = useState<PendingPhoto | null>(null);
  const [photoRemoved, setPhotoRemoved] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const photoPreviewUrlRef = useRef<string | null>(null);
  const photoFileRef = useRef<File | null>(null);
  const queryClient = useQueryClient();
  const mediaStore = useMediaStore();
  const { data: existingPhotoSrc } = useMedia(item.mediaId);

  useEffect(() => () => {
    if (photoPreviewUrlRef.current) URL.revokeObjectURL(photoPreviewUrlRef.current);
  }, []);

  const editMutation = useMutation({
    mutationFn: async (input: ScrapWriteInput) => {
      let mediaId: string | null = item.mediaId;
      let fileName: string | null = item.fileName;
      let fileSize: number | null = item.fileSize;
      let stagedMediaId: string | null = null;
      const photo = photoFileRef.current ?? pendingPhoto?.file ?? null;
      if (photo) {
        stagedMediaId = newMediaId();
        await mediaStore.save(stagedMediaId, photo);
        mediaId = stagedMediaId;
        const isImage = photo.type.startsWith("image/");
        fileName = isImage ? null : photo.name;
        fileSize = isImage ? null : photo.size;
      } else if (photoRemoved) {
        mediaId = null;
        fileName = null;
        fileSize = null;
      }
      try {
        await repository.update(item.id, { ...input, mediaId, fileName, fileSize });
      } catch (error) {
        if (stagedMediaId) { try { await mediaStore.delete(stagedMediaId); } catch { /* the orphaned-media GC cleans it up later. */ } }
        throw error;
      }
    },
    onMutate: () => setEditError(null),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: scrapQueryKey }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
      setEditing(false);
      resetPhotoDraft();
    },
    onError: (error) => setEditError(errorMessage(error)),
  });

  function resetPhotoDraft() {
    if (photoPreviewUrlRef.current) URL.revokeObjectURL(photoPreviewUrlRef.current);
    photoPreviewUrlRef.current = null;
    photoFileRef.current = null;
    setPendingPhoto(null);
    setPhotoRemoved(false);
    if (photoInputRef.current) photoInputRef.current.value = "";
  }

  function choosePhoto(file: File | undefined) {
    if (!file) return;
    const isImage = file.type.startsWith("image/");
    if (file.size === 0) { setEditError(translate("scrap.photo.readFailed")); return; }
    if (file.size > (isImage ? maxPhotoBytes : maxScrapFileBytes)) { setEditError(translate(isImage ? "scrap.photo.tooLarge" : "scrap.file.tooLarge")); return; }
    if (photoPreviewUrlRef.current) URL.revokeObjectURL(photoPreviewUrlRef.current);
    photoPreviewUrlRef.current = isImage ? URL.createObjectURL(file) : null;
    photoFileRef.current = file;
    setPendingPhoto({ file, previewUrl: photoPreviewUrlRef.current });
    setPhotoRemoved(false);
    setEditError(null);
    if (photoInputRef.current) photoInputRef.current.value = "";
  }

  function removePhoto() {
    if (photoPreviewUrlRef.current) URL.revokeObjectURL(photoPreviewUrlRef.current);
    photoPreviewUrlRef.current = null;
    photoFileRef.current = null;
    setPendingPhoto(null);
    setPhotoRemoved(true);
    if (photoInputRef.current) photoInputRef.current.value = "";
  }

  function startEditing() {
    setEditDraft({ title: item.title, memo: item.memo, url: item.url ?? "", tag: item.tag });
    setEditError(null);
    resetPhotoDraft();
    setEditing(true);
  }

  function cancelEditing() {
    setEditing(false);
    setEditError(null);
    resetPhotoDraft();
  }

  function submitEdit(event: FormEvent) {
    event.preventDefault();
    const input = { ...editDraft, title: editDraft.title.trim(), memo: editDraft.memo.trim(), url: editDraft.url.trim() };
    if (!input.title) { setEditError(translate("common.validation.titleRequired")); return; }
    if (!input.tag) { setEditError(translate("common.validation.labelRequired")); return; }
    editMutation.mutate(input);
  }

  function openExternalUrl(event: MouseEvent<HTMLAnchorElement>) {
    if (!externalUrl) return;
    event.preventDefault();
    void urlOpener.open(externalUrl);
  }

  return <div className="scrap-detail">{item.kind === "file" && item.mediaId
    ? <MediaFileChip className="scrap-detail__file" iconSize={18} mediaId={item.mediaId} name={item.fileName ?? translate("scrap.kind.file")} size={item.fileSize ?? 0} />
    : item.kind === "image" && existingPhotoSrc
      ? <button aria-label={translate("scrap.photo.zoom")} className="scrap-detail__media scrap-detail__media--zoomable" onClick={() => setLightboxSrc(existingPhotoSrc)} type="button"><img alt={item.title} src={existingPhotoSrc} /></button>
      : item.kind !== "text" && <div className="scrap-detail__media"><ScrapMediaPreview iconSize={22} item={item} meta={meta} /></div>}<div className="scrap-detail__copy">{editing ? (
    <form className="scrap-detail__editor" onSubmit={submitEdit}>
      <label><span>{translate("common.field.title")}</span><Input autoFocus disabled={editMutation.isPending} maxLength={500} onChange={(event) => setEditDraft((current) => ({ ...current, title: event.target.value }))} value={editDraft.title} /></label>
      <label><span>{translate("common.field.note")}</span><TextArea disabled={editMutation.isPending} maxLength={4_000} onChange={(event) => setEditDraft((current) => ({ ...current, memo: event.target.value }))} rows={3} value={editDraft.memo} /></label>
      <label><span>{translate("scrap.field.optionalLink")}</span><Input disabled={editMutation.isPending} maxLength={2_000} onChange={(event) => setEditDraft((current) => ({ ...current, url: event.target.value }))} placeholder="https://…" value={editDraft.url} /></label>
      <div className="scrap-create-form__label-field">
        <div className="scrap-create-form__label-legend"><span>{translate("common.field.label")}</span><button disabled={editMutation.isPending} onClick={onManageTags} type="button">{translate("common.action.manage")}</button></div>
        <Select disabled={editMutation.isPending} label={translate("common.field.label")} onChange={(tag) => setEditDraft((current) => ({ ...current, tag }))} options={tags.map((tag) => ({ value: tag, label: tag }))} value={editDraft.tag} />
      </div>
      <div className="scrap-detail__editor-photo">
        <span className="scrap-detail__editor-photo-legend">{translate("scrap.field.optionalPhoto")}</span>
        <input aria-label={translate("scrap.photo.filePicker")} className="capture-file-input" disabled={editMutation.isPending} onChange={(event) => choosePhoto(event.currentTarget.files?.[0])} ref={photoInputRef} tabIndex={-1} type="file" />
        {pendingPhoto ? (
          <div className="scrap-photo-preview">
            {pendingPhoto.previewUrl
              ? <img alt={translate("scrap.photo.previewLabel", { name: pendingPhoto.file.name })} src={pendingPhoto.previewUrl} />
              : <i className="scrap-photo-preview__file"><Icon name="file" size={19} strokeWidth={1.5} /></i>}
            <span><strong title={pendingPhoto.file.name}>{pendingPhoto.file.name}</strong><small>{formatByteSize(pendingPhoto.file.size)}</small></span>
            <Button disabled={editMutation.isPending} onClick={() => photoInputRef.current?.click()} size="small" type="button" variant="ghost">{translate("common.action.replace")}</Button>
            <IconButton aria-label={translate("scrap.photo.remove")} disabled={editMutation.isPending} onClick={removePhoto} size="small" title={translate("scrap.photo.remove")} type="button" variant="ghost"><Icon name="close" size={13} /></IconButton>
          </div>
        ) : item.mediaId && !photoRemoved ? (
          <div className="scrap-photo-preview">
            {item.kind === "file"
              ? <i className="scrap-photo-preview__file"><Icon name="file" size={19} strokeWidth={1.5} /></i>
              : existingPhotoSrc && <img alt={translate("scrap.photo.current")} src={existingPhotoSrc} />}
            <span><strong title={item.fileName ?? undefined}>{item.fileName ?? translate("scrap.photo.current")}</strong></span>
            <Button disabled={editMutation.isPending} onClick={() => photoInputRef.current?.click()} size="small" type="button" variant="ghost">{translate("common.action.replace")}</Button>
            <IconButton aria-label={translate("scrap.photo.remove")} disabled={editMutation.isPending} onClick={removePhoto} size="small" title={translate("scrap.photo.remove")} type="button" variant="ghost"><Icon name="close" size={13} /></IconButton>
          </div>
        ) : (
          <button className="scrap-photo-picker" disabled={editMutation.isPending} onClick={() => photoInputRef.current?.click()} type="button">
            <Icon name="file" size={17} strokeWidth={1.5} />
            <span><strong>{translate("scrap.photo.select")}</strong><small>{translate("scrap.photo.requirements")}</small></span>
          </button>
        )}
      </div>
      <div className="scrap-detail__editor-actions">
        <Button disabled={editMutation.isPending} onClick={cancelEditing} size="small" type="button" variant="ghost">{translate("common.action.cancel")}</Button>
        <Button loading={editMutation.isPending} size="small" type="submit" variant="primary">{translate("common.action.save")}</Button>
      </div>
      {editError && <div className="scrap-mutation-error" role="alert"><Icon name="alert" size={13} />{editError}</div>}
    </form>
  ) : (<>
    <div className="scrap-detail__copy-head"><strong>{item.title}</strong><span className="scrap-detail__tag">{item.tag}</span><IconButton aria-label={translate("scrap.action.edit")} onClick={startEditing} size="small" title={translate("scrap.action.edit")} type="button" variant="ghost"><Icon name="edit" size={13} /></IconButton><IconButton aria-label={translate("scrap.delete.title")} onClick={onRequestDelete} size="small" title={translate("scrap.delete.title")} type="button" variant="ghost"><Icon name="trash" size={13} /></IconButton></div><p>{item.memo}</p>{item.url && <div>{externalUrl ? <a className="scrap-detail__url" href={externalUrl} onClick={openExternalUrl} rel="noreferrer" target="_blank" title={translate("common.link.openNewWindow", { url: item.url })}>{item.url}</a> : <span className="scrap-detail__url" title={item.url}>{item.url}</span>}</div>}</>)}</div><hr /><div className="scrap-detail__comments-title"><strong>{translate("scrap.comment.title")}</strong><span>{item.comments.length}{translate("common.unit.items")}</span></div><div className="scrap-comments">{item.comments.map((comment) => <ScrapCommentRow comment={comment} key={comment.id} onZoom={setLightboxSrc} repository={repository} scrapId={item.id} urlOpener={urlOpener} />)}</div>{lightboxSrc && <ScrapImageLightbox name={item.title} onClose={() => setLightboxSrc(null)} src={lightboxSrc} />}</div>;
}

function CommentImageAttachment({ file, onZoom }: { file: ScrapCommentFile; onZoom: (src: string) => void }) {
  const { data: src } = useMedia(file.mediaId);
  if (!src) return <MediaFileChip mediaId={file.mediaId} name={file.name} size={file.size} />;
  return (
    <button className="scrap-comment__image" onClick={() => onZoom(src)} title={translate("scrap.photo.zoom")} type="button">
      <img alt={file.name} decoding="async" loading="lazy" src={src} />
    </button>
  );
}

function ScrapCommentRow({ comment, repository, scrapId, urlOpener, onZoom }: { comment: ScrapComment; repository: ScrapRepository; scrapId: string; urlOpener: ExternalUrlOpener; onZoom: (src: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draft, setDraft] = useState(comment.text);
  const [editError, setEditError] = useState<string | null>(null);
  const [editingVersion, setEditingVersion] = useState(comment.version ?? 1);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const editButtonDomId = `scrap-comment-edit-${comment.id}`;
  const deleteButtonDomId = `scrap-comment-delete-${comment.id}`;
  const queryClient = useQueryClient();
  const updateMutation = useMutation({
    mutationFn: (text: string) => repository.updateComment(scrapId, comment.id, { text }, editingVersion),
    onMutate: () => setEditError(null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: scrapQueryKey });
      setEditing(false);
      requestAnimationFrame(() => document.getElementById(editButtonDomId)?.focus());
    },
    onError: async (error) => {
      setEditError(errorMessage(error));
      if (isConflictError(error)) {
        const version = await resyncConflictVersion<ScrapSnapshot>(
          queryClient, scrapQueryKey,
          () => queryClient.invalidateQueries({ queryKey: scrapQueryKey }),
          (snapshot) => snapshot.items.find((candidate) => candidate.id === scrapId)?.comments.find((candidate) => candidate.id === comment.id),
        );
        if (version !== null) setEditingVersion(version);
      }
    },
  });
  const deleteMutation = useMutation({
    mutationFn: () => repository.deleteComment(scrapId, comment.id),
    onMutate: () => setDeleteError(null),
    // On success this row disappears, so there's no need to restore focus.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: scrapQueryKey }),
    onError: (error) => setDeleteError(errorMessage(error)),
  });

  function startEditing() {
    setDraft(comment.text);
    setEditingVersion(comment.version ?? 1);
    setEditError(null);
    setEditing(true);
  }

  function cancelEditing() {
    if (updateMutation.isPending) return;
    setEditing(false);
    setDraft(comment.text);
    setEditError(null);
    requestAnimationFrame(() => document.getElementById(editButtonDomId)?.focus());
  }

  function submitEdit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) {
      setEditError(translate("scrap.comment.validation.required"));
      return;
    }
    if (text === comment.text) {
      cancelEditing();
      return;
    }
    updateMutation.mutate(text);
  }

  return (
    <article aria-busy={updateMutation.isPending || deleteMutation.isPending} className={editing ? "scrap-comment scrap-comment--editing" : "scrap-comment"}>
      <div className="scrap-comment__meta">
        <time>{formatTimestamp(comment.createdAt)}</time>
        {!editing && !confirmingDelete && (
          <div className="scrap-comment__actions">
            <IconButton aria-label={translate("scrap.comment.editLabel", { date: comment.text })} id={editButtonDomId} onClick={startEditing} size="small" title={translate("scrap.comment.edit")} type="button" variant="ghost"><Icon name="edit" size={12} /></IconButton>
            <IconButton aria-label={translate("scrap.comment.deleteLabel", { date: comment.text })} id={deleteButtonDomId} onClick={() => { setDeleteError(null); setConfirmingDelete(true); }} size="small" title={translate("scrap.comment.delete")} type="button" variant="ghost"><Icon name="trash" size={12} /></IconButton>
          </div>
        )}
        {confirmingDelete && (
          <div aria-label={translate("scrap.comment.deleteConfirm")} className="scrap-comment__confirm" role="group">
            <Button disabled={deleteMutation.isPending} onClick={() => { setConfirmingDelete(false); requestAnimationFrame(() => document.getElementById(deleteButtonDomId)?.focus()); }} size="small" type="button" variant="ghost">{translate("common.action.cancel")}</Button>
            <Button autoFocus loading={deleteMutation.isPending} onClick={() => deleteMutation.mutate()} size="small" type="button" variant="danger">{translate("common.action.delete")}</Button>
          </div>
        )}
      </div>
      {editing ? (
        <form className="scrap-comment__editor" onSubmit={submitEdit}>
          <TextArea
            aria-invalid={editError ? "true" : undefined}
            aria-label={translate("scrap.comment.edit")}
            autoFocus
            disabled={updateMutation.isPending}
            maxLength={2_000}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                cancelEditing();
                return;
              }
              submitFormOnEnter(event);
            }}
            rows={1}
            value={draft}
          />
          <div className="scrap-comment__editor-actions">
            <Button disabled={updateMutation.isPending} onClick={cancelEditing} size="small" type="button" variant="ghost">{translate("common.action.cancel")}</Button>
            <Button loading={updateMutation.isPending} size="small" type="submit" variant="primary">{translate("common.action.save")}</Button>
          </div>
          {editError && <span className="scrap-comment__edit-error" role="alert">{editError}</span>}
        </form>
      ) : (
        <>
          {comment.text && <CommentContent text={comment.text} urlOpener={urlOpener} />}
          {comment.file && (isImageName(comment.file.name)
            ? <CommentImageAttachment file={comment.file} onZoom={onZoom} />
            : <MediaFileChip mediaId={comment.file.mediaId} name={comment.file.name} size={comment.file.size} />)}
        </>
      )}
      {deleteError && <span className="scrap-comment__edit-error" role="alert">{deleteError}</span>}
    </article>
  );
}

// Opens the image large. Download recovers the original from the blob: object URL and uses the native save dialog.
function ScrapImageLightbox({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const downloadName = isImageName(name) ? name : `${name || translate("common.media.photo")}.png`;

  async function download() {
    setSaving(true);
    setSaveError(false);
    try {
      await saveObjectUrlToDisk(src, downloadName);
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div aria-label={name} aria-modal="true" className="scrap-lightbox" onClick={onClose} role="dialog">
      <div className="scrap-lightbox__bar" onClick={(event) => event.stopPropagation()}>
        <span title={name}>{saveError ? translate("common.error.actionFailed") : name}</span>
        <button className="scrap-lightbox__action" disabled={saving} onClick={download} title={translate("common.action.download")} type="button"><Icon name="download" size={16} /></button>
        <button className="scrap-lightbox__action" onClick={onClose} title={translate("app.action.close")} type="button"><Icon name="close" size={16} /></button>
      </div>
      <img alt={name} onClick={(event) => event.stopPropagation()} src={src} />
    </div>,
    document.body,
  );
}

function ScrapEmpty({ onCreate }: { onCreate: () => void }) {
  return <div className="scrap-empty"><Icon name="scrap" size={28} /><strong>{translate("scrap.empty.title")}</strong><span>{translate("scrap.empty.description")}</span><Button onClick={onCreate} variant="primary">{translate("app.action.newScrap")}</Button></div>;
}

function ScrapFilterEmpty({ onReset }: { onReset: () => void }) {
  return <div className="scrap-empty"><Icon name="search" size={28} /><strong>{translate("scrap.empty.filteredTitle")}</strong><span>{translate("scrap.empty.filteredDescription")}</span><Button onClick={onReset}>{translate("common.action.clearFilter")}</Button></div>;
}

function ScrapLoading() {
  return <div aria-label={translate("scrap.loading")} className="scrap-page scrap-page--loading"><div className="scrap-tags" /><div className="scrap-list">{Array.from({ length: 6 }, (_, index) => <div className="scrap-list-card scrap-list-card--skeleton" key={index} />)}</div></div>;
}
