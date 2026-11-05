import type { ScrapSnapshot } from "@mono/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { LabelDeleteModal, LabelManagerModal } from "../../components/LabelManagerModal";
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
      <LabelManagerModal
        busy={tagSaving}
        editing={editingTag !== null}
        error={tagError}
        icon="label"
        items={snapshot.tags.map((tag) => ({
          id: tag,
          name: tag,
          usageLabel: `${snapshot.items.filter((item) => item.tag === tag).length}${translate("common.unit.items")}`,
          deleteDisabledReason: tag === translate("common.label.other") ? translate("common.labels.otherDeleteDisabled") : undefined,
        }))}
        listLabel={translate("common.labels.current")}
        name={tagInput}
        onCancelEdit={() => { setEditingTag(null); setTagInput(""); setTagError(null); }}
        onClose={closeTagManager}
        onDelete={openDeleteTag}
        onEdit={editTag}
        onNameChange={setTagInput}
        onSubmit={(event) => { event.preventDefault(); void commitTag(); }}
        open={open}
      />

      <LabelDeleteModal
        busy={tagDeletePending}
        error={tagDeleteError}
        message={translate("common.labels.deleteQuestion", { name: deleteTagName ?? "" })}
        move={{
          label: translate("scrap.labels.moveExisting"),
          description: translate("scrap.labels.moveDescription"),
          options: snapshot.tags.filter((tag) => tag !== deleteTagName).map((tag) => ({ value: tag, label: tag })),
          value: replacementTag,
          onChange: setReplacementTag,
        }}
        onCancel={() => setDeleteTagName(null)}
        onConfirm={() => void confirmDeleteTag()}
        open={deleteTagName !== null}
      />
    </>
  );
}
