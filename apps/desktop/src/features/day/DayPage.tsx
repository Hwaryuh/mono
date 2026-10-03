import { translate } from "../../i18n/i18n";
import { errorMessage } from "../../i18n/error-message";
import type { DayEntry, DayEntryWriteInput, TodoItem } from "@mono/contracts";
import { currentIsoDate, koreanDateLabel } from "@mono/domain";
import { Button, Icon, IconButton, Input, Select, TextArea, TimePicker } from "@mono/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router";
import type { TodoRepository } from "../todo/todo-repository";
import type { DayRepository } from "./day-repository";
import { buildTimeline, chainStartOf, formatDuration, minutesToClock, parseEntryDraft } from "./day-timeline";

const dayQueryKey = ["day"] as const;
const todoQueryKey = ["todo"] as const;
const MAX_SUGGESTIONS = 5;

function shiftDate(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  return currentIsoDate(new Date(year, month - 1, day + days));
}

function nowClock(): string {
  const now = new Date();
  return minutesToClock(now.getHours() * 60 + now.getMinutes());
}

// Block height follows duration so the day reads at a glance, clamped so short entries stay clickable.
function heightOf(minutes: number, scale: number, min: number, max: number): CSSProperties {
  return { minHeight: Math.min(max, Math.max(min, Math.round(minutes * scale))) };
}

export function DayPage({ repository, todoRepository }: { repository: DayRepository; todoRepository: TodoRepository }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const today = currentIsoDate();
  const date = searchParams.get("date") ?? today;
  const queryClient = useQueryClient();
  const snapshotQuery = useQuery({ queryKey: [...dayQueryKey, date], queryFn: () => repository.getSnapshot(date) });
  const todoQuery = useQuery({ queryKey: todoQueryKey, queryFn: () => todoRepository.getSnapshot() });

  const [draft, setDraft] = useState("");
  const [linkedTodoId, setLinkedTodoId] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(0);
  const [suggestionsDismissed, setSuggestionsDismissed] = useState(false);
  const [draftInvalid, setDraftInvalid] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef<HTMLInputElement>(null);

  const entries = useMemo(() => snapshotQuery.data?.entries ?? [], [snapshotQuery.data]);
  const timeline = useMemo(() => buildTimeline(entries), [entries]);
  const chainStart = chainStartOf(entries);
  const todos = useMemo(() => todoQuery.data?.items ?? [], [todoQuery.data]);
  const todoById = useMemo(() => new Map(todos.map((todo) => [todo.id, todo])), [todos]);
  const todoMinutes = useMemo(() => new Map((snapshotQuery.data?.todoMinutes ?? []).map((row) => [row.todoId, row.minutes])), [snapshotQuery.data]);
  // Open todos, the ones due on this date first.
  const openTodos = useMemo(
    () => todos.filter((todo) => !todo.done).sort((a, b) => Number(b.dueDate === date) - Number(a.dueDate === date)),
    [todos, date],
  );

  const parsed = parseEntryDraft(draft, chainStart, nowClock());
  const query = (parsed && "title" in parsed ? parsed.title : "").trim().toLocaleLowerCase("ko-KR");
  const suggestions = !query || linkedTodoId || suggestionsDismissed
    ? []
    : openTodos.filter((todo) => todo.title.toLocaleLowerCase("ko-KR").includes(query)).slice(0, MAX_SUGGESTIONS);
  const linkedTodo = linkedTodoId ? todoById.get(linkedTodoId) : undefined;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: dayQueryKey });
  const createMutation = useMutation({
    mutationFn: (input: DayEntryWriteInput) => repository.create(input),
    onMutate: () => setError(null),
    onSuccess: async () => {
      await invalidate();
      setDraft("");
      setLinkedTodoId(null);
      setSuggestionsDismissed(false);
    },
    onError: (cause) => setError(errorMessage(cause, "day.error.save")),
  });
  const completeTodoMutation = useMutation({
    mutationFn: (todoId: string) => todoRepository.toggleComplete(todoId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: todoQueryKey }),
    onError: (cause) => setError(errorMessage(cause, "day.error.save")),
  });

  // Prefetch the neighbouring days so stepping with the arrows never flashes the loading skeleton.
  useEffect(() => {
    for (const neighbour of [shiftDate(date, -1), shiftDate(date, 1)]) {
      void queryClient.prefetchQuery({ queryKey: [...dayQueryKey, neighbour], queryFn: () => repository.getSnapshot(neighbour) });
    }
  }, [date, queryClient, repository]);

  // A draft belongs to the day it was typed on — switching days (buttons or URL) starts fresh.
  useEffect(() => {
    setDraft("");
    setLinkedTodoId(null);
    setDraftInvalid(false);
    setEditingId(null);
    setError(null);
  }, [date]);

  // The timer's notification opens `/day?focus=untitled`: drop the cursor on the newest unnamed entry.
  useEffect(() => {
    if (searchParams.get("focus") !== "untitled" || !snapshotQuery.data) return;
    const untitled = [...snapshotQuery.data.entries].reverse().find((entry) => !entry.title);
    if (untitled) setEditingId(untitled.id);
    setSearchParams((params) => {
      params.delete("focus");
      return params;
    }, { replace: true });
  }, [searchParams, setSearchParams, snapshotQuery.data]);

  function goTo(nextDate: string) {
    setSearchParams(nextDate === today ? {} : { date: nextDate });
  }

  function submitDraft() {
    if (!parsed) return;
    if ("error" in parsed) {
      setDraftInvalid(true);
      return;
    }
    createMutation.mutate({ date, ...parsed, todoId: linkedTodoId, note: "" });
  }

  function linkTodo(todo: TodoItem) {
    setLinkedTodoId(todo.id);
    setHighlighted(0);
  }

  function onDraftKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (suggestions.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlighted((current) => (current + step + suggestions.length) % suggestions.length);
    } else if (suggestions.length && event.key === "Tab") {
      event.preventDefault();
      linkTodo(suggestions[Math.min(highlighted, suggestions.length - 1)]);
    } else if (event.key === "Escape") {
      setSuggestionsDismissed(true);
    } else if (event.key === "Backspace" && !draft && linkedTodoId) {
      setLinkedTodoId(null);
    } else if (event.key === "Enter") {
      event.preventDefault();
      submitDraft();
    }
  }

  function fillGap(startTime: string, endTime: string) {
    setDraft(`${startTime}-${endTime} `);
    setDraftInvalid(false);
    requestAnimationFrame(() => draftRef.current?.focus());
  }

  if (snapshotQuery.isError) {
    return (
      <div className="day-state">
        <Icon name="alert" size={18} />
        <span>{errorMessage(snapshotQuery.error, "day.error.load")}</span>
        <Button onClick={() => void snapshotQuery.refetch()}>{translate("routeError.retry")}</Button>
      </div>
    );
  }

  return (
    <div className="day-page">
      <div className="day-column">
        <header className="day-header">
          <IconButton aria-label={translate("day.navigation.previous")} onClick={() => goTo(shiftDate(date, -1))} variant="ghost">
            <Icon name="arrowLeft" size={15} />
          </IconButton>
          <strong className="day-header__date">{koreanDateLabel(date, "short")}</strong>
          <IconButton aria-label={translate("day.navigation.next")} onClick={() => goTo(shiftDate(date, 1))} variant="ghost">
            <Icon name="chevronRight" size={15} />
          </IconButton>
          {date !== today && <button className="day-header__today" onClick={() => goTo(today)} type="button">{translate("day.navigation.today")}</button>}
          <span className="day-header__summary">
            {translate("day.summary.logged")} <b>{formatDuration(timeline.loggedMinutes)}</b>
            {timeline.gapMinutes > 0 && <> · {translate("day.summary.gap")} <b>{formatDuration(timeline.gapMinutes)}</b></>}
          </span>
        </header>

        {snapshotQuery.isPending ? (
          <div className="day-skeleton" />
        ) : entries.length === 0 ? (
          <div className="day-empty">
            <Icon name="timeline" size={20} />
            <strong>{translate("day.empty.title")}</strong>
            <span>{translate("day.empty.description")}</span>
          </div>
        ) : (
          <ol className="day-timeline">
            {timeline.rows.map((row) => row.kind === "gap" ? (
              <li className="day-row" key={`gap-${row.startTime}`} style={heightOf(row.minutes, 0.4, 36, 64)}>
                <time className="day-row__time">{row.startTime}</time>
                <span className="day-row__rail" />
                <button className="day-gap" onClick={() => fillGap(row.startTime, row.endTime)} type="button">
                  {translate("day.gap.label")} <b>{formatDuration(row.minutes)}</b> · {translate("day.gap.fill")}
                </button>
              </li>
            ) : (
              <li className="day-row" key={row.entry.id} style={editingId === row.entry.id ? undefined : heightOf(row.minutes, 0.8, 56, 150)}>
                <time className="day-row__time">{row.entry.startTime}</time>
                <span className={`day-row__rail day-row__rail--dot${row.entry.title ? "" : " day-row__rail--untitled"}${row.overlaps ? " day-row__rail--overlap" : ""}`} />
                {editingId === row.entry.id ? (
                  <EntryEditor
                    entry={row.entry}
                    onDone={() => setEditingId(null)}
                    overlaps={row.overlaps}
                    repository={repository}
                    todos={openTodos}
                    todoById={todoById}
                  />
                ) : (
                  <EntryCard
                    completing={completeTodoMutation.isPending}
                    crossesMidnight={row.crossesMidnight}
                    entry={row.entry}
                    minutes={row.minutes}
                    onComplete={(todoId) => completeTodoMutation.mutate(todoId)}
                    onEdit={() => setEditingId(row.entry.id)}
                    overlaps={row.overlaps}
                    todo={row.entry.todoId ? todoById.get(row.entry.todoId) : undefined}
                  />
                )}
              </li>
            ))}
          </ol>
        )}

        <div className="day-composer">
          {suggestions.length > 0 && (
            <div aria-label={translate("day.suggestions.label")} className="day-suggestions" role="listbox">
              {suggestions.map((todo, index) => (
                <button
                  aria-selected={index === highlighted}
                  className="day-suggestion"
                  key={todo.id}
                  onClick={() => {
                    linkTodo(todo);
                    draftRef.current?.focus();
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  role="option"
                  type="button"
                >
                  <Icon name="todo" size={14} />
                  <span>{todo.title}</span>
                  {todoMinutes.has(todo.id) && <small>{formatDuration(todoMinutes.get(todo.id)!)}</small>}
                </button>
              ))}
            </div>
          )}
          <div className={`day-composer__bar${draftInvalid ? " day-composer__bar--invalid" : ""}`}>
            <span className="day-composer__chain">{chainStart ?? "–:–"} ~</span>
            {linkedTodo && (
              <span className="day-chip">
                <Icon name="todo" size={12} />
                {linkedTodo.title}
                <button aria-label={translate("day.action.unlinkTodo")} onClick={() => setLinkedTodoId(null)} type="button"><Icon name="close" size={11} /></button>
              </span>
            )}
            <input
              aria-invalid={draftInvalid || undefined}
              aria-label={translate("day.composer.label")}
              className="day-composer__input"
              onChange={(event) => {
                setDraft(event.target.value);
                setDraftInvalid(false);
                setSuggestionsDismissed(false);
                setHighlighted(0);
              }}
              onKeyDown={onDraftKeyDown}
              placeholder={translate(chainStart ? "day.composer.placeholder" : "day.composer.placeholderFirst")}
              ref={draftRef}
              value={draft}
            />
            <Button disabled={!draft.trim()} loading={createMutation.isPending} onClick={submitDraft} size="small" variant="primary">
              {translate("day.action.log")}
            </Button>
          </div>
          {error && <p className="day-error" role="alert">{error}</p>}
        </div>
      </div>
    </div>
  );
}

function EntryCard({ entry, minutes, overlaps, crossesMidnight, todo, completing, onEdit, onComplete }: {
  entry: DayEntry; minutes: number; overlaps: boolean; crossesMidnight: boolean; todo?: TodoItem; completing: boolean;
  onEdit: () => void; onComplete: (todoId: string) => void;
}) {
  return (
    <div className={`day-card${overlaps ? " day-card--overlap" : ""}${entry.title ? "" : " day-card--untitled"}`}>
      <button className="day-card__main" onClick={onEdit} type="button">
        <strong>{entry.title || translate("day.entry.untitled")}</strong>
        <span className="day-card__meta">
          <span className="day-card__range">{entry.startTime} – {entry.endTime}{crossesMidnight ? " (+1)" : ""}</span>
          {todo && <span className="day-tag"><Icon name="todo" size={11} />{todo.title}</span>}
          {entry.source === "timer" && <span className="day-tag"><Icon name="clock" size={11} />{translate("day.entry.timer")}</span>}
          {overlaps && <span className="day-tag day-tag--warning"><Icon name="alert" size={11} />{translate("day.entry.overlap")}</span>}
        </span>
      </button>
      <div className="day-card__side">
        <span className="day-card__duration">{formatDuration(minutes)}</span>
        {todo && !todo.done && (
          <Button disabled={completing} onClick={() => onComplete(todo.id)} size="small">
            <Icon name="check" size={12} />
            {translate("day.action.completeTodo")}
          </Button>
        )}
        {todo?.done && <span className="day-card__done"><Icon name="check" size={12} />{translate("day.entry.todoDone")}</span>}
      </div>
    </div>
  );
}

function EntryEditor({ entry, overlaps, todos, todoById, repository, onDone }: {
  entry: DayEntry; overlaps: boolean; todos: TodoItem[]; todoById: Map<string, TodoItem>; repository: DayRepository; onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [input, setInput] = useState<DayEntryWriteInput>({
    date: entry.date, startTime: entry.startTime, endTime: entry.endTime, title: entry.title, todoId: entry.todoId, note: entry.note,
  });
  const [error, setError] = useState<string | null>(null);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: dayQueryKey });
  const saveMutation = useMutation({
    mutationFn: () => repository.update(entry.id, input, entry.version),
    onSuccess: async () => {
      await invalidate();
      onDone();
    },
    onError: async (cause) => {
      setError(errorMessage(cause, "day.error.save"));
      await invalidate();
    },
  });
  const deleteMutation = useMutation({
    mutationFn: () => repository.remove(entry.id),
    onSuccess: async () => {
      await invalidate();
      onDone();
    },
    onError: (cause) => setError(errorMessage(cause, "day.error.save")),
  });
  // Keep a link to a todo that's since been completed, so opening the editor doesn't silently drop it.
  const linked = input.todoId ? todoById.get(input.todoId) : undefined;
  const todoOptions = [
    { value: "", label: translate("day.editor.noTodo") },
    ...(linked && !todos.includes(linked) ? [linked] : []).concat(todos).map((todo) => ({ value: todo.id, label: todo.title })),
  ];

  function submit(event: FormEvent) {
    event.preventDefault();
    if (input.startTime === input.endTime) {
      setError(translate("day.error.sameTime"));
      return;
    }
    saveMutation.mutate();
  }

  return (
    <form className="day-editor" onKeyDown={(event) => event.key === "Escape" && onDone()} onSubmit={submit}>
      <div className="day-editor__times">
        <TimePicker label={translate("day.editor.start")} onChange={(startTime) => setInput({ ...input, startTime })} value={input.startTime} />
        <span>–</span>
        <TimePicker label={translate("day.editor.end")} onChange={(endTime) => setInput({ ...input, endTime })} value={input.endTime} />
      </div>
      {overlaps && <p className="day-editor__warning"><Icon name="alert" size={12} />{translate("day.entry.overlapDetail")}</p>}
      <label className="day-editor__field">
        <span>{translate("day.editor.title")}</span>
        <Input autoFocus onChange={(event) => setInput({ ...input, title: event.target.value })} placeholder={translate("day.entry.untitled")} value={input.title} />
      </label>
      <div className="day-editor__field">
        <span>{translate("day.editor.todo")}</span>
        <Select label={translate("day.editor.todo")} onChange={(todoId) => setInput({ ...input, todoId: todoId || null })} options={todoOptions} value={input.todoId ?? ""} />
      </div>
      <label className="day-editor__field">
        <span>{translate("day.editor.note")}</span>
        <TextArea autoGrow onChange={(event) => setInput({ ...input, note: event.target.value })} rows={2} value={input.note} />
      </label>
      {error && <p className="day-error" role="alert">{error}</p>}
      <div className="day-editor__actions">
        <Button className="day-editor__delete" disabled={saveMutation.isPending} loading={deleteMutation.isPending} onClick={() => deleteMutation.mutate()} size="small" type="button" variant="text">
          {translate("common.action.delete")}
        </Button>
        <span className="day-editor__spacer" />
        <Button onClick={onDone} size="small" type="button">{translate("common.action.cancel")}</Button>
        <Button loading={saveMutation.isPending} size="small" type="submit" variant="primary">{translate("common.action.save")}</Button>
      </div>
    </form>
  );
}
