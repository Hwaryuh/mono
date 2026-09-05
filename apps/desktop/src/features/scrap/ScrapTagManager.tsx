import type { ScrapSnapshot } from "@mono/contracts";
import { Button, Icon, IconButton, Input, Modal, Select } from "@mono/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { translate } from "../../i18n/i18n";
import { errorMessage } from "../../i18n/error-message";
import { scrapQueryKey, type ScrapRepository } from "./scrap-repository";

/**
 * Manages scrap tags (labels) — runs the list/rename/add/delete pair of modals on its own state.
 * Only notifies the parent (ScrapPage) of tag-change results via rename/add/delete events, so the parent
 * can follow along on the filter (activeTag) and the draft being composed (draft.tag). The repository update happens directly here.
 */
export function ScrapTagManager({ open, onClose, snapshot, repository, onTagRenamed, onTagAdded, onTagDeleted }: {
  open: boolean;
  onClose: () => void;
  snapshot: ScrapSnapshot;
  repository: ScrapRepository;
  onTagRenamed: (from: string, to: string) => void;
  onTagAdded: (tag: string) => void;
  onTagDeleted: (from: string, replacement: string) => void;
}) {
  const queryClient = useQueryClient();
  const [tagSaving, setTagSaving] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const [tagError, setTagError] = useState<string | null>(null);
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [deleteTagName, setDeleteTagName] = useState<string | null>(null);
  const [replacementTag, setReplacementTag] = useState("");
  const [tagDeletePending, setTagDeletePending] = useState(false);
  const [tagDeleteError, setTagDeleteError] = useState<string | null>(null);

  // Resets the edit state every time it opens (what the old openTagManager used to do).
  useEffect(() => {
    if (open) { setTagInput(""); setTagError(null); setEditingTag(null); }
  }, [open]);

  const invalidateSnapshots = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: scrapQueryKey }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
  };

  function closeTagManager() {
    if (tagSaving) return;
    setTagInput("");
    setTagError(null);
    setEditingTag(null);
    setDeleteTagName(null);
    onClose();
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
      onTagDeleted(deleteTagName, replacementTag);
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
      setTagError(translate("common.validation.labelNameRequired"));
      return;
    }
    setTagError(null);
    setTagSaving(true);
    try {
      if (editingTag) {
        await repository.renameTag(editingTag, tag);
        await invalidateSnapshots();
        onTagRenamed(editingTag, tag);
        setEditingTag(null);
      } else {
        await repository.addTag(tag);
        await queryClient.invalidateQueries({ queryKey: scrapQueryKey });
        onTagAdded(tag);
      }
      setTagInput("");
    } catch (error) {
      setTagError(errorMessage(error));
    } finally {
      setTagSaving(false);
    }
  }

  return (
    <>
      <Modal className="scrap-label-manager-modal" icon="label" onClose={closeTagManager} open={open} title={translate("common.labels.manage")}>
        <div className="scrap-label-manager">
          <div aria-label={translate("common.labels.current")} className="scrap-label-manager__list">
            {snapshot.tags.map((tag) => (
              <div className="scrap-label-manager__row" key={tag}>
                <strong>{tag}</strong>
                <span>{snapshot.items.filter((item) => item.tag === tag).length}{translate("common.unit.items")}</span>
                <IconButton aria-label={translate("common.action.editLabel", { name: tag })} disabled={tagSaving} onClick={() => editTag(tag)} size="small" title={translate("common.action.edit")} type="button" variant="ghost"><Icon name="edit" size={13} /></IconButton>
                <IconButton aria-label={tag === translate("common.label.other") ? translate("common.action.deleteDisabledLabel", { name: tag }) : translate("common.action.deleteLabel", { name: tag })} disabled={tagSaving || tag === translate("common.label.other")} onClick={() => openDeleteTag(tag)} size="small" title={tag === translate("common.label.other") ? translate("common.labels.otherDeleteDisabled") : translate("common.action.delete")} type="button" variant="ghost"><Icon name="trash" size={13} /></IconButton>
              </div>
            ))}
          </div>
          <form aria-busy={tagSaving} className="scrap-label-create" onSubmit={(event) => { event.preventDefault(); void commitTag(); }}>
            <div className="scrap-label-create__header">
              <strong>{editingTag ? translate("common.labels.edit") : translate("common.labels.new")}</strong>
              {editingTag && <button disabled={tagSaving} onClick={() => { setEditingTag(null); setTagInput(""); setTagError(null); }} type="button">{translate("common.action.cancel")}</button>}
            </div>
            <div className="scrap-label-create__controls">
              <Input aria-label={translate("common.labels.name")} autoFocus disabled={tagSaving} maxLength={100} onChange={(event) => setTagInput(event.target.value)} placeholder={translate("common.labels.name")} value={tagInput} />
              <Button loading={tagSaving} type="submit" variant="primary">{editingTag ? translate("common.action.save") : translate("common.action.add")}</Button>
            </div>
            {tagError && <div className="scrap-mutation-error" role="alert"><Icon name="alert" size={13} />{tagError}</div>}
          </form>
        </div>
      </Modal>

      <Modal
        className="scrap-label-delete-modal"
        footer={<><Button disabled={tagDeletePending} onClick={() => setDeleteTagName(null)}>{translate("common.action.cancel")}</Button><Button loading={tagDeletePending} onClick={() => void confirmDeleteTag()} variant="danger">{translate("common.action.delete")}</Button></>}
        icon="alert"
        onClose={() => { if (!tagDeletePending) setDeleteTagName(null); }}
        open={deleteTagName !== null}
        title={translate("common.labels.deleteTitle")}
      >
        <div className="scrap-label-delete">
          <p>{translate("common.labels.deleteQuestion", { name: deleteTagName ?? "" })}</p>
          <label>
            <span>{translate("scrap.labels.moveExisting")}</span>
            <Select
              disabled={tagDeletePending}
              label={translate("common.labels.moveTarget")}
              onChange={setReplacementTag}
              options={snapshot.tags.filter((tag) => tag !== deleteTagName).map((tag) => ({ value: tag, label: tag }))}
              value={replacementTag}
            />
          </label>
          <small>{translate("scrap.labels.moveDescription")}</small>
          {tagDeleteError && <div className="scrap-mutation-error" role="alert"><Icon name="alert" size={13} />{tagDeleteError}</div>}
        </div>
      </Modal>
    </>
  );
}
