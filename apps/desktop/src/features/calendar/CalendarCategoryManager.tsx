import { calendarCategoryWriteInputSchema, type CalendarCategory, type CalendarCategoryWriteInput, type CalendarSnapshot } from "@mono/contracts";
import { Button, ColorPicker, Icon, IconButton, Input, Modal, Select } from "@mono/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { translate } from "../../i18n/i18n";
import { errorMessage } from "../../i18n/error-message";
import { isConflictError } from "../../infrastructure/http/http-client";
import { calendarQueryKey } from "./CalendarPage";
import type { CalendarRepository } from "./calendar-repository";

const blankCategoryDraft: CalendarCategoryWriteInput = { name: "", color: "oklch(0.604 0.149 260.322)" };

type CategoryCommand =
  | { type: "create"; input: CalendarCategoryWriteInput }
  | { type: "update"; categoryId: string; input: CalendarCategoryWriteInput; expectedVersion: number }
  | { type: "reorder"; categoryIds: string[] }
  | { type: "delete"; categoryId: string; replacementCategoryId: string };

/**
 * Manages calendar categories — runs the list/add/edit/reorder/delete pair of modals on its own state and mutations.
 * It also handles optimistic version-conflict recovery here, and only notifies the parent (CalendarPage) of
 * create/delete results so the in-progress event draft (draft.categoryId) can follow along.
 */
export function CalendarCategoryManager({ open, onClose, snapshot, repository, onCategoryCreated, onCategoryDeleted }: {
  open: boolean;
  onClose: () => void;
  snapshot: CalendarSnapshot;
  repository: CalendarRepository;
  onCategoryCreated: (category: CalendarCategory) => void;
  onCategoryDeleted: (categoryId: string, replacementCategoryId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryVersion, setEditingCategoryVersion] = useState(1);
  const [categoryDraft, setCategoryDraft] = useState<CalendarCategoryWriteInput>(blankCategoryDraft);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [deleteCategoryId, setDeleteCategoryId] = useState<string | null>(null);
  const [replacementCategoryId, setReplacementCategoryId] = useState("");

  // Resets the edit state every time it opens (what the old openCategoryManager used to do).
  useEffect(() => {
    if (open) { setEditingCategoryId(null); setCategoryDraft(blankCategoryDraft); setCategoryError(null); }
  }, [open]);

  const invalidateSnapshots = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: calendarQueryKey }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
  };
  // The snapshot query key carries the displayed range, so it can't be read with a fixed key — after invalidation, look it up among the cached ranges.
  const resyncCalendarVersion = async (pick: (snapshot: CalendarSnapshot) => { version?: number } | undefined): Promise<number | null> => {
    await invalidateSnapshots();
    for (const [, snapshot] of queryClient.getQueriesData<CalendarSnapshot>({ queryKey: calendarQueryKey })) {
      const found = snapshot && pick(snapshot);
      if (found) return found.version ?? null;
    }
    return null;
  };

  const categoryMutation = useMutation({
    mutationFn: async (command: CategoryCommand) => {
      if (command.type === "create") await repository.createCategory(command.input);
      else if (command.type === "update") await repository.updateCategory(command.categoryId, command.input, command.expectedVersion);
      else if (command.type === "reorder") await repository.reorderCategories(command.categoryIds);
      else await repository.deleteCategory(command.categoryId, command.replacementCategoryId);
    },
    onMutate: () => setCategoryError(null),
    onSuccess: async (_, command) => {
      if (command.type === "create") setCategoryDraft(blankCategoryDraft);
      if (command.type === "update") {
        setEditingCategoryId(null);
        setCategoryDraft(blankCategoryDraft);
      }
      if (command.type === "delete") {
        setDeleteCategoryId(null);
        setEditingCategoryId((current) => current === command.categoryId ? null : current);
        onCategoryDeleted(command.categoryId, command.replacementCategoryId);
      }
      await invalidateSnapshots();
      if (command.type === "create") {
        // ponytail: createCategory returns void; name is unique (dupes rejected), so match by name after the refetch above.
        const created = queryClient.getQueriesData<CalendarSnapshot>({ queryKey: calendarQueryKey })
          .map(([, snapshot]) => snapshot?.categories.find((category) => category.name === command.input.name))
          .find(Boolean);
        if (created) onCategoryCreated(created);
      }
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>("#calendar-category-editor input")?.focus());
    },
    onError: async (error) => {
      setCategoryError(errorMessage(error));
      if (isConflictError(error) && editingCategoryId) {
        const version = await resyncCalendarVersion((snapshot) => snapshot.categories.find((candidate) => candidate.id === editingCategoryId));
        if (version !== null) setEditingCategoryVersion(version);
      }
    },
  });

  function closeCategoryManager() {
    if (categoryMutation.isPending) return;
    setEditingCategoryId(null);
    setDeleteCategoryId(null);
    setCategoryError(null);
    onClose();
  }

  function editCategory(category: CalendarCategory) {
    setEditingCategoryId(category.id);
    setEditingCategoryVersion(category.version ?? 1);
    setCategoryDraft({ name: category.name, color: category.color });
    setCategoryError(null);
  }

  function submitCategory(event: FormEvent) {
    event.preventDefault();
    const parsed = calendarCategoryWriteInputSchema.safeParse(categoryDraft);
    if (!parsed.success) {
      setCategoryError(parsed.error.issues[0]?.message ?? translate("common.validation.labelInvalid"));
      return;
    }
    if (editingCategoryId) categoryMutation.mutate({ type: "update", categoryId: editingCategoryId, input: parsed.data, expectedVersion: editingCategoryVersion });
    else categoryMutation.mutate({ type: "create", input: parsed.data });
  }

  function moveCategory(index: number, offset: -1 | 1) {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= snapshot.categories.length) return;
    const categoryIds = snapshot.categories.map((category) => category.id);
    [categoryIds[index], categoryIds[targetIndex]] = [categoryIds[targetIndex], categoryIds[index]];
    categoryMutation.mutate({ type: "reorder", categoryIds });
  }

  function openDeleteCategory(categoryId: string) {
    const replacement = snapshot.categories.find((category) => category.id !== categoryId);
    if (!replacement) return;
    setDeleteCategoryId(categoryId);
    setReplacementCategoryId(replacement.id);
    setCategoryError(null);
  }

  return (
    <>
      <Modal className="calendar-category-modal" icon="calendar" onClose={closeCategoryManager} open={open} title={translate("common.labels.manage")}>
        <div className="calendar-category-manager">
          <div aria-label={translate("inbox.labels.calendar")} className="calendar-category-manager__list">
            {snapshot.categories.map((category, index) => {
              const usageCount = snapshot.events.filter((event) => event.categoryId === category.id).length;
              return (
                <div className="calendar-category-manager__row" key={category.id}>
                  <i style={{ backgroundColor: category.color }} />
                  <strong>{category.name}</strong>
                  <span>{usageCount}{translate("common.unit.items")}</span>
                  <div>
                    <IconButton aria-label={translate("common.action.moveUpLabel", { name: category.name })} disabled={categoryMutation.isPending || index === 0} onClick={() => moveCategory(index, -1)} size="small" title={translate("common.action.moveUp")} type="button" variant="ghost"><Icon name="arrowUp" size={13} /></IconButton>
                    <IconButton aria-label={translate("common.action.moveDownLabel", { name: category.name })} disabled={categoryMutation.isPending || index === snapshot.categories.length - 1} onClick={() => moveCategory(index, 1)} size="small" title={translate("common.action.moveDown")} type="button" variant="ghost"><Icon name="arrowDown" size={13} /></IconButton>
                    <IconButton aria-label={translate("common.action.editLabel", { name: category.name })} disabled={categoryMutation.isPending} onClick={() => editCategory(category)} size="small" title={translate("common.action.edit")} type="button" variant="ghost"><Icon name="edit" size={13} /></IconButton>
                    <IconButton aria-label={snapshot.categories.length === 1 ? translate("common.action.deleteDisabledLabel", { name: category.name }) : translate("common.action.deleteLabel", { name: category.name })} disabled={categoryMutation.isPending || snapshot.categories.length === 1} onClick={() => openDeleteCategory(category.id)} size="small" title={snapshot.categories.length === 1 ? translate("common.labels.lastDeleteDisabled") : translate("common.action.delete")} type="button" variant="ghost"><Icon name="trash" size={13} /></IconButton>
                  </div>
                </div>
              );
            })}
          </div>
          <form aria-busy={categoryMutation.isPending} className="calendar-category-editor" id="calendar-category-editor" onSubmit={submitCategory}>
            <div className="calendar-category-editor__header">
              <strong>{editingCategoryId ? translate("common.labels.edit") : translate("common.labels.new")}</strong>
              {editingCategoryId && <button disabled={categoryMutation.isPending} onClick={() => { setEditingCategoryId(null); setCategoryDraft(blankCategoryDraft); setCategoryError(null); }} type="button">{translate("common.action.cancel")}</button>}
            </div>
            <div className="calendar-category-editor__controls">
              <ColorPicker disabled={categoryMutation.isPending} label={translate("common.labels.color")} onChange={(color) => setCategoryDraft((current) => ({ ...current, color }))} selected value={categoryDraft.color} />
              <Input aria-label={translate("common.labels.name")} autoFocus disabled={categoryMutation.isPending} maxLength={100} onChange={(event) => setCategoryDraft((current) => ({ ...current, name: event.target.value }))} placeholder={translate("common.labels.name")} value={categoryDraft.name} />
              <Button loading={categoryMutation.isPending} type="submit" variant="primary">{editingCategoryId ? translate("common.action.save") : translate("common.action.add")}</Button>
            </div>
            {categoryError && <div className="calendar-category-error" role="alert"><Icon name="alert" size={13} />{categoryError}</div>}
          </form>
        </div>
      </Modal>

      <Modal
        className="calendar-category-delete-modal"
        footer={<><Button disabled={categoryMutation.isPending} onClick={() => setDeleteCategoryId(null)}>{translate("common.action.cancel")}</Button><Button loading={categoryMutation.isPending} onClick={() => deleteCategoryId && replacementCategoryId && categoryMutation.mutate({ type: "delete", categoryId: deleteCategoryId, replacementCategoryId })} variant="danger">{translate("common.action.delete")}</Button></>}
        icon="alert"
        onClose={() => { if (!categoryMutation.isPending) setDeleteCategoryId(null); }}
        open={deleteCategoryId !== null}
        title={translate("common.labels.deleteTitle")}
      >
        <div className="calendar-category-delete">
          <p>{translate("common.labels.deleteQuestion", { name: snapshot.categories.find((category) => category.id === deleteCategoryId)?.name ?? "" })}</p>
          <label>
            <span>{translate("calendar.labels.moveExisting")}</span>
            <Select disabled={categoryMutation.isPending} label={translate("common.labels.moveTarget")} onChange={setReplacementCategoryId} options={snapshot.categories.filter((category) => category.id !== deleteCategoryId).map((category) => ({ value: category.id, label: category.name, dotColor: category.color }))} value={replacementCategoryId} />
          </label>
          <small>{translate("calendar.labels.moveExistingDescription")}</small>
          {categoryError && <div className="calendar-category-error" role="alert"><Icon name="alert" size={13} />{categoryError}</div>}
        </div>
      </Modal>
    </>
  );
}
