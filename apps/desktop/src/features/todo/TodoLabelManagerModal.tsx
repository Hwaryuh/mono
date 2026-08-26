import { todoLabelWriteInputSchema, type TodoLabel, type TodoLabelWriteInput } from "@mono/contracts";
import { Button, ColorPicker, Icon, IconButton, Input, Modal, Select } from "@mono/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import type { TodoLabelRepository } from "./todo-repository";

type LabelCommand =
  | { type: "create"; input: TodoLabelWriteInput }
  | { type: "update"; labelId: string; input: TodoLabelWriteInput }
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
  return error instanceof Error ? error.message : "작업을 완료하지 못했습니다.";
}

export function TodoLabelManagerModal({ labels, onClose, onLabelDeleted, open, repository, usageCountOf }: TodoLabelManagerModalProps) {
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState<TodoLabelWriteInput>(blankLabelDraft);
  const [labelError, setLabelError] = useState<string | null>(null);
  const [labelFocusRequested, setLabelFocusRequested] = useState(false);
  const [deleteLabelId, setDeleteLabelId] = useState<string | null>(null);
  const [replacementLabelId, setReplacementLabelId] = useState("");
  const queryClient = useQueryClient();
  const labelMutation = useMutation({
    mutationFn: async (command: LabelCommand) => {
      if (command.type === "create") await repository.createLabel(command.input);
      else if (command.type === "update") await repository.updateLabel(command.labelId, command.input);
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
    onError: (error) => {
      setLabelError(errorMessage(error));
      setLabelFocusRequested(true);
    },
  });

  useEffect(() => {
    if (!open) return;
    setEditingLabelId(null);
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
    setLabelDraft({ name: label.name, color: label.color });
    setLabelError(null);
  }

  function submitLabel(event: FormEvent) {
    event.preventDefault();
    const parsed = todoLabelWriteInputSchema.safeParse(labelDraft);
    if (!parsed.success) {
      setLabelError(parsed.error.issues[0]?.message ?? "라벨 입력값을 확인해야 합니다.");
      return;
    }
    if (editingLabelId) labelMutation.mutate({ type: "update", labelId: editingLabelId, input: parsed.data });
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
      <Modal className="todo-label-modal" icon="label" onClose={close} open={open} title="라벨 관리">
        <div className="todo-label-manager">
          <div aria-label="현재 라벨" className="todo-label-manager__list">
            {labels.map((label, index) => (
              <div className="todo-label-manager__row" key={label.id}>
                <i style={{ backgroundColor: label.color }} />
                <strong>{label.name}</strong>
                <span>{usageCountOf?.(label.id) ?? 0}개</span>
                <div>
                  <IconButton aria-label={`${label.name} 위로 이동`} disabled={labelMutation.isPending || index === 0} onClick={() => moveLabel(index, -1)} size="small" title="위로 이동" type="button" variant="ghost"><Icon name="arrowUp" size={13} /></IconButton>
                  <IconButton aria-label={`${label.name} 아래로 이동`} disabled={labelMutation.isPending || index === labels.length - 1} onClick={() => moveLabel(index, 1)} size="small" title="아래로 이동" type="button" variant="ghost"><Icon name="arrowDown" size={13} /></IconButton>
                  <IconButton aria-label={`${label.name} 편집`} disabled={labelMutation.isPending} onClick={() => editLabel(label)} size="small" title="편집" type="button" variant="ghost"><Icon name="edit" size={13} /></IconButton>
                  <IconButton aria-label={labels.length === 1 ? `${label.name} 삭제 불가` : `${label.name} 삭제`} disabled={labelMutation.isPending || labels.length === 1} onClick={() => openDeleteLabel(label.id)} size="small" title={labels.length === 1 ? "마지막 라벨은 삭제할 수 없습니다" : "삭제"} type="button" variant="ghost"><Icon name="trash" size={13} /></IconButton>
                </div>
              </div>
            ))}
            {labels.length === 0 && <div className="todo-label-manager__empty">등록된 라벨이 없습니다.</div>}
          </div>
          <form aria-busy={labelMutation.isPending} className="todo-label-create" id="todo-label-editor-form" onSubmit={submitLabel}>
            <div className="todo-label-create__header">
              <strong>{editingLabelId ? "라벨 수정" : "새 라벨"}</strong>
              {editingLabelId && <button disabled={labelMutation.isPending} onClick={() => { setEditingLabelId(null); setLabelDraft(blankLabelDraft); setLabelError(null); }} type="button">취소</button>}
            </div>
            <div className="todo-label-create__controls">
              <ColorPicker disabled={labelMutation.isPending} label="라벨 색상" onChange={(color) => setLabelDraft((current) => ({ ...current, color }))} selected value={labelDraft.color} />
              <Input aria-label="라벨 이름" autoFocus disabled={labelMutation.isPending} maxLength={100} onChange={(event) => setLabelDraft((current) => ({ ...current, name: event.target.value }))} placeholder="라벨 이름" value={labelDraft.name} />
              <Button loading={labelMutation.isPending} type="submit" variant="primary">{editingLabelId ? "저장" : "추가"}</Button>
            </div>
            {labelError && <div className="todo-label-create__error" role="alert"><Icon name="alert" size={13} />{labelError}</div>}
          </form>
        </div>
      </Modal>

      <Modal
        className="todo-label-delete-modal"
        footer={<><Button disabled={labelMutation.isPending} onClick={() => setDeleteLabelId(null)}>취소</Button><Button loading={labelMutation.isPending} onClick={() => deleteLabelId && replacementLabelId && labelMutation.mutate({ type: "delete", labelId: deleteLabelId, replacementLabelId })} variant="danger">삭제</Button></>}
        icon="alert"
        onClose={() => { if (!labelMutation.isPending) setDeleteLabelId(null); }}
        open={deleteLabelId !== null}
        title="라벨 삭제"
      >
        <div className="todo-label-delete">
          <p><strong>{labels.find((label) => label.id === deleteLabelId)?.name}</strong> 라벨을 삭제할까요?</p>
          <label>
            <span>기존 할 일 이동</span>
            <Select
              disabled={labelMutation.isPending}
              label="이동할 라벨"
              onChange={setReplacementLabelId}
              options={labels.filter((label) => label.id !== deleteLabelId).map((label) => ({ value: label.id, label: label.name, dotColor: label.color }))}
              value={replacementLabelId}
            />
          </label>
          <small>일반 할 일과 반복 할 일 모두 선택한 라벨로 이동합니다.</small>
          {labelError && <div className="todo-label-create__error" role="alert"><Icon name="alert" size={13} />{labelError}</div>}
        </div>
      </Modal>
    </>
  );
}
