import { calendarCategoryWriteInputSchema, type CalendarCategory, type CalendarCategoryWriteInput, type CalendarSnapshot } from "@mono/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { LabelDeleteModal, LabelManagerModal, reorderedIds } from "../../components/LabelManagerModal";
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
    const categoryIds = reorderedIds(snapshot.categories.map((category) => category.id), index, offset);
    if (categoryIds) categoryMutation.mutate({ type: "reorder", categoryIds });
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
      <LabelManagerModal
        busy={categoryMutation.isPending}
        color={categoryDraft.color}
        editing={editingCategoryId !== null}
        error={categoryError}
        formId="calendar-category-editor"
        icon="calendar"
        items={snapshot.categories.map((category) => ({
          id: category.id,
          name: category.name,
          color: category.color,
          usageLabel: `${snapshot.events.filter((event) => event.categoryId === category.id).length}${translate("common.unit.items")}`,
          deleteDisabledReason: snapshot.categories.length === 1 ? translate("common.labels.lastDeleteDisabled") : undefined,
        }))}
        listLabel={translate("inbox.labels.calendar")}
        name={categoryDraft.name}
        onCancelEdit={() => { setEditingCategoryId(null); setCategoryDraft(blankCategoryDraft); setCategoryError(null); }}
        onClose={closeCategoryManager}
        onColorChange={(color) => setCategoryDraft((current) => ({ ...current, color }))}
        onDelete={openDeleteCategory}
        onEdit={(categoryId) => { const category = snapshot.categories.find((candidate) => candidate.id === categoryId); if (category) editCategory(category); }}
        onMove={moveCategory}
        onNameChange={(name) => setCategoryDraft((current) => ({ ...current, name }))}
        onSubmit={submitCategory}
        open={open}
      />

      <LabelDeleteModal
        busy={categoryMutation.isPending}
        error={categoryError}
        message={translate("common.labels.deleteQuestion", { name: snapshot.categories.find((category) => category.id === deleteCategoryId)?.name ?? "" })}
        move={{
          label: translate("calendar.labels.moveExisting"),
          description: translate("calendar.labels.moveExistingDescription"),
          options: snapshot.categories.filter((category) => category.id !== deleteCategoryId).map((category) => ({ value: category.id, label: category.name, dotColor: category.color })),
          value: replacementCategoryId,
          onChange: setReplacementCategoryId,
        }}
        onCancel={() => setDeleteCategoryId(null)}
        onConfirm={() => deleteCategoryId && replacementCategoryId && categoryMutation.mutate({ type: "delete", categoryId: deleteCategoryId, replacementCategoryId })}
        open={deleteCategoryId !== null}
      />
    </>
  );
}
