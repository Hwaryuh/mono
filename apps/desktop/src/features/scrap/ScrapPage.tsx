import type { ScrapComment, ScrapItem, ScrapKind, ScrapSnapshot, ScrapWriteInput } from "@mono/contracts";
import { formatTimestamp } from "@mono/domain";
import { Button, Drawer, Icon, IconButton, Input, Modal, Select, TextArea, type IconName } from "@mono/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type MouseEvent } from "react";
import { useSearchParams } from "react-router";
import { externalUrlOf, PlatformExternalUrlOpener, type ExternalUrlOpener } from "../../infrastructure/external-url-opener";
import { httpGetBlob } from "../../infrastructure/http/http-client";
import { useMedia, useMediaStore } from "../../infrastructure/media/media-store-context";
import type { ScrapRepository } from "./scrap-repository";

export const scrapQueryKey = ["scrap"] as const;

const kindMeta: Record<ScrapKind, { icon: IconName; label: string }> = {
  image: { icon: "image", label: "이미지" },
  url: { icon: "layers", label: "링크 미리보기" },
  text: { icon: "note", label: "메모" },
  video: { icon: "video", label: "동영상" },
};

type Draft = ScrapWriteInput;
type PendingPhoto = { file: File; previewUrl: string };

const blankDraft: Draft = { title: "", memo: "", url: "", tag: "수집" };
const maxPhotoBytes = 10 * 1024 * 1024;
const photoPickerDomId = "scrap-photo-picker";
const photoReplaceDomId = "scrap-photo-replace";
const externalUrlOpener = PlatformExternalUrlOpener.of();

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "작업을 완료하지 못했습니다.";
}

function photoTitle(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").trim() || "사진";
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function ScrapPage({ repository, urlOpener = externalUrlOpener }: { repository: ScrapRepository; urlOpener?: ExternalUrlOpener }) {
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState("");
  const [commentBusyId, setCommentBusyId] = useState<string | null>(null);
  const [commentErrors, setCommentErrors] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [pendingPhoto, setPendingPhoto] = useState<PendingPhoto | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [tagSaving, setTagSaving] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [tagError, setTagError] = useState<string | null>(null);
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [deleteTagName, setDeleteTagName] = useState<string | null>(null);
  const [replacementTag, setReplacementTag] = useState("");
  const [tagDeletePending, setTagDeletePending] = useState(false);
  const [tagDeleteError, setTagDeleteError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const handledModalRef = useRef(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const photoPreviewUrlRef = useRef<string | null>(null);
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
      const mediaId = crypto.randomUUID();
      await mediaStore.save(mediaId, photo);
      try {
        await repository.create({ ...input, mediaId });
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
      if (searchParams.has("detail")) setSearchParams({}, { replace: true });
    },
    onError: (error) => setDeleteError(errorMessage(error)),
  });

  useEffect(() => {
    const shouldOpen = searchParams.get("modal") === "new";
    if (shouldOpen && !handledModalRef.current && snapshotQuery.data) {
      handledModalRef.current = true;
      replacePhoto();
      setDraft({ ...blankDraft, tag: snapshotQuery.data.tags.includes("수집") ? "수집" : snapshotQuery.data.tags[0] ?? "수집" });
      setFormError(null);
    }
    if (!shouldOpen) handledModalRef.current = false;
  }, [searchParams, snapshotQuery.data]);

  useEffect(() => () => {
    if (photoPreviewUrlRef.current) URL.revokeObjectURL(photoPreviewUrlRef.current);
  }, []);

  useEffect(() => {
    const requestedId = searchParams.get("detail");
    if (requestedId && snapshotQuery.data?.items.some((item) => item.id === requestedId)) setDetailId(requestedId);
  }, [searchParams, snapshotQuery.data]);

  if (snapshotQuery.isPending) return <ScrapLoading />;
  if (snapshotQuery.isError) return <div className="scrap-state" role="alert"><Icon name="alert" size={18} />스크랩을 불러오지 못했습니다.</div>;

  const snapshot = snapshotQuery.data;
  const detail = snapshot.items.find((item) => item.id === detailId) ?? null;
  const visibleItems = activeTag ? snapshot.items.filter((item) => item.tag === activeTag) : snapshot.items;
  const createOpen = searchParams.get("modal") === "new";

  function openCreate() {
    replacePhoto();
    setDraft({ ...blankDraft, tag: snapshot.tags.includes("수집") ? "수집" : snapshot.tags[0] ?? "수집" });
    setFormError(null);
    setTagManagerOpen(false);
    setTagError(null);
    setSearchParams({ modal: "new" }, { replace: true });
  }

  function closeCreate(force = false) {
    if (createMutation.isPending && !force) return;
    replacePhoto();
    setFormError(null);
    setTagManagerOpen(false);
    setTagInput("");
    setTagError(null);
    if (searchParams.has("modal")) setSearchParams({}, { replace: true });
  }

  function submitCreate(event: FormEvent) {
    event.preventDefault();
    const input = { ...draft, title: draft.title.trim(), memo: draft.memo.trim(), url: draft.url.trim() };
    if (!input.title) { setFormError("제목을 입력해야 합니다."); return; }
    if (!input.tag) { setFormError("라벨을 선택해야 합니다."); return; }
    createMutation.mutate({ input, photo: pendingPhoto?.file ?? null });
  }

  function replacePhoto(next: PendingPhoto | null = null) {
    if (photoPreviewUrlRef.current) URL.revokeObjectURL(photoPreviewUrlRef.current);
    photoPreviewUrlRef.current = next?.previewUrl ?? null;
    setPendingPhoto(next);
    if (photoInputRef.current) photoInputRef.current.value = "";
  }

  function choosePhoto(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setFormError("사진 파일만 추가할 수 있습니다.");
      return;
    }
    if (file.size > maxPhotoBytes) {
      setFormError("사진은 10MB를 넘을 수 없습니다.");
      return;
    }
    replacePhoto({ file, previewUrl: URL.createObjectURL(file) });
    setDraft((current) => current.title.trim() ? current : { ...current, title: photoTitle(file.name) });
    setFormError(null);
    requestAnimationFrame(() => document.getElementById(photoReplaceDomId)?.focus());
  }

  function removePhoto() {
    replacePhoto();
    requestAnimationFrame(() => document.getElementById(photoPickerDomId)?.focus());
  }

  async function submitComment(event: FormEvent) {
    event.preventDefault();
    if (!detail) return;
    const text = commentText.trim();
    if (!text) return;
    const scrapId = detail.id;
    setCommentBusyId(scrapId);
    setCommentErrors((current) => ({ ...current, [scrapId]: "" }));
    try {
      await repository.addComment(scrapId, { text });
      await invalidateSnapshots();
      setCommentText("");
    } catch (error) {
      setCommentErrors((current) => ({ ...current, [scrapId]: errorMessage(error) }));
    } finally {
      setCommentBusyId((current) => current === scrapId ? null : current);
    }
  }

  function openTagManager() {
    setTagInput("");
    setTagError(null);
    setEditingTag(null);
    setTagManagerOpen(true);
  }

  function closeTagManager() {
    if (tagSaving) return;
    setTagManagerOpen(false);
    setTagInput("");
    setTagError(null);
    setEditingTag(null);
    setDeleteTagName(null);
  }

  function openDeleteTag(tag: string) {
    const replacement = snapshot.tags.find((candidate) => candidate !== tag);
    if (!replacement) return;
    setDeleteTagName(tag);
    setReplacementTag(replacement);
    setTagDeleteError(null);
  }

  async function confirmDeleteTag() {
    if (!deleteTagName || !replacementTag) return;
    setTagDeletePending(true);
    setTagDeleteError(null);
    try {
      await repository.deleteTag(deleteTagName, replacementTag);
      await invalidateSnapshots();
      setActiveTag((current) => current === deleteTagName ? null : current);
      setDraft((current) => current.tag === deleteTagName ? { ...current, tag: replacementTag } : current);
      setEditingTag((current) => current === deleteTagName ? null : current);
      setDeleteTagName(null);
    } catch (error) {
      setTagDeleteError(errorMessage(error));
    } finally {
      setTagDeletePending(false);
    }
  }

  function editTag(tag: string) {
    setEditingTag(tag);
    setTagInput(tag);
    setTagError(null);
  }

  async function commitTag() {
    const tag = tagInput.trim();
    if (!tag) {
      setTagError("라벨 이름을 입력해야 합니다.");
      return;
    }
    setTagError(null);
    setTagSaving(true);
    try {
      if (editingTag) {
        await repository.renameTag(editingTag, tag);
        await invalidateSnapshots();
        setActiveTag((current) => current === editingTag ? tag : current);
        setDraft((current) => current.tag === editingTag ? { ...current, tag } : current);
        setEditingTag(null);
      } else {
        await repository.addTag(tag);
        await queryClient.invalidateQueries({ queryKey: scrapQueryKey });
        setDraft((current) => ({ ...current, tag }));
      }
      setTagInput("");
    } catch (error) {
      setTagError(errorMessage(error));
    } finally {
      setTagSaving(false);
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

  return (
    <div className="scrap-page">
      <div aria-label="스크랩 라벨 필터" className="scrap-tags" role="toolbar">
        {snapshot.tags.map((tag, index) => (
          <button
            aria-pressed={activeTag === tag}
            className={activeTag === tag ? "scrap-tag scrap-tag--active" : "scrap-tag"}
            key={tag}
            onClick={() => setActiveTag((current) => current === tag ? null : tag)}
            onKeyDown={(event) => onTagKeyDown(event, index)}
            ref={(element) => { tagRefs.current[index] = element; }}
            type="button"
          >{tag}</button>
        ))}
      </div>

      {snapshot.items.length === 0 ? <ScrapEmpty onCreate={openCreate} /> : visibleItems.length === 0 ? <ScrapFilterEmpty onReset={() => setActiveTag(null)} /> : (
        <div className="scrap-list">
          {visibleItems.map((item) => <ScrapCard item={item} key={item.id} onOpen={() => { setDetailId(item.id); setCommentText(""); setSearchParams({ detail: item.id }, { replace: true }); }} />)}
        </div>
      )}

      <Drawer
        className="scrap-detail-drawer"
        footer={detail ? <form className="scrap-comment-form" onSubmit={submitComment}><Input aria-label="새 댓글" disabled={commentBusyId === detail.id} onChange={(event) => setCommentText(event.target.value)} placeholder="새 댓글…" value={commentText} /><Button aria-label="댓글" loading={commentBusyId === detail.id} title="댓글 등록" type="submit" variant="primary">{commentBusyId !== detail.id && <Icon name="send" size={14} strokeWidth={1.8} />}</Button>{commentErrors[detail.id] && <span className="scrap-comment-error" role="alert">{commentErrors[detail.id]}</span>}</form> : undefined}
        icon="scrap"
        onClose={() => { if (!commentBusyId) { setDetailId(null); setCommentText(""); if (searchParams.has("detail")) setSearchParams({}, { replace: true }); } }}
        open={detail !== null}
        title={<span className="scrap-detail-title">스크랩{detail && <small>{formatTimestamp(detail.savedAt)} 저장</small>}</span>}
      >
        {detail && <ScrapDetail item={detail} onRequestDelete={() => { setDeleteError(null); setConfirmDeleteId(detail.id); }} repository={repository} tags={snapshot.tags} urlOpener={urlOpener} />}
      </Drawer>

      <Modal
        className="scrap-delete-modal"
        footer={<><Button disabled={deleteMutation.isPending} onClick={() => setConfirmDeleteId(null)}>취소</Button><Button loading={deleteMutation.isPending} onClick={() => confirmDeleteId && deleteMutation.mutate(confirmDeleteId)} variant="danger">삭제</Button></>}
        icon="alert"
        onClose={() => { if (!deleteMutation.isPending) setConfirmDeleteId(null); }}
        open={confirmDeleteId !== null}
        title="스크랩 삭제"
      >
        <p><strong>{snapshot.items.find((item) => item.id === confirmDeleteId)?.title}</strong> 스크랩을 삭제할까요? 댓글도 함께 사라지며 되돌릴 수 없습니다.</p>
        {deleteError && <div className="scrap-mutation-error" role="alert"><Icon name="alert" size={13} />{deleteError}</div>}
      </Modal>

      <Modal
        className="scrap-create-modal"
        footer={<><Button disabled={createMutation.isPending} onClick={() => closeCreate()}>취소</Button><Button form="scrap-create-form" loading={createMutation.isPending} type="submit" variant="primary">저장</Button></>}
        icon="scrap"
        onClose={closeCreate}
        open={createOpen}
        title="스크랩 추가"
      >
        <form aria-busy={createMutation.isPending} className="scrap-create-form" id="scrap-create-form" onSubmit={submitCreate}>
          <label><span>제목</span><Input autoFocus maxLength={500} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="예: 합주실 후보 정리" value={draft.title} /></label>
          <label><span>메모</span><TextArea maxLength={4_000} onChange={(event) => setDraft((current) => ({ ...current, memo: event.target.value }))} placeholder="메모..." rows={3} value={draft.memo} /></label>
          <label><span>링크 (선택)</span><Input maxLength={2_000} onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))} placeholder="https://…" value={draft.url} /></label>
          <fieldset className="scrap-create-form__photo-fieldset">
            <legend>사진 (선택)</legend>
            <input
              accept="image/*"
              aria-label="사진 파일 선택"
              className="capture-file-input"
              disabled={createMutation.isPending}
              onChange={(event) => choosePhoto(event.currentTarget.files?.[0])}
              ref={photoInputRef}
              tabIndex={-1}
              type="file"
            />
            {pendingPhoto ? (
              <div className="scrap-photo-preview">
                <img alt={`${pendingPhoto.file.name} 미리보기`} src={pendingPhoto.previewUrl} />
                <span><strong title={pendingPhoto.file.name}>{pendingPhoto.file.name}</strong><small>{formatFileSize(pendingPhoto.file.size)}</small></span>
                <Button disabled={createMutation.isPending} id={photoReplaceDomId} onClick={() => photoInputRef.current?.click()} size="small" type="button" variant="ghost">교체</Button>
                <IconButton aria-label={`${pendingPhoto.file.name} 사진 제거`} disabled={createMutation.isPending} onClick={removePhoto} size="small" title="사진 제거" type="button" variant="ghost"><Icon name="close" size={13} /></IconButton>
              </div>
            ) : (
              <button className="scrap-photo-picker" disabled={createMutation.isPending} id={photoPickerDomId} onClick={() => photoInputRef.current?.click()} type="button">
                <Icon name="image" size={17} strokeWidth={1.5} />
                <span><strong>사진 선택</strong><small>JPG, PNG 등 · 최대 10MB</small></span>
              </button>
            )}
          </fieldset>
          <fieldset className="scrap-create-form__label-fieldset">
            <legend className="scrap-create-form__label-legend"><span>라벨</span><button disabled={createMutation.isPending} onClick={openTagManager} type="button">관리</button></legend>
            <Select disabled={createMutation.isPending} label="라벨" onChange={(tag) => setDraft((current) => ({ ...current, tag }))} options={snapshot.tags.map((tag) => ({ value: tag, label: tag }))} value={draft.tag} />
          </fieldset>
          {formError && <div className="scrap-mutation-error" role="alert"><Icon name="alert" size={13} />{formError}</div>}
        </form>
      </Modal>

      <Modal className="scrap-label-manager-modal" icon="label" onClose={closeTagManager} open={tagManagerOpen} title="라벨 관리">
        <div className="scrap-label-manager">
          <div aria-label="현재 라벨" className="scrap-label-manager__list">
            {snapshot.tags.map((tag) => (
              <div className="scrap-label-manager__row" key={tag}>
                <strong>{tag}</strong>
                <span>{snapshot.items.filter((item) => item.tag === tag).length}개</span>
                <IconButton aria-label={`${tag} 편집`} disabled={tagSaving} onClick={() => editTag(tag)} size="small" title="편집" type="button" variant="ghost"><Icon name="edit" size={13} /></IconButton>
                <IconButton aria-label={tag === "기타" ? `${tag} 삭제 불가` : `${tag} 삭제`} disabled={tagSaving || tag === "기타"} onClick={() => openDeleteTag(tag)} size="small" title={tag === "기타" ? "기타 라벨은 삭제할 수 없습니다" : "삭제"} type="button" variant="ghost"><Icon name="trash" size={13} /></IconButton>
              </div>
            ))}
          </div>
          <form aria-busy={tagSaving} className="scrap-label-create" onSubmit={(event) => { event.preventDefault(); void commitTag(); }}>
            <div className="scrap-label-create__header">
              <strong>{editingTag ? "라벨 수정" : "새 라벨"}</strong>
              {editingTag && <button disabled={tagSaving} onClick={() => { setEditingTag(null); setTagInput(""); setTagError(null); }} type="button">취소</button>}
            </div>
            <div className="scrap-label-create__controls">
              <Input aria-label="라벨 이름" autoFocus disabled={tagSaving} maxLength={100} onChange={(event) => setTagInput(event.target.value)} placeholder="라벨 이름" value={tagInput} />
              <Button loading={tagSaving} type="submit" variant="primary">{editingTag ? "저장" : "추가"}</Button>
            </div>
            {tagError && <div className="scrap-mutation-error" role="alert"><Icon name="alert" size={13} />{tagError}</div>}
          </form>
        </div>
      </Modal>

      <Modal
        className="scrap-label-delete-modal"
        footer={<><Button disabled={tagDeletePending} onClick={() => setDeleteTagName(null)}>취소</Button><Button loading={tagDeletePending} onClick={() => void confirmDeleteTag()} variant="danger">삭제</Button></>}
        icon="alert"
        onClose={() => { if (!tagDeletePending) setDeleteTagName(null); }}
        open={deleteTagName !== null}
        title="라벨 삭제"
      >
        <div className="scrap-label-delete">
          <p><strong>{deleteTagName}</strong> 라벨을 삭제할까요?</p>
          <label>
            <span>기존 스크랩 이동</span>
            <Select
              disabled={tagDeletePending}
              label="이동할 라벨"
              onChange={setReplacementTag}
              options={snapshot.tags.filter((tag) => tag !== deleteTagName).map((tag) => ({ value: tag, label: tag }))}
              value={replacementTag}
            />
          </label>
          <small>기존 스크랩은 모두 선택한 라벨로 이동합니다.</small>
          {tagDeleteError && <div className="scrap-mutation-error" role="alert"><Icon name="alert" size={13} />{tagDeleteError}</div>}
        </div>
      </Modal>
    </div>
  );
}

// 링크 미리보기 이미지는 인증이 걸린 원격 서버에서도 떠야 하므로 <img src>가 아니라
// 토큰 헤더를 실은 fetch로 가져와 object URL로 만든다(미디어 이미지와 같은 방식).
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
  return <><Icon name={meta.icon} size={iconSize} strokeWidth={1.4} /><span>{meta.label}</span></>;
}

function ScrapCard({ item, onOpen }: { item: ScrapItem; onOpen: () => void }) {
  const meta = kindMeta[item.kind];
  return <button className="scrap-list-card" onClick={onOpen} type="button"><div className={item.kind === "text" ? "scrap-list-card__media scrap-list-card__media--text" : "scrap-list-card__media"}><ScrapMediaPreview iconSize={20} item={item} meta={meta} /></div><div className="scrap-list-card__body"><strong title={item.title}>{item.title}</strong><p>{item.memo}</p><div><span>{item.tag}</span><span><Icon name="message" size={11} />{item.comments.length}</span></div></div></button>;
}

function ScrapDetail({ item, repository, tags, urlOpener, onRequestDelete }: { item: ScrapItem; repository: ScrapRepository; tags: string[]; urlOpener: ExternalUrlOpener; onRequestDelete: () => void }) {
  const meta = kindMeta[item.kind];
  const externalUrl = item.url ? externalUrlOf(item.url) : null;
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState<ScrapWriteInput>({ title: item.title, memo: item.memo, url: item.url ?? "", tag: item.tag });
  const [editError, setEditError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const editMutation = useMutation({
    mutationFn: (input: ScrapWriteInput) => repository.update(item.id, input),
    onMutate: () => setEditError(null),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: scrapQueryKey }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
      setEditing(false);
    },
    onError: (error) => setEditError(errorMessage(error)),
  });

  function startEditing() {
    setEditDraft({ title: item.title, memo: item.memo, url: item.url ?? "", tag: item.tag });
    setEditError(null);
    setEditing(true);
  }

  function submitEdit(event: FormEvent) {
    event.preventDefault();
    const input = { ...editDraft, title: editDraft.title.trim(), memo: editDraft.memo.trim(), url: editDraft.url.trim() };
    if (!input.title) { setEditError("제목을 입력해야 합니다."); return; }
    if (!input.tag) { setEditError("라벨을 선택해야 합니다."); return; }
    editMutation.mutate(input);
  }

  function openExternalUrl(event: MouseEvent<HTMLAnchorElement>) {
    if (!externalUrl) return;
    event.preventDefault();
    void urlOpener.open(externalUrl);
  }

  return <div className="scrap-detail">{item.kind !== "text" && <div className="scrap-detail__media"><ScrapMediaPreview iconSize={22} item={item} meta={meta} /></div>}<div className="scrap-detail__copy">{editing ? (
    <form className="scrap-detail__editor" onSubmit={submitEdit}>
      <label><span>제목</span><Input autoFocus disabled={editMutation.isPending} maxLength={500} onChange={(event) => setEditDraft((current) => ({ ...current, title: event.target.value }))} value={editDraft.title} /></label>
      <label><span>메모</span><TextArea disabled={editMutation.isPending} maxLength={4_000} onChange={(event) => setEditDraft((current) => ({ ...current, memo: event.target.value }))} rows={3} value={editDraft.memo} /></label>
      <label><span>링크 (선택)</span><Input disabled={editMutation.isPending} maxLength={2_000} onChange={(event) => setEditDraft((current) => ({ ...current, url: event.target.value }))} placeholder="https://…" value={editDraft.url} /></label>
      <label><span>라벨</span><Select disabled={editMutation.isPending} label="라벨" onChange={(tag) => setEditDraft((current) => ({ ...current, tag }))} options={tags.map((tag) => ({ value: tag, label: tag }))} value={editDraft.tag} /></label>
      <div className="scrap-detail__editor-actions">
        <Button disabled={editMutation.isPending} onClick={() => { setEditing(false); setEditError(null); }} size="small" type="button" variant="ghost">취소</Button>
        <Button loading={editMutation.isPending} size="small" type="submit" variant="primary">저장</Button>
      </div>
      {editError && <div className="scrap-mutation-error" role="alert"><Icon name="alert" size={13} />{editError}</div>}
    </form>
  ) : (<>
    <div className="scrap-detail__copy-head"><strong>{item.title}</strong><span className="scrap-detail__tag">{item.tag}</span><IconButton aria-label="스크랩 수정" onClick={startEditing} size="small" title="스크랩 수정" type="button" variant="ghost"><Icon name="edit" size={13} /></IconButton><IconButton aria-label="스크랩 삭제" onClick={onRequestDelete} size="small" title="스크랩 삭제" type="button" variant="ghost"><Icon name="trash" size={13} /></IconButton></div><p>{item.memo}</p>{item.url && <div>{externalUrl ? <a className="scrap-detail__url" href={externalUrl} onClick={openExternalUrl} rel="noreferrer" target="_blank" title={`${item.url} 새 창에서 열기`}>{item.url}</a> : <span className="scrap-detail__url" title={item.url}>{item.url}</span>}</div>}</>)}</div><hr /><div className="scrap-detail__comments-title"><strong>댓글</strong><span>{item.comments.length}개</span></div><div className="scrap-comments">{item.comments.map((comment) => <ScrapCommentRow comment={comment} key={comment.id} repository={repository} scrapId={item.id} />)}</div></div>;
}

function ScrapCommentRow({ comment, repository, scrapId }: { comment: ScrapComment; repository: ScrapRepository; scrapId: string }) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [draft, setDraft] = useState(comment.text);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const editButtonDomId = `scrap-comment-edit-${comment.id}`;
  const deleteButtonDomId = `scrap-comment-delete-${comment.id}`;
  const queryClient = useQueryClient();
  const updateMutation = useMutation({
    mutationFn: (text: string) => repository.updateComment(scrapId, comment.id, { text }),
    onMutate: () => setEditError(null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: scrapQueryKey });
      setEditing(false);
      requestAnimationFrame(() => document.getElementById(editButtonDomId)?.focus());
    },
    onError: (error) => setEditError(errorMessage(error)),
  });
  const deleteMutation = useMutation({
    mutationFn: () => repository.deleteComment(scrapId, comment.id),
    onMutate: () => setDeleteError(null),
    // 성공 시 이 행이 사라지므로 focus 복원은 필요 없다.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: scrapQueryKey }),
    onError: (error) => setDeleteError(errorMessage(error)),
  });

  function startEditing() {
    setDraft(comment.text);
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
      setEditError("댓글 내용을 입력해야 합니다.");
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
            <IconButton aria-label={`${comment.text} 댓글 수정`} id={editButtonDomId} onClick={startEditing} size="small" title="댓글 수정" type="button" variant="ghost"><Icon name="edit" size={12} /></IconButton>
            <IconButton aria-label={`${comment.text} 댓글 삭제`} id={deleteButtonDomId} onClick={() => { setDeleteError(null); setConfirmingDelete(true); }} size="small" title="댓글 삭제" type="button" variant="ghost"><Icon name="trash" size={12} /></IconButton>
          </div>
        )}
        {confirmingDelete && (
          <div aria-label="댓글 삭제 확인" className="scrap-comment__confirm" role="group">
            <Button disabled={deleteMutation.isPending} onClick={() => { setConfirmingDelete(false); requestAnimationFrame(() => document.getElementById(deleteButtonDomId)?.focus()); }} size="small" type="button" variant="ghost">취소</Button>
            <Button autoFocus loading={deleteMutation.isPending} onClick={() => deleteMutation.mutate()} size="small" type="button" variant="danger">삭제</Button>
          </div>
        )}
      </div>
      {editing ? (
        <form className="scrap-comment__editor" onSubmit={submitEdit}>
          <Input
            aria-invalid={editError ? "true" : undefined}
            aria-label="댓글 수정"
            autoFocus
            disabled={updateMutation.isPending}
            maxLength={2_000}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape") return;
              event.preventDefault();
              event.stopPropagation();
              cancelEditing();
            }}
            value={draft}
          />
          <div className="scrap-comment__editor-actions">
            <Button disabled={updateMutation.isPending} onClick={cancelEditing} size="small" type="button" variant="ghost">취소</Button>
            <Button loading={updateMutation.isPending} size="small" type="submit" variant="primary">저장</Button>
          </div>
          {editError && <span className="scrap-comment__edit-error" role="alert">{editError}</span>}
        </form>
      ) : <p>{comment.text}</p>}
      {deleteError && <span className="scrap-comment__edit-error" role="alert">{deleteError}</span>}
    </article>
  );
}

function ScrapEmpty({ onCreate }: { onCreate: () => void }) {
  return <div className="scrap-empty"><Icon name="scrap" size={28} /><strong>아직 스크랩이 없습니다</strong><span>기억해 둘 자료와 메모를 모아 두세요.</span><Button onClick={onCreate} variant="primary">스크랩 추가</Button></div>;
}

function ScrapFilterEmpty({ onReset }: { onReset: () => void }) {
  return <div className="scrap-empty"><Icon name="search" size={28} /><strong>이 라벨의 스크랩이 없습니다</strong><span>다른 라벨을 선택하거나 필터를 해제하세요.</span><Button onClick={onReset}>필터 해제</Button></div>;
}

function ScrapLoading() {
  return <div aria-label="스크랩 불러오는 중" className="scrap-page scrap-page--loading"><div className="scrap-tags" /><div className="scrap-list">{Array.from({ length: 6 }, (_, index) => <div className="scrap-list-card scrap-list-card--skeleton" key={index} />)}</div></div>;
}
