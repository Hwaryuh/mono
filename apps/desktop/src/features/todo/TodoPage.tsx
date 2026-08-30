import { type TodoItem, type TodoLabel, type TodoSnapshot, type TodoWriteInput } from "@mono/contracts";
import { Button, Checkbox, DatePicker, Icon, Input, Modal, Select, TextArea, TimePicker, type IconName } from "@mono/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { TodoLabelManagerModal } from "./TodoLabelManagerModal";
import type { TodoRepository } from "./todo-repository";

export const todoQueryKey = ["todo"] as const;
const dashboardQueryKey = ["dashboard"] as const;
const statusOrder = ["all", "today", "upcoming", "overdue", "done"] as const;
type TodoStatus = (typeof statusOrder)[number];

type Draft = {
  title: string;
  labelId: string;
  dueDate: string;
  dueTime: string;
  note: string;
};

const statusMeta: Record<TodoStatus, { name: string; title: string; icon: IconName }> = {
  all: { name: "전체", title: "전체 할 일", icon: "layers" },
  today: { name: "오늘", title: "오늘 할 일", icon: "clock" },
  upcoming: { name: "예정", title: "예정된 할 일", icon: "calendar" },
  overdue: { name: "지연", title: "지연된 할 일", icon: "alert" },
  done: { name: "완료", title: "완료된 할 일", icon: "check" },
};

function statusOf(item: TodoItem, today: string): TodoStatus {
  if (item.done) return "done";
  if (item.dueDate === today) return "today";
  if (item.dueDate && item.dueDate < today) return "overdue";
  return "upcoming";
}

// 하루 이상 지난 완료 항목은 "전체"에서 숨기고 "완료" 탭에만 남긴다.
function isAgedDone(item: TodoItem, now: number): boolean {
  if (!item.done || !item.completedAt) return false;
  const completed = Date.parse(item.completedAt);
  return !Number.isNaN(completed) && now - completed >= 86_400_000;
}

function blankDraft(labels: TodoLabel[]): Draft {
  return { title: "", labelId: labels[0]?.id ?? "", dueDate: "", dueTime: "", note: "" };
}

function draftOf(item: TodoItem): Draft {
  return {
    title: item.title,
    labelId: item.labelId,
    dueDate: item.dueDate ?? "",
    dueTime: item.dueTime ?? "",
    note: item.note,
  };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "작업을 완료하지 못했습니다.";
}

export function TodoPage({ repository }: { repository: TodoRepository }) {
  const [status, setStatus] = useState<TodoStatus>("all");
  const [labelIds, setLabelIds] = useState<string[]>([]);
  const [editorItem, setEditorItem] = useState<TodoItem | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>({ title: "", labelId: "", dueDate: "", dueTime: "", note: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [labelManagerOpen, setLabelManagerOpen] = useState(false);
  const handledNewParamRef = useRef(false);
  const focusAfterDeleteRef = useRef(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const snapshotQuery = useQuery({ queryKey: todoQueryKey, queryFn: () => repository.getSnapshot() });

  const invalidateSnapshots = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: todoQueryKey }),
      queryClient.invalidateQueries({ queryKey: dashboardQueryKey }),
    ]);
  };
  const createMutation = useMutation({
    mutationFn: (input: TodoWriteInput) => repository.create(input),
    onMutate: () => setFormError(null),
    onSuccess: async () => { await invalidateSnapshots(); closeEditor(true); },
    onError: (error) => setFormError(errorMessage(error)),
  });
  const updateMutation = useMutation({
    mutationFn: ({ itemId, input }: { itemId: string; input: TodoWriteInput }) => repository.update(itemId, input),
    onMutate: () => setFormError(null),
    onSuccess: async () => { await invalidateSnapshots(); closeEditor(true); },
    onError: (error) => setFormError(errorMessage(error)),
  });
  const deleteMutation = useMutation({
    mutationFn: (itemId: string) => repository.delete(itemId),
    onMutate: () => setFormError(null),
    onSuccess: async () => {
      focusAfterDeleteRef.current = true;
      setDeleteOpen(false);
      setEditorItem(null);
      await invalidateSnapshots();
    },
    onError: (error) => setFormError(errorMessage(error)),
  });

  useEffect(() => {
    const loadedSnapshot = snapshotQuery.data;
    if (searchParams.get("modal") !== "new") {
      handledNewParamRef.current = false;
      return;
    }
    if (!loadedSnapshot || editorItem || handledNewParamRef.current) return;
    handledNewParamRef.current = true;
    setDraft(blankDraft(loadedSnapshot.labels));
    setFormError(null);
    setEditorItem("new");
  }, [editorItem, searchParams, snapshotQuery.data]);
  useEffect(() => {
    if (!focusAfterDeleteRef.current || editorItem || deleteOpen) return;
    focusAfterDeleteRef.current = false;
    document.querySelector<HTMLButtonElement>(`[data-todo-status="${status}"]`)?.focus();
  }, [deleteOpen, editorItem, snapshotQuery.data, status]);

  if (snapshotQuery.isPending) return <TodoLoading />;
  if (snapshotQuery.isError) return <div className="todo-state" role="alert"><Icon name="alert" size={18} />할 일을 불러오지 못했습니다.</div>;
  const snapshot = snapshotQuery.data;

  const now = Date.now();
  const counts = Object.fromEntries(statusOrder.map((statusId) => [
    statusId,
    statusId === "all"
      ? snapshot.items.filter((item) => !isAgedDone(item, now)).length
      : snapshot.items.filter((item) => statusOf(item, snapshot.today) === statusId).length,
  ])) as Record<TodoStatus, number>;
  const visibleItems = snapshot.items.filter((item) => {
    const statusMatches = status === "all" ? !isAgedDone(item, now) : statusOf(item, snapshot.today) === status;
    return statusMatches && (labelIds.length === 0 || labelIds.includes(item.labelId));
  });
  const title = labelIds.length > 0 ? "필터링된 할 일" : statusMeta[status].title;
  const activeEditorItem = editorItem === "new" || editorItem === null ? null : editorItem;
  const editorBusy = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  function selectStatus(nextStatus: TodoStatus, focus = false) {
    setStatus(nextStatus);
    if (focus) document.querySelector<HTMLButtonElement>(`[data-todo-status="${nextStatus}"]`)?.focus();
  }

  function onStatusKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: TodoStatus) {
    const index = statusOrder.indexOf(current);
    let next: TodoStatus | undefined;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = statusOrder[(index + 1) % statusOrder.length];
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = statusOrder[(index - 1 + statusOrder.length) % statusOrder.length];
    if (event.key === "Home") next = statusOrder[0];
    if (event.key === "End") next = statusOrder[statusOrder.length - 1];
    if (!next) return;
    event.preventDefault();
    selectStatus(next, true);
  }

  function toggleLabel(labelId: string, focus = false) {
    setLabelIds((current) => current.includes(labelId) ? current.filter((id) => id !== labelId) : [...current, labelId]);
    if (focus) requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-todo-label="${labelId}"]`)?.focus());
  }

  function onLabelKeyDown(event: KeyboardEvent<HTMLButtonElement>, labelId: string) {
    if (!snapshot) return;
    const index = snapshot.labels.findIndex((label) => label.id === labelId);
    let next: TodoLabel | undefined;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = snapshot.labels[(index + 1) % snapshot.labels.length];
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = snapshot.labels[(index - 1 + snapshot.labels.length) % snapshot.labels.length];
    if (!next) return;
    event.preventDefault();
    document.querySelector<HTMLButtonElement>(`[data-todo-label="${next.id}"]`)?.focus();
  }

  function openCreate() {
    setDraft(blankDraft(snapshot.labels));
    setFormError(null);
    setEditorItem("new");
    setSearchParams({ modal: "new" }, { replace: true });
  }

  function openLabelManager() {
    setLabelManagerOpen(true);
  }

  function closeLabelManager() {
    setLabelManagerOpen(false);
  }

  function openEditor(item: TodoItem) {
    setDraft(draftOf(item));
    setFormError(null);
    setEditorItem(item);
    setSearchParams({}, { replace: true });
  }

  function closeEditor(force = false) {
    if (editorBusy && !force) return;
    setEditorItem(null);
    setDeleteOpen(false);
    setFormError(null);
    if (searchParams.has("modal")) setSearchParams({}, { replace: true });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const input: TodoWriteInput = {
      title: draft.title.trim(),
      labelId: draft.labelId,
      dueDate: draft.dueDate || null,
      dueTime: draft.dueDate && draft.dueTime ? draft.dueTime : null,
      note: draft.note.trim(),
    };
    if (!input.title) { setFormError("제목을 입력해야 합니다."); return; }
    if (!input.labelId) { setFormError("라벨을 선택해야 합니다."); return; }
    if (editorItem === "new") createMutation.mutate(input);
    else if (editorItem) updateMutation.mutate({ itemId: editorItem.id, input });
  }

  return (
    <div className="todo-page">
      <aside aria-label="할 일 필터" className="todo-filters">
        <fieldset className="todo-filter-group">
          <legend>상태</legend>
          {statusOrder.map((statusId) => {
            const meta = statusMeta[statusId];
            return (
              <button
                aria-checked={status === statusId}
                className={status === statusId ? "todo-filter todo-filter--active" : "todo-filter"}
                data-todo-status={statusId}
                key={statusId}
                onClick={() => selectStatus(statusId)}
                onKeyDown={(event) => onStatusKeyDown(event, statusId)}
                role="radio"
                tabIndex={status === statusId ? 0 : -1}
                type="button"
              >
                <Icon name={meta.icon} size={13} /><span>{meta.name}</span><small>{counts[statusId]}</small>
              </button>
            );
          })}
        </fieldset>
        <fieldset className="todo-filter-group todo-filter-group--labels">
          <legend>
            <span>라벨</span>
            <button aria-label="라벨 관리" className="todo-label-manage-trigger" onClick={openLabelManager} type="button">관리</button>
          </legend>
          {snapshot.labels.map((label) => {
            const selected = labelIds.includes(label.id);
            return (
              <button
                aria-pressed={selected}
                className={selected ? "todo-filter todo-filter--active" : "todo-filter"}
                data-todo-label={label.id}
                key={label.id}
                onClick={() => toggleLabel(label.id)}
                onKeyDown={(event) => onLabelKeyDown(event, label.id)}
                type="button"
              >
                <span className="todo-filter__dot" style={{ backgroundColor: label.color }} /><span>{label.name}</span>
                <small>{snapshot.items.filter((item) => item.labelId === label.id && !item.done).length}</small>
              </button>
            );
          })}
        </fieldset>
      </aside>

      <section className="todo-content">
        <header className="todo-list-header">
          <strong>{title}</strong><span>{visibleItems.length}개</span>
          {labelIds.map((labelId) => {
            const label = snapshot.labels.find((candidate) => candidate.id === labelId);
            return label && (
              <button aria-label={`${label.name} 필터 해제`} className="todo-active-filter" key={label.id} onClick={() => toggleLabel(label.id)} type="button">
                <span style={{ backgroundColor: label.color }} />{label.name}<Icon name="close" size={10} strokeWidth={2.6} />
              </button>
            );
          })}
        </header>
        <div className="todo-list">
          {visibleItems.map((item) => {
            const label = snapshot.labels.find((candidate) => candidate.id === item.labelId) ?? snapshot.labels[0];
            return <TodoRow item={item} key={item.id} label={label} onOpen={() => item.routineId ? navigate(`/routine?modal=edit&id=${encodeURIComponent(item.routineId)}`) : openEditor(item)} repository={repository} snapshot={snapshot} />;
          })}
          {visibleItems.length === 0 && snapshot.items.length > 0 && (
            <div className="todo-empty"><Icon name="todo" size={26} /><strong>조건에 맞는 할 일이 없습니다</strong><span>필터를 해제하거나 새 할 일을 만드세요.</span></div>
          )}
          {snapshot.items.length === 0 && (
            <div className="todo-empty"><Icon name="todo" size={26} /><strong>아직 할 일이 없습니다</strong><span>첫 할 일을 만들어 시작하세요.</span><Button onClick={openCreate} variant="primary">새 할 일</Button></div>
          )}
        </div>
      </section>

      <Modal
        className="todo-editor-modal"
        footer={<>
          {activeEditorItem && <Button className="todo-editor__delete" disabled={editorBusy} onClick={(event) => { event.currentTarget.focus(); setFormError(null); setDeleteOpen(true); }} variant="ghost">삭제</Button>}
          <Button disabled={editorBusy} onClick={() => closeEditor()}>취소</Button>
          <Button form="todo-editor-form" loading={createMutation.isPending || updateMutation.isPending} type="submit" variant="primary">{editorItem === "new" ? "생성" : "저장"}</Button>
        </>}
        icon="todo"
        onClose={closeEditor}
        open={editorItem !== null}
        title={editorItem === "new" ? "새 할 일" : "할 일 수정"}
      >
        <form className="todo-editor" id="todo-editor-form" onSubmit={submit}>
          <label><span>제목 <b>필수</b></span><Input autoFocus maxLength={500} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} value={draft.title} /></label>
          <div className="todo-editor__field">
            <div className="todo-editor__label-legend"><span>라벨</span><button onClick={openLabelManager} type="button">관리</button></div>
            <Select
              label="라벨"
              onChange={(labelId) => setDraft((current) => ({ ...current, labelId }))}
              options={snapshot.labels.map((label) => ({ value: label.id, label: label.name, dotColor: label.color }))}
              value={draft.labelId}
            />
          </div>
          <div className="todo-editor__due">
            <fieldset><legend>마감일</legend><DatePicker label="마감일" onChange={(dueDate) => setDraft((current) => ({ ...current, dueDate, dueTime: dueDate ? current.dueTime : "" }))} value={draft.dueDate} /></fieldset>
            <label><span>시간</span><TimePicker disabled={!draft.dueDate} label="마감 시간" onChange={(dueTime) => setDraft((current) => ({ ...current, dueTime }))} value={draft.dueTime} /></label>
          </div>
          <label><span>메모</span><TextArea onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} rows={4} value={draft.note} /></label>
          {formError && !deleteOpen && <div className="todo-mutation-error" role="alert"><Icon name="alert" size={13} />{formError}</div>}
        </form>
      </Modal>

      <TodoLabelManagerModal
        labels={snapshot.labels}
        onClose={closeLabelManager}
        onLabelDeleted={(labelId, replacementLabelId) => {
          setLabelIds((current) => current.filter((candidate) => candidate !== labelId));
          setDraft((current) => current.labelId === labelId ? { ...current, labelId: replacementLabelId } : current);
        }}
        open={labelManagerOpen}
        repository={repository}
        usageCountOf={(labelId) => snapshot.items.filter((item) => item.labelId === labelId).length}
      />

      <Modal
        className="todo-delete-modal"
        footer={<><Button autoFocus disabled={deleteMutation.isPending} onClick={() => setDeleteOpen(false)}>취소</Button><Button loading={deleteMutation.isPending} onClick={() => activeEditorItem && deleteMutation.mutate(activeEditorItem.id)} variant="danger">삭제</Button></>}
        icon="alert"
        onClose={() => { if (!deleteMutation.isPending) setDeleteOpen(false); }}
        open={deleteOpen}
        title="이 할 일을 삭제할까요?"
      >
        <p>삭제한 할 일은 복구할 수 없습니다.</p>
        <blockquote>{activeEditorItem?.title}</blockquote>
        {formError && <div className="todo-mutation-error" role="alert"><Icon name="alert" size={13} />{formError}</div>}
      </Modal>
    </div>
  );
}

function TodoRow({ item, label, snapshot, repository, onOpen }: { item: TodoItem; label: TodoLabel; snapshot: TodoSnapshot; repository: TodoRepository; onOpen: () => void }) {
  const [mutationError, setMutationError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const toggleMutation = useMutation({
    mutationFn: () => repository.toggleComplete(item.id),
    onMutate: () => setMutationError(null),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: todoQueryKey }),
        queryClient.invalidateQueries({ queryKey: dashboardQueryKey }),
        queryClient.invalidateQueries({ queryKey: ["routine"] }),
      ]);
    },
    onError: (error) => setMutationError(errorMessage(error)),
  });
  const status = statusOf(item, snapshot.today);
  const dueText = item.done
    ? `완료: ${item.completedAt ? formatCompletedAt(item.completedAt) : "방금"}`
    : !item.dueDate
      ? "기한 없음"
      : item.dueDate === snapshot.today
        ? item.dueTime ? `오늘 ${item.dueTime}` : "오늘"
        : status === "overdue"
          ? `기한: ${daysBetween(item.dueDate, snapshot.today)}일 지남`
          : `기한: ${formatDate(item.dueDate)}${item.dueTime ? ` ${item.dueTime}` : ""}`;

  return (
    <article aria-busy={toggleMutation.isPending} className={`todo-item ${item.done ? "todo-item--done" : ""}`}>
      <Checkbox checked={item.done} disabled={toggleMutation.isPending} label={`${item.title} ${item.done ? "미완료" : "완료"} 처리`} onCheckedChange={() => toggleMutation.mutate()} />
      <button aria-label={`${item.title} 수정`} className="todo-item__open" disabled={toggleMutation.isPending} onClick={onOpen} type="button">
        <span className="todo-item__copy"><strong>{item.title}</strong><span><time className={status === "overdue" ? "todo-item__due todo-item__due--overdue" : "todo-item__due"}>{dueText}</time><span className="todo-item__label"><i style={{ backgroundColor: label.color }} />{label.name}</span></span></span>
        <Icon name="chevronRight" size={13} />
      </button>
      {mutationError && <div className="todo-item__error" role="alert"><Icon name="alert" size={12} />{mutationError}</div>}
    </article>
  );
}

function formatDate(date: string) {
  const [, month, day] = date.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function formatCompletedAt(value: string) {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return value; // mock의 사람이 읽는 문자열("방금" 등)은 그대로 둔다
  const date = new Date(parsed);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function daysBetween(from: string, to: string) {
  return Math.max(1, Math.round((Date.parse(`${to}T00:00:00`) - Date.parse(`${from}T00:00:00`)) / 86_400_000));
}

function TodoLoading() {
  return <div aria-label="할 일 불러오는 중" className="todo-page todo-page--loading"><aside className="todo-filters" /><div className="todo-list">{Array.from({ length: 5 }, (_, index) => <div className="todo-item todo-item--skeleton" key={index} />)}</div></div>;
}
