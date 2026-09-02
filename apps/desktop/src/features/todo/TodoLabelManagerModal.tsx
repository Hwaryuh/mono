import { translate } from "../../i18n/i18n";
import { todoLabelWriteInputSchema, type TodoLabel, type TodoLabelWriteInput, type TodoSnapshot } from "@mono/contracts";
import { Button, ColorPicker, Icon, IconButton, Input, Modal, Select } from "@mono/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
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
  onLabelDeleted?: (labelId: string, replacementLabelId: string) => void;
  open: boolean;
  repository: TodoLabelRepository;
  usageCountOf?: (labelId: string) => number;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : translate("scrap.text.010");
}

export function TodoLabelManagerModal({ labels, onClose, onLabelDeleted, open, repository, usageCountOf }: TodoLabelManagerModalProps) {
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
      setLabelError(parsed.error.issues[0]?.message ?? translate("todoLabels.text.001"));
      return;
    }
    if (editingLabelId) labelMutation.mutate({ type: "update", labelId: editingLabelId, input: parsed.data, expectedVersion: editingLabelVersion });
    else labelMutation.mutate({ type: "create", input: parsed.data });
  }

  function moveLabel(index: number, offset: -1 | 1) {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= labels.length) return;
    const labelIds = labels.map((label) => label.id);
    [labelIds[index], labelIds[targetIndex]] = [labelIds[targetIndex], labelIds[index]];
    labelMutation.mutate({ type: "reorder", labelIds });
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
      <Modal className="todo-label-modal" icon="label" onClose={close} open={open} title={translate("scrap.text.042")}>
        <div className="todo-label-manager">
          <div aria-label={translate("scrap.text.043")} className="todo-label-manager__list">
            {labels.map((label, index) => (
              <div className="todo-label-manager__row" key={label.id}>
                <i style={{ backgroundColor: label.color }} />
                <strong>{label.name}</strong>
                <span>{usageCountOf?.(label.id) ?? 0}{translate("scrap.text.044")}</span>
                <div>
                  <IconButton aria-label={translate("todoLabels.text.002", { value1: label.name })} disabled={labelMutation.isPending || index === 0} onClick={() => moveLabel(index, -1)} size="small" title={translate("todoLabels.text.003")} type="button" variant="ghost"><Icon name="arrowUp" size={13} /></IconButton>
                  <IconButton aria-label={translate("todoLabels.text.004", { value1: label.name })} disabled={labelMutation.isPending || index === labels.length - 1} onClick={() => moveLabel(index, 1)} size="small" title={translate("todoLabels.text.005")} type="button" variant="ghost"><Icon name="arrowDown" size={13} /></IconButton>
                  <IconButton aria-label={translate("scrap.text.045", { value1: label.name })} disabled={labelMutation.isPending} onClick={() => editLabel(label)} size="small" title={translate("scrap.text.046")} type="button" variant="ghost"><Icon name="edit" size={13} /></IconButton>
                  <IconButton aria-label={labels.length === 1 ? translate("scrap.text.048", { value1: label.name }) : translate("scrap.text.049", { value1: label.name })} disabled={labelMutation.isPending || labels.length === 1} onClick={() => openDeleteLabel(label.id)} size="small" title={labels.length === 1 ? translate("todoLabels.text.006") : translate("settings.text.029")} type="button" variant="ghost"><Icon name="trash" size={13} /></IconButton>
                </div>
              </div>
            ))}
            {labels.length === 0 && <div className="todo-label-manager__empty">{translate("todoLabels.text.007")}</div>}
          </div>
          <form aria-busy={labelMutation.isPending} className="todo-label-create" id="todo-label-editor-form" onSubmit={submitLabel}>
            <div className="todo-label-create__header">
              <strong>{editingLabelId ? translate("scrap.text.051") : translate("scrap.text.052")}</strong>
              {editingLabelId && <button disabled={labelMutation.isPending} onClick={() => { setEditingLabelId(null); setLabelDraft(blankLabelDraft); setLabelError(null); }} type="button">{translate("scrap.text.025")}</button>}
            </div>
            <div className="todo-label-create__controls">
              <ColorPicker disabled={labelMutation.isPending} label={translate("todoLabels.text.008")} onChange={(color) => setLabelDraft((current) => ({ ...current, color }))} selected value={labelDraft.color} />
              <Input aria-label={translate("scrap.text.053")} autoFocus disabled={labelMutation.isPending} maxLength={100} onChange={(event) => setLabelDraft((current) => ({ ...current, name: event.target.value }))} placeholder={translate("scrap.text.053")} value={labelDraft.name} />
              <Button loading={labelMutation.isPending} type="submit" variant="primary">{editingLabelId ? translate("settings.text.021") : translate("scrap.text.054")}</Button>
            </div>
            {labelError && <div className="todo-label-create__error" role="alert"><Icon name="alert" size={13} />{labelError}</div>}
          </form>
        </div>
      </Modal>

      <Modal
        className="todo-label-delete-modal"
        footer={<><Button disabled={labelMutation.isPending} onClick={() => setDeleteLabelId(null)}>{translate("scrap.text.025")}</Button><Button loading={labelMutation.isPending} onClick={() => deleteLabelId && replacementLabelId && labelMutation.mutate({ type: "delete", labelId: deleteLabelId, replacementLabelId })} variant="danger">{translate("settings.text.029")}</Button></>}
        icon="alert"
        onClose={() => { if (!labelMutation.isPending) setDeleteLabelId(null); }}
        open={deleteLabelId !== null}
        title={translate("scrap.text.055")}
      >
        <div className="todo-label-delete">
          <p><strong>{labels.find((label) => label.id === deleteLabelId)?.name}</strong> {translate("scrap.text.056")}</p>
          <label>
            <span>{translate("todoLabels.text.009")}</span>
            <Select
              disabled={labelMutation.isPending}
              label={translate("scrap.text.058")}
              onChange={setReplacementLabelId}
              options={labels.filter((label) => label.id !== deleteLabelId).map((label) => ({ value: label.id, label: label.name, dotColor: label.color }))}
              value={replacementLabelId}
            />
          </label>
          <small>{translate("todoLabels.text.010")}</small>
          {labelError && <div className="todo-label-create__error" role="alert"><Icon name="alert" size={13} />{labelError}</div>}
        </div>
      </Modal>
    </>
  );
}
