import { translate } from "../../i18n/i18n";
import { errorMessage } from "../../i18n/error-message";
import { todoLabelWriteInputSchema, type TodoLabel, type TodoLabelWriteInput, type TodoSnapshot } from "@mono/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { LabelDeleteModal, LabelManagerModal, reorderedIds } from "../../components/LabelManagerModal";
import { isConflictError } from "../../infrastructure/http/http-client";
import { resyncConflictVersion } from "../../infrastructure/http/conflict-recovery";
import type { TodoLabelRepository } from "./todo-repository";

type LabelCommand =
  | { type: "create"; input: TodoLabelWriteInput }
  | { type: "update"; labelId: string; input: TodoLabelWriteInput; expectedVersion: number }
  | { type: "reorder"; labelIds: string[] }
  | { type: "delete"; labelId: string; replacementLabelId: string };

const blankLabelDraft: TodoLabelWriteInput = { name: "", color: "oklch(0.539 0.082 160.129)" };

interface TodoLabelManagerModalProps {
  labels: TodoLabel[];
  onClose: () => void;
  onLabelCreated?: (labelId: string) => void;
  onLabelDeleted?: (labelId: string, replacementLabelId: string) => void;
  open: boolean;
  repository: TodoLabelRepository;
  usageCountOf?: (labelId: string) => number;
}

export function TodoLabelManagerModal({ labels, onClose, onLabelCreated, onLabelDeleted, open, repository, usageCountOf }: TodoLabelManagerModalProps) {
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [editingLabelVersion, setEditingLabelVersion] = useState(1);
  const [labelDraft, setLabelDraft] = useState<TodoLabelWriteInput>(blankLabelDraft);
  const [labelError, setLabelError] = useState<string | null>(null);
  const [labelFocusRequested, setLabelFocusRequested] = useState(false);
  const [deleteLabelId, setDeleteLabelId] = useState<string | null>(null);
  const [replacementLabelId, setReplacementLabelId] = useState("");
  const queryClient = useQueryClient();
  const labelMutation = useMutation({
    mutationFn: async (command: LabelCommand) => {
      if (command.type === "create") await repository.createLabel(command.input);
      else if (command.type === "update") await repository.updateLabel(command.labelId, command.input, command.expectedVersion);
      else if (command.type === "reorder") await repository.reorderLabels(command.labelIds);
      else await repository.deleteLabel(command.labelId, command.replacementLabelId);
    },
    onMutate: () => { setLabelError(null); setLabelFocusRequested(false); },
    onSuccess: async (_, command) => {
      if (command.type === "create") {
        setLabelDraft(blankLabelDraft);
        setLabelFocusRequested(true);
      }
      if (command.type === "update") {
        setEditingLabelId(null);
        setLabelDraft(blankLabelDraft);
        setLabelFocusRequested(true);
      }
      if (command.type === "delete") {
        setDeleteLabelId(null);
        setEditingLabelId((current) => current === command.labelId ? null : current);
        onLabelDeleted?.(command.labelId, command.replacementLabelId);
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["todo"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
        queryClient.invalidateQueries({ queryKey: ["routine"] }),
      ]);
      if (command.type === "create") {
        // ponytail: createLabel returns void; name is unique (dupes rejected), so match by name after the refetch above.
        const created = queryClient.getQueryData<TodoSnapshot>(["todo"])?.labels.find((label) => label.name === command.input.name);
        if (created) onLabelCreated?.(created.id);
      }
    },
    onError: async (error) => {
      setLabelError(errorMessage(error));
      setLabelFocusRequested(true);
      if (isConflictError(error) && editingLabelId) {
        const version = await resyncConflictVersion<TodoSnapshot>(
          queryClient, ["todo"],
          async () => {
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ["todo"] }),
              queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
              queryClient.invalidateQueries({ queryKey: ["routine"] }),
            ]);
          },
          (snapshot) => snapshot.labels.find((candidate) => candidate.id === editingLabelId),
        );
        if (version !== null) setEditingLabelVersion(version);
      }
    },
  });

  useEffect(() => {
    if (!open) return;
    setEditingLabelId(null);
    setEditingLabelVersion(1);
    setLabelDraft(blankLabelDraft);
    setLabelError(null);
    setLabelFocusRequested(false);
    setDeleteLabelId(null);
    setReplacementLabelId("");
  }, [open]);

  useEffect(() => {
    if (!open || labelMutation.isPending || !labelFocusRequested) return;
    document.querySelector<HTMLInputElement>("#todo-label-editor-form input")?.focus();
    setLabelFocusRequested(false);
  }, [labelFocusRequested, labelMutation.isPending, open]);

  function close() {
    if (labelMutation.isPending) return;
    setDeleteLabelId(null);
    onClose();
  }

  function editLabel(label: TodoLabel) {
    setEditingLabelId(label.id);
    setEditingLabelVersion(label.version ?? 1);
    setLabelDraft({ name: label.name, color: label.color });
    setLabelError(null);
  }

  function submitLabel(event: FormEvent) {
    event.preventDefault();
    const parsed = todoLabelWriteInputSchema.safeParse(labelDraft);
    if (!parsed.success) {
      setLabelError(parsed.error.issues[0]?.message ?? translate("common.validation.labelInvalid"));
      return;
    }
    if (editingLabelId) labelMutation.mutate({ type: "update", labelId: editingLabelId, input: parsed.data, expectedVersion: editingLabelVersion });
    else labelMutation.mutate({ type: "create", input: parsed.data });
  }

  function moveLabel(index: number, offset: -1 | 1) {
    const labelIds = reorderedIds(labels.map((label) => label.id), index, offset);
    if (labelIds) labelMutation.mutate({ type: "reorder", labelIds });
  }

  function openDeleteLabel(labelId: string) {
    const replacement = labels.find((label) => label.id !== labelId);
    if (!replacement) return;
    setDeleteLabelId(labelId);
    setReplacementLabelId(replacement.id);
    setLabelError(null);
  }

  return (
    <>
      <LabelManagerModal
        busy={labelMutation.isPending}
        color={labelDraft.color}
        editing={editingLabelId !== null}
        emptyMessage={translate("common.labels.empty")}
        error={labelError}
        formId="todo-label-editor-form"
        icon="label"
        items={labels.map((label) => ({
          id: label.id,
          name: label.name,
          color: label.color,
          usageLabel: `${usageCountOf?.(label.id) ?? 0}${translate("common.unit.items")}`,
          deleteDisabledReason: labels.length === 1 ? translate("common.labels.lastDeleteDisabled") : undefined,
        }))}
        listLabel={translate("common.labels.current")}
        name={labelDraft.name}
        onCancelEdit={() => { setEditingLabelId(null); setLabelDraft(blankLabelDraft); setLabelError(null); }}
        onClose={close}
        onColorChange={(color) => setLabelDraft((current) => ({ ...current, color }))}
        onDelete={openDeleteLabel}
        onEdit={(labelId) => { const label = labels.find((candidate) => candidate.id === labelId); if (label) editLabel(label); }}
        onMove={moveLabel}
        onNameChange={(name) => setLabelDraft((current) => ({ ...current, name }))}
        onSubmit={submitLabel}
        open={open}
      />

      <LabelDeleteModal
        busy={labelMutation.isPending}
        error={labelError}
        message={translate("common.labels.deleteQuestion", { name: labels.find((label) => label.id === deleteLabelId)?.name ?? "" })}
        move={{
          label: translate("todo.labels.moveExisting"),
          description: translate("todo.labels.moveDescription"),
          options: labels.filter((label) => label.id !== deleteLabelId).map((label) => ({ value: label.id, label: label.name, dotColor: label.color })),
          value: replacementLabelId,
          onChange: setReplacementLabelId,
        }}
        onCancel={() => setDeleteLabelId(null)}
        onConfirm={() => deleteLabelId && replacementLabelId && labelMutation.mutate({ type: "delete", labelId: deleteLabelId, replacementLabelId })}
        open={deleteLabelId !== null}
      />
    </>
  );
}
