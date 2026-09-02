import { translate } from "../../i18n/i18n";
import { type TodoItem, type TodoLabel, type TodoSnapshot, type TodoWriteInput } from "@mono/contracts";
import { Button, Checkbox, DatePicker, Icon, Input, Modal, Select, TextArea, TimePicker, type IconName } from "@mono/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { isConflictError } from "../../infrastructure/http/http-client";
import { resyncConflictVersion } from "../../infrastructure/http/conflict-recovery";
import { TodoLabelManagerModal } from "./TodoLabelManagerModal";
import type { TodoRepository } from "./todo-repository";
import {
  todoViewStateStoreOf,
  todoStatusOrder,
  type TodoStatus,
  type TodoViewStateStore,
} from "./todo-view-state-store";

export const todoQueryKey = ["todo"] as const;
const dashboardQueryKey = ["dashboard"] as const;
type Draft = {
  title: string;
  labelId: string;
  dueDate: string;
  dueTime: string;
  note: string;
};

const statusMeta: Record<TodoStatus, { name: string; title: string; icon: IconName }> = {
  all: { name: translate("todo.filter.all"), title: translate("todo.filter.allLabel"), icon: "layers" },
  today: { name: translate("todo.filter.today"), title: translate("dashboard.todayTodos.title"), icon: "clock" },
  upcoming: { name: translate("todo.filter.upcoming"), title: translate("todo.filter.upcomingLabel"), icon: "calendar" },
  overdue: { name: translate("todo.filter.overdue"), title: translate("todo.filter.overdueLabel"), icon: "alert" },
  done: { name: translate("todo.filter.completed"), title: translate("todo.filter.completedLabel"), icon: "check" },
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
  return error instanceof Error ? error.message : translate("common.error.actionFailed");
}

export function TodoPage({ repository, viewStateStore }: { repository: TodoRepository; viewStateStore?: TodoViewStateStore }) {
  const [store] = useState(() => viewStateStore ?? todoViewStateStoreOf());
  const [viewState, setViewState] = useState(() => store.read());
  const { status, labelIds } = viewState;
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
    mutationFn: ({ itemId, input, expectedVersion }: { itemId: string; input: TodoWriteInput; expectedVersion: number }) =>
      repository.update(itemId, input, expectedVersion),
    onMutate: () => setFormError(null),
    onSuccess: async () => { await invalidateSnapshots(); closeEditor(true); },
    onError: async (error) => {
      setFormError(errorMessage(error));
      if (isConflictError(error) && editorItem && editorItem !== "new") {
        const version = await resyncConflictVersion<TodoSnapshot>(
          queryClient, todoQueryKey, invalidateSnapshots,
          (snapshot) => snapshot.items.find((candidate) => candidate.id === editorItem.id),
        );
        if (version !== null) setEditorItem((current) => (current && current !== "new" ? { ...current, version } : current));
      }
    },
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
  if (snapshotQuery.isError) return <div className="todo-state" role="alert"><Icon name="alert" size={18} />{translate("todo.error.load")}</div>;
  const snapshot = snapshotQuery.data;

  const now = Date.now();
  const counts = Object.fromEntries(todoStatusOrder.map((statusId) => [
    statusId,
    statusId === "all"
      ? snapshot.items.filter((item) => !isAgedDone(item, now)).length
      : snapshot.items.filter((item) => statusOf(item, snapshot.today) === statusId).length,
  ])) as Record<TodoStatus, number>;
  const filteredItems = snapshot.items.filter((item) => {
    const statusMatches = status === "all" ? !isAgedDone(item, now) : statusOf(item, snapshot.today) === status;
    return statusMatches && (labelIds.length === 0 || labelIds.includes(item.labelId));
  });
  const visibleItems = status === "all"
    ? [...filteredItems].sort((left, right) => Number(left.done) - Number(right.done))
    : filteredItems;
  const title = labelIds.length > 0 ? translate("todo.list.filteredLabel") : statusMeta[status].title;
  const activeEditorItem = editorItem === "new" || editorItem === null ? null : editorItem;
  const editorBusy = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  function selectStatus(nextStatus: TodoStatus, focus = false) {
    setViewState((current) => {
      const next = { ...current, status: nextStatus };
      store.write(next);
      return next;
    });
    if (focus) document.querySelector<HTMLButtonElement>(`[data-todo-status="${nextStatus}"]`)?.focus();
  }

  function onStatusKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: TodoStatus) {
    const index = todoStatusOrder.indexOf(current);
    let next: TodoStatus | undefined;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = todoStatusOrder[(index + 1) % todoStatusOrder.length];
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = todoStatusOrder[(index - 1 + todoStatusOrder.length) % todoStatusOrder.length];
    if (event.key === "Home") next = todoStatusOrder[0];
    if (event.key === "End") next = todoStatusOrder[todoStatusOrder.length - 1];
    if (!next) return;
    event.preventDefault();
    selectStatus(next, true);
  }

  function toggleLabel(labelId: string, focus = false) {
    setViewState((current) => {
      const labelIds = current.labelIds.includes(labelId)
        ? current.labelIds.filter((id) => id !== labelId)
        : [...current.labelIds, labelId];
      const next = { ...current, labelIds };
      store.write(next);
      return next;
    });
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
    if (!input.title) { setFormError(translate("common.validation.titleRequired")); return; }
    if (!input.labelId) { setFormError(translate("common.validation.labelRequired")); return; }
    if (editorItem === "new") createMutation.mutate(input);
    else if (editorItem) updateMutation.mutate({ itemId: editorItem.id, input, expectedVersion: editorItem.version ?? 1 });
  }

  return (
    <div className="todo-page">
      <aside aria-label={translate("todo.filter.statusLabel")} className="todo-filters">
        <fieldset className="todo-filter-group">
          <legend>{translate("common.status.label")}</legend>
          {todoStatusOrder.map((statusId) => {
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
        <div aria-label={translate("todo.filter.labelLabel")} className="todo-filter-group todo-filter-group--labels" role="group">
          <div className="todo-filter-group__title">
            <span>{translate("common.field.label")}</span>
            <button aria-label={translate("common.labels.manage")} className="todo-label-manage-trigger" onClick={openLabelManager} type="button">{translate("common.action.manage")}</button>
          </div>
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
                <small>{snapshot.items.filter((item) => item.labelId === label.id).length}</small>
              </button>
            );
          })}
        </div>
      </aside>

      <section className="todo-content">
        <header className="todo-list-header">
          <strong>{title}</strong><span>{visibleItems.length}{translate("common.unit.items")}</span>
          {labelIds.map((labelId) => {
            const label = snapshot.labels.find((candidate) => candidate.id === labelId);
            return label && (
              <button aria-label={translate("todo.filter.clearLabel", { label: label.name })} className="todo-active-filter" key={label.id} onClick={() => toggleLabel(label.id)} type="button">
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
            <div className="todo-empty"><Icon name="todo" size={26} /><strong>{translate("todo.empty.filteredTitle")}</strong><span>{translate("todo.empty.filteredDescription")}</span></div>
          )}
          {snapshot.items.length === 0 && (
            <div className="todo-empty"><Icon name="todo" size={26} /><strong>{translate("todo.empty.title")}</strong><span>{translate("todo.empty.description")}</span><Button onClick={openCreate} variant="primary">{translate("app.action.newTodo")}</Button></div>
          )}
        </div>
      </section>

      <Modal
        className="todo-editor-modal"
        footer={<>
          {activeEditorItem && <Button className="todo-editor__delete" disabled={editorBusy} onClick={(event) => { event.currentTarget.focus(); setFormError(null); setDeleteOpen(true); }} variant="ghost">{translate("common.action.delete")}</Button>}
          <Button disabled={editorBusy} onClick={() => closeEditor()}>{translate("common.action.cancel")}</Button>
          <Button form="todo-editor-form" loading={createMutation.isPending || updateMutation.isPending} type="submit" variant="primary">{editorItem === "new" ? translate("routine.action.create") : translate("common.action.save")}</Button>
        </>}
        icon="todo"
        onClose={closeEditor}
        open={editorItem !== null}
        title={editorItem === "new" ? translate("app.action.newTodo") : translate("todo.action.edit")}
      >
        <form className="todo-editor" id="todo-editor-form" onSubmit={submit}>
          <label><span>{translate("todo.field.title")} <b>{translate("todo.field.required")}</b></span><Input autoFocus maxLength={500} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} value={draft.title} /></label>
          <div className="todo-editor__field">
            <div className="todo-editor__label-legend"><span>{translate("common.field.label")}</span><button onClick={openLabelManager} type="button">{translate("common.action.manage")}</button></div>
            <Select
              label={translate("common.field.label")}
              onChange={(labelId) => setDraft((current) => ({ ...current, labelId }))}
              options={snapshot.labels.map((label) => ({ value: label.id, label: label.name, dotColor: label.color }))}
              value={draft.labelId}
            />
          </div>
          <div className="todo-editor__due">
            <fieldset><legend>{translate("todo.field.dueDate")}</legend><DatePicker label={translate("todo.field.dueDate")} onChange={(dueDate) => setDraft((current) => ({ ...current, dueDate, dueTime: dueDate ? current.dueTime : "" }))} value={draft.dueDate} /></fieldset>
            <label><span>{translate("todo.field.time")}</span><TimePicker disabled={!draft.dueDate} label={translate("todo.field.dueTime")} onChange={(dueTime) => setDraft((current) => ({ ...current, dueTime }))} value={draft.dueTime} /></label>
          </div>
          <label><span>{translate("common.field.note")}</span><TextArea onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} rows={4} value={draft.note} /></label>
          {formError && !deleteOpen && <div className="todo-mutation-error" role="alert"><Icon name="alert" size={13} />{formError}</div>}
        </form>
      </Modal>

      <TodoLabelManagerModal
        labels={snapshot.labels}
        onClose={closeLabelManager}
        onLabelDeleted={(labelId, replacementLabelId) => {
          setViewState((current) => {
            const next = { ...current, labelIds: current.labelIds.filter((candidate) => candidate !== labelId) };
            store.write(next);
            return next;
          });
          setDraft((current) => current.labelId === labelId ? { ...current, labelId: replacementLabelId } : current);
        }}
        open={labelManagerOpen}
        repository={repository}
        usageCountOf={(labelId) => snapshot.items.filter((item) => item.labelId === labelId).length}
      />

      <Modal
        className="todo-delete-modal"
        footer={<><Button autoFocus disabled={deleteMutation.isPending} onClick={() => setDeleteOpen(false)}>{translate("common.action.cancel")}</Button><Button loading={deleteMutation.isPending} onClick={() => activeEditorItem && deleteMutation.mutate(activeEditorItem.id)} variant="danger">{translate("common.action.delete")}</Button></>}
        icon="alert"
        onClose={() => { if (!deleteMutation.isPending) setDeleteOpen(false); }}
        open={deleteOpen}
        title={translate("todo.delete.question")}
      >
        <p>{translate("todo.delete.warning")}</p>
        <blockquote>{activeEditorItem?.title}</blockquote>
        {formError && <div className="todo-mutation-error" role="alert"><Icon name="alert" size={13} />{formError}</div>}
      </Modal>
    </div>
  );
}

function TodoRow({ item, label, snapshot, repository, onOpen }: { item: TodoItem; label: TodoLabel; snapshot: TodoSnapshot; repository: TodoRepository; onOpen: () => void }) {
  const [mutationError, setMutationError] = useState<string | null>(null);
  const rowRef = useRef<HTMLElement>(null);
  const previousTopRef = useRef<number | null>(null);
  const previousDoneRef = useRef(item.done);
  const movementRef = useRef<Animation | null>(null);
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
  const justCompleted = item.done && !previousDoneRef.current;
  const dueText = item.done
    ? translate("todo.status.completedAt", { time: item.completedAt ? formatCompletedAt(item.completedAt) : translate("todo.time.justNow") })
    : !item.dueDate
      ? translate("common.date.noDueDate")
      : item.dueDate === snapshot.today
        ? item.dueTime ? translate("todo.status.dueTodayAt", { time: item.dueTime }) : translate("todo.filter.today")
        : status === "overdue"
          ? translate("todo.status.overdueByDays", { days: daysBetween(item.dueDate, snapshot.today) })
          : translate("todo.status.dueAt", { date: formatDate(item.dueDate), time: item.dueTime ? ` ${item.dueTime}` : "" });

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const nextTop = row.getBoundingClientRect().top;
    const previousTop = previousTopRef.current;
    previousTopRef.current = nextTop;
    previousDoneRef.current = item.done;
    movementRef.current?.cancel();

    const delta = previousTop === null ? 0 : previousTop - nextTop;
    if (Math.abs(delta) < 1 || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || !row.animate) return;
    movementRef.current = row.animate(
      [{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }],
      { duration: 260, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    );
  });

  return (
    <article
      aria-busy={toggleMutation.isPending}
      className={`todo-item ${item.done ? "todo-item--done" : ""} ${justCompleted ? "todo-item--completion-feedback" : ""}`}
      ref={rowRef}
    >
      <Checkbox checked={item.done} disabled={toggleMutation.isPending} label={translate("routine.action.toggleCompletion", { title: item.title, state: item.done ? translate("routine.status.incomplete") : translate("todo.filter.completed") })} onCheckedChange={() => toggleMutation.mutate()} />
      <button aria-label={translate("todo.action.editLabel", { title: item.title })} className="todo-item__open" disabled={toggleMutation.isPending} onClick={onOpen} type="button">
        <span className="todo-item__copy"><strong>{item.title}</strong><span><time className={status === "overdue" ? "todo-item__due todo-item__due--overdue" : "todo-item__due"}>{dueText}</time><span className="todo-item__label"><i style={{ backgroundColor: label.color }} />{label.name}</span>{item.note.trim() && <Icon aria-label={translate("todo.note.present")} className="todo-item__note" name="note" role="img" size={12} />}</span></span>
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
  return <div aria-label={translate("todo.loading")} className="todo-page todo-page--loading"><aside className="todo-filters" /><div className="todo-list">{Array.from({ length: 5 }, (_, index) => <div className="todo-item todo-item--skeleton" key={index} />)}</div></div>;
}
