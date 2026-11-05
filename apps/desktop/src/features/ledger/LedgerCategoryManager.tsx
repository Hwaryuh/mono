import { ledgerCategoryWriteInputSchema, type LedgerCategory, type LedgerCategoryWriteInput, type LedgerSnapshot } from "@mono/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { LabelDeleteModal, LabelManagerModal, reorderedIds } from "../../components/LabelManagerModal";
import { translate } from "../../i18n/i18n";
import { errorMessage } from "../../i18n/error-message";
import { isConflictError } from "../../infrastructure/http/http-client";
import { resyncConflictVersion } from "../../infrastructure/http/conflict-recovery";
import { ledgerQueryKey } from "./LedgerPage";
import type { LedgerRepository } from "./ledger-repository";

type CategoryCommand =
  | { type: "create"; input: LedgerCategoryWriteInput }
  | { type: "update"; categoryId: string; input: LedgerCategoryWriteInput; expectedVersion: number }
  | { type: "reorder"; categoryIds: string[] }
  | { type: "delete"; categoryId: string };

const blankCategoryDraft: LedgerCategoryWriteInput = { name: "", color: "oklch(0.539 0.082 160.129)" };

/**
 * Manages ledger categories — runs the list/add/edit/reorder/delete pair of modals on its own state and mutations.
 * Only notifies the parent (LedgerPage) of create/delete results so the expense draft (draft.categoryId) can follow along.
 * Deleting moves the category's expenses to "other" on the server, so the delete confirm has no move target.
 */
export function LedgerCategoryManager({ open, onClose, snapshot, repository, onCategoryCreated, onCategoryDeleted }: {
  open: boolean;
  onClose: () => void;
  snapshot: LedgerSnapshot;
  repository: LedgerRepository;
  onCategoryCreated: (categoryId: string) => void;
  onCategoryDeleted: (categoryId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryVersion, setEditingCategoryVersion] = useState(1);
  const [categoryDraft, setCategoryDraft] = useState<LedgerCategoryWriteInput>(blankCategoryDraft);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [deleteCategoryId, setDeleteCategoryId] = useState<string | null>(null);

  // Resets every time it opens: what the old openCategoryManager did, plus the delete target the old closeModal cleared.
  useEffect(() => {
    if (open) { setEditingCategoryId(null); setCategoryDraft(blankCategoryDraft); setCategoryError(null); setDeleteCategoryId(null); }
  }, [open]);

  const invalidateSnapshots = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ledgerQueryKey }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
  };

  const categoryMutation = useMutation({
    mutationFn: async (command: CategoryCommand) => {
      if (command.type === "create") await repository.createCategory(command.input);
      else if (command.type === "update") await repository.updateCategory(command.categoryId, command.input, command.expectedVersion);
      else if (command.type === "reorder") await repository.reorderCategories(command.categoryIds);
      else await repository.deleteCategory(command.categoryId);
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
        onCategoryDeleted(command.categoryId);
      }
      await invalidateSnapshots();
      if (command.type === "create") {
        // ponytail: createCategory returns void; name is unique (dupes rejected), so match by name after the refetch above.
        const created = queryClient.getQueryData<LedgerSnapshot>(ledgerQueryKey)?.categories.find((category) => category.name === command.input.name);
        if (created) onCategoryCreated(created.id);
      }
    },
    onError: async (error) => {
      setCategoryError(errorMessage(error, "ledger.error.save"));
      if (isConflictError(error) && editingCategoryId) {
        const version = await resyncConflictVersion<LedgerSnapshot>(
          queryClient, ledgerQueryKey, invalidateSnapshots,
          (snapshot) => snapshot.categories.find((candidate) => candidate.id === editingCategoryId),
        );
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

  function editCategory(category: LedgerCategory) {
    setEditingCategoryId(category.id);
    setEditingCategoryVersion(category.version ?? 1);
    setCategoryDraft({ name: category.name, color: category.color });
    setCategoryError(null);
  }

  function submitCategory(event: FormEvent) {
    event.preventDefault();
    const parsed = ledgerCategoryWriteInputSchema.safeParse(categoryDraft);
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

  const deleteCategoryName = snapshot.categories.find((category) => category.id === deleteCategoryId)?.name ?? "";
  const fallbackCategoryName = snapshot.categories.find((category) => category.id === "other")?.name ?? translate("common.label.other");

  return (
    <>
      <LabelManagerModal
        autoFocusName={false}
        busy={categoryMutation.isPending}
        color={categoryDraft.color}
        editing={editingCategoryId !== null}
        error={categoryError}
        icon="wallet"
        items={snapshot.categories.map((category) => ({
          id: category.id,
          name: category.name,
          color: category.color,
          usageLabel: translate("ledger.categories.usageCount", { count: snapshot.expenses.filter((expense) => expense.categoryId === category.id).length }),
          deleteDisabledReason: category.id === "other" ? translate("common.labels.otherDeleteDisabled") : undefined,
        }))}
        listLabel={translate("inbox.labels.ledger")}
        name={categoryDraft.name}
        onCancelEdit={() => { setEditingCategoryId(null); setCategoryDraft(blankCategoryDraft); setCategoryError(null); }}
        onClose={closeCategoryManager}
        onColorChange={(color) => setCategoryDraft((current) => ({ ...current, color }))}
        onDelete={setDeleteCategoryId}
        onEdit={(categoryId) => { const category = snapshot.categories.find((candidate) => candidate.id === categoryId); if (category) editCategory(category); }}
        onMove={moveCategory}
        onNameChange={(name) => setCategoryDraft((current) => ({ ...current, name }))}
        onSubmit={submitCategory}
        open={open}
      />

      <LabelDeleteModal
        busy={categoryMutation.isPending}
        error={categoryError}
        message={snapshot.expenses.some((expense) => expense.categoryId === deleteCategoryId)
          ? translate("ledger.deleteCategory.confirmWithMove", { name: deleteCategoryName, fallback: fallbackCategoryName })
          : translate("ledger.deleteCategory.confirm", { name: deleteCategoryName })}
        onCancel={() => setDeleteCategoryId(null)}
        onConfirm={() => deleteCategoryId && categoryMutation.mutate({ type: "delete", categoryId: deleteCategoryId })}
        open={open && deleteCategoryId !== null}
      />
    </>
  );
}
