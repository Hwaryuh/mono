import { translate } from "../../i18n/i18n";
import type { RoutineDefinition, RoutineOccurrence, RoutineSnapshot, RoutineWriteInput, TodoLabel } from "@mono/contracts";
import { Button, DatePicker, Icon, Input, Modal, Select } from "@mono/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { isConflictError } from "../../infrastructure/http/http-client";
import { resyncConflictVersion } from "../../infrastructure/http/conflict-recovery";
import { TodoLabelManagerModal } from "../todo/TodoLabelManagerModal";
import type { TodoRepository } from "../todo/todo-repository";
import type { RoutineRepository } from "./routine-repository";

export const routineQueryKey = ["routine"] as const;
const dayNames = [translate("routine.weekday.sun"), translate("routine.weekday.mon"), translate("routine.weekday.tue"), translate("routine.weekday.wed"), translate("routine.weekday.thu"), translate("routine.weekday.fri"), translate("routine.weekday.sat")];

type Draft = {
  title: string;
  labelId: string;
  days: number[];
  endless: boolean;
  endDate: string;
};

function blankDraft(labels: TodoLabel[]): Draft {
  return { title: "", labelId: labels.find((label) => label.id === "health")?.id ?? labels[0]?.id ?? "", days: [1, 3, 5], endless: true, endDate: "" };
}

function draftOf(routine: RoutineDefinition): Draft {
  return { title: routine.title, labelId: routine.labelId, days: [...routine.days], endless: !routine.endDate, endDate: routine.endDate ?? "" };
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : translate("common.error.actionFailed");
}

function parseDate(date: string) {
  return Date.parse(`${date}T00:00:00Z`);
}

function datesEndingAt(date: string, count: number) {
  const end = parseDate(date);
  return Array.from({ length: count }, (_, index) => new Date(end - (count - index - 1) * 86_400_000).toISOString().slice(0, 10));
}

function dayDifference(from: string, to: string) {
  return Math.round((parseDate(to) - parseDate(from)) / 86_400_000);
}

function isScheduled(routine: RoutineDefinition, date: string) {
  if (date < routine.startDate || (routine.endDate && date > routine.endDate)) return false;
  return routine.days.includes(new Date(`${date}T00:00:00Z`).getUTCDay());
}

function formatShortDate(date: string) {
  const [, month, day] = date.split("-");
  return `${Number(month)}/${Number(day)}`;
}

interface RoutinePageProps {
  repository: RoutineRepository;
  todoRepository: TodoRepository;
}

export function RoutinePage({ repository, todoRepository }: RoutinePageProps) {
  const [editorItem, setEditorItem] = useState<RoutineDefinition | "new" | null>(null);
  const [draft, setDraft] = useState<Draft>({ title: "", labelId: "", days: [], endless: true, endDate: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [labelManagerOpen, setLabelManagerOpen] = useState(false);
  const handledParamRef = useRef("");
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const snapshotQuery = useQuery({ queryKey: routineQueryKey, queryFn: () => repository.getSnapshot() });

  const invalidateSnapshots = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: routineQueryKey }),
      queryClient.invalidateQueries({ queryKey: ["todo"] }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
  };
  const createMutation = useMutation({
    mutationFn: (input: RoutineWriteInput) => repository.create(input),
    onMutate: () => setFormError(null),
    onSuccess: async () => { await invalidateSnapshots(); closeEditor(true); },
    onError: (error) => setFormError(errorMessage(error)),
  });
  const updateMutation = useMutation({
    mutationFn: ({ routineId, input, expectedVersion }: { routineId: string; input: RoutineWriteInput; expectedVersion: number }) =>
      repository.update(routineId, input, expectedVersion),
    onMutate: () => setFormError(null),
    onSuccess: async () => { await invalidateSnapshots(); closeEditor(true); },
    onError: async (error) => {
      setFormError(errorMessage(error));
      if (isConflictError(error) && editorItem && editorItem !== "new") {
        const version = await resyncConflictVersion<RoutineSnapshot>(
          queryClient, routineQueryKey, invalidateSnapshots,
          (snapshot) => snapshot.items.find((candidate) => candidate.id === editorItem.id),
        );
        if (version !== null) setEditorItem((current) => (current && current !== "new" ? { ...current, version } : current));
      }
    },
  });

  useEffect(() => {
    const snapshot = snapshotQuery.data;
    const modal = searchParams.get("modal");
    const id = searchParams.get("id") ?? "";
    const paramKey = `${modal ?? ""}:${id}`;
    if (!modal) {
      handledParamRef.current = "";
      setEditorItem(null);
      setFormError(null);
      return;
    }
    if (!snapshot || handledParamRef.current === paramKey) return;
    handledParamRef.current = paramKey;
    if (modal === "new") {
      setDraft(blankDraft(snapshot.labels));
      setEditorItem("new");
      setFormError(null);
    } else if (modal === "edit") {
      const routine = snapshot.items.find((candidate) => candidate.id === id);
      if (routine) {
        setDraft(draftOf(routine));
        setEditorItem(routine);
        setFormError(null);
      } else {
        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete("modal");
        nextParams.delete("id");
        setSearchParams(nextParams, { replace: true });
      }
    }
  }, [searchParams, snapshotQuery.data]);

  if (snapshotQuery.isPending) return <RoutineLoading />;
  if (snapshotQuery.isError) return <div className="routine-state" role="alert"><Icon name="alert" size={18} />{translate("routine.error.load")}</div>;
  const snapshot = snapshotQuery.data;
  const editorBusy = createMutation.isPending || updateMutation.isPending;

  function openCreate() {
    setDraft(blankDraft(snapshot.labels));
    setEditorItem("new");
    setFormError(null);
    setSearchParams({ modal: "new" }, { replace: true });
  }

  function openEditor(routine: RoutineDefinition) {
    setDraft(draftOf(routine));
    setEditorItem(routine);
    setFormError(null);
    setSearchParams({ modal: "edit", id: routine.id }, { replace: true });
  }

  function closeEditor(force = false) {
    if (editorBusy && !force) return;
    setLabelManagerOpen(false);
    setEditorItem(null);
    setFormError(null);
    if (searchParams.has("modal") || searchParams.has("id")) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete("modal");
      nextParams.delete("id");
      setSearchParams(nextParams, { replace: true });
    }
  }

  function toggleDay(day: number) {
    setDraft((current) => ({ ...current, days: current.days.includes(day) ? current.days.filter((candidate) => candidate !== day) : [...current.days, day].sort() }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const input: RoutineWriteInput = {
      title: draft.title.trim(),
      labelId: draft.labelId,
      days: draft.days,
      endDate: draft.endless ? null : draft.endDate || null,
    };
    if (!input.title) { setFormError(translate("common.validation.titleRequired")); return; }
    if (input.days.length === 0) { setFormError(translate("routine.validation.daysRequired")); return; }
    if (!input.labelId) { setFormError(translate("common.validation.labelRequired")); return; }
    if (!draft.endless && !draft.endDate) { setFormError(translate("routine.validation.endDateRequired")); return; }
    if (editorItem === "new") createMutation.mutate(input);
    else if (editorItem) updateMutation.mutate({ routineId: editorItem.id, input, expectedVersion: editorItem.version ?? 1 });
  }

  const selectedDays = dayNames.filter((_, day) => draft.days.includes(day));

  return (
    <div className="routine-page">
      <div className="routine-cards">
        {snapshot.items.map((routine) => <RoutineCard key={routine.id} onEdit={() => openEditor(routine)} repository={repository} routine={routine} snapshot={snapshot} />)}
        {snapshot.items.length === 0 && <div className="routine-empty"><Icon name="routine" size={28} /><strong>{translate("routine.empty.title")}</strong><span>{translate("routine.empty.description")}</span><Button onClick={openCreate} variant="primary">{translate("app.action.newRoutine")}</Button></div>}
      </div>

      <Modal
        className="routine-editor-modal"
        footer={<><Button disabled={editorBusy} onClick={() => closeEditor()}>{translate("common.action.cancel")}</Button><Button form="routine-editor-form" loading={editorBusy} type="submit" variant="primary">{editorItem === "new" ? translate("routine.action.create") : translate("common.action.save")}</Button></>}
        icon="routine"
        onClose={closeEditor}
        open={editorItem !== null}
        title={editorItem === "new" ? translate("app.action.newRoutine") : translate("routine.action.edit")}
      >
        <form className="routine-editor" id="routine-editor-form" onSubmit={submit}>
          <label><span>{translate("common.field.title")}</span><Input autoFocus maxLength={500} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder={translate("routine.editor.titlePlaceholder")} value={draft.title} /></label>
          <div className="routine-editor__group">
            <div className="routine-editor__group-title"><span>{translate("routine.editor.daysSummaryLabel")}</span><small>{draft.days.length === 7 ? translate("routine.recurrence.daily") : selectedDays.join(" · ") || translate("routine.editor.daysPlaceholder")}</small><Button onClick={() => setDraft((current) => ({ ...current, days: [0, 1, 2, 3, 4, 5, 6] }))} size="small" type="button" variant="text">{translate("routine.recurrence.daily")}</Button></div>
            <div className="routine-editor__days" role="group" aria-label={translate("routine.field.days")}>{dayNames.map((name, day) => <button aria-pressed={draft.days.includes(day)} className={draft.days.includes(day) ? "routine-editor__day routine-editor__day--selected" : "routine-editor__day"} key={name} onClick={() => toggleDay(day)} type="button">{name}</button>)}</div>
          </div>
          <div className="routine-editor__group">
            <div className="routine-editor__group-title">{translate("routine.field.period")}</div>
            <div className="routine-editor__period" role="radiogroup" aria-label={translate("routine.field.period")}><button aria-checked={draft.endless} onClick={() => setDraft((current) => ({ ...current, endless: true }))} role="radio" type="button">∞</button><button aria-checked={!draft.endless} onClick={() => setDraft((current) => ({ ...current, endless: false }))} role="radio" type="button">{translate("routine.period.endDateOption")}</button></div>
            {draft.endless ? <p>{translate("routine.period.endlessDescription")}</p> : <div className="routine-editor__end"><DatePicker align="end" label={translate("routine.field.endDate")} min={editorItem === "new" ? snapshot.today : undefined} onChange={(endDate) => setDraft((current) => ({ ...current, endDate }))} value={draft.endDate} /><span>{translate("routine.period.endDateDescription")}</span></div>}
          </div>
          <div className="routine-editor__label-field">
            <div className="todo-editor__label-legend"><span>{translate("common.field.label")}</span><button onClick={() => setLabelManagerOpen(true)} type="button">{translate("common.action.manage")}</button></div>
            <Select label={translate("common.field.label")} onChange={(labelId) => setDraft((current) => ({ ...current, labelId }))} options={snapshot.labels.map((label) => ({ value: label.id, label: label.name, dotColor: label.color }))} value={draft.labelId} />
          </div>
          {formError && <div className="routine-mutation-error" role="alert"><Icon name="alert" size={13} />{formError}</div>}
        </form>
      </Modal>

      <TodoLabelManagerModal
        labels={snapshot.labels}
        onClose={() => setLabelManagerOpen(false)}
        onLabelCreated={(labelId) => setDraft((current) => ({ ...current, labelId }))}
        onLabelDeleted={(labelId, replacementLabelId) => setDraft((current) => current.labelId === labelId ? { ...current, labelId: replacementLabelId } : current)}
        open={labelManagerOpen}
        repository={todoRepository}
        usageCountOf={(labelId) => snapshot.items.filter((routine) => routine.labelId === labelId).length}
      />
    </div>
  );
}

function RoutineCard({ routine, snapshot, repository, onEdit }: { routine: RoutineDefinition; snapshot: RoutineSnapshot; repository: RoutineRepository; onEdit: () => void }) {
  const [mutationError, setMutationError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const todayOccurrence = snapshot.occurrences.find((occurrence) => occurrence.routineId === routine.id && occurrence.occurrenceDate === snapshot.today);
  const availableToday = isScheduled(routine, snapshot.today);
  const expired = Boolean(routine.endDate && routine.endDate < snapshot.today);
  const startsLater = routine.startDate > snapshot.today;
  const toggleMutation = useMutation({
    mutationFn: () => repository.toggleToday(routine.id),
    onMutate: () => setMutationError(null),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: routineQueryKey }),
        queryClient.invalidateQueries({ queryKey: ["todo"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
      ]);
    },
    onError: (error) => setMutationError(errorMessage(error)),
  });
  const label = snapshot.labels.find((candidate) => candidate.id === routine.labelId) ?? snapshot.labels[0];
  const historyDates = datesEndingAt(snapshot.today, 14);
  const occurrenceByDate = new Map(snapshot.occurrences.filter((occurrence) => occurrence.routineId === routine.id).map((occurrence) => [occurrence.occurrenceDate, occurrence] as const));
  const totalDays = routine.endDate ? dayDifference(routine.startDate, routine.endDate) + 1 : 0;
  const elapsedDays = routine.endDate ? Math.min(totalDays, Math.max(0, dayDifference(routine.startDate, snapshot.today) + 1)) : 0;
  const progress = routine.endDate ? Math.round(elapsedDays / Math.max(1, totalDays) * 100) : 100;
  const todayNote = expired ? translate("routine.status.expired") : startsLater ? translate("routine.status.notStarted") : !availableToday ? translate("routine.status.notScheduledToday") : todayOccurrence?.done ? translate("routine.status.completedToday") : translate("routine.status.dueToday");
  const progressNote = expired ? translate("routine.status.expired") : startsLater ? translate("routine.status.notStarted") : routine.endDate ? translate("routine.period.daysRemaining", { days: dayDifference(snapshot.today, routine.endDate) }) : translate("routine.period.noEndDate");

  return (
    <article aria-busy={toggleMutation.isPending} className={`routine-card ${expired ? "routine-card--expired" : ""}`}>
      <button aria-label={translate("routine.action.toggleCompletion", { title: routine.title, state: todayOccurrence?.done ? translate("routine.status.incomplete") : translate("todo.filter.completed") })} aria-pressed={Boolean(todayOccurrence?.done)} className={todayOccurrence?.done ? "routine-card__check routine-card__check--done" : "routine-card__check"} disabled={!availableToday || toggleMutation.isPending} onClick={() => toggleMutation.mutate()} title={availableToday ? translate("routine.status.completedToday") : todayNote} type="button"><Icon name="check" size={14} strokeWidth={3} /></button>
      <div className="routine-card__identity"><strong title={routine.title}>{routine.title}</strong><span><i style={{ backgroundColor: label?.color }} />{label?.name ?? translate("routine.label.unassigned")} · {todayNote}</span></div>
      <div className="routine-card__schedule"><span>{translate("routine.field.days")}</span><div>{dayNames.map((name, day) => <i className={routine.days.includes(day) ? "routine-card__dow routine-card__dow--active" : "routine-card__dow"} key={name}>{name}</i>)}</div></div>
      <div className="routine-card__activity"><div className="routine-card__period"><span>{translate("routine.field.period")}</span><strong>{routine.endDate ? `~ ${formatShortDate(routine.endDate)}` : "∞"}</strong><small>{progressNote}</small></div><div className="routine-card__progress"><span style={{ width: `${progress}%` }} /></div><div className="routine-card__history"><span>{translate("routine.history.title")}</span>{historyDates.map((date) => { const occurrence = occurrenceByDate.get(date); const scheduled = isScheduled(routine, date); const className = occurrence?.done ? "routine-history routine-history--done" : scheduled ? "routine-history routine-history--missed" : "routine-history"; return <i aria-label={translate("routine.history.dayLabel", { date, state: occurrence?.done ? translate("todo.filter.completed") : scheduled ? translate("routine.status.incomplete") : translate("routine.history.unscheduled") })} className={className} key={date} title={date} />; })}</div></div>
      <Button disabled={toggleMutation.isPending} onClick={onEdit} size="small">{translate("routine.action.editButton")}</Button>
      {mutationError && <div className="routine-card__error" role="alert"><Icon name="alert" size={12} />{mutationError}</div>}
    </article>
  );
}

function RoutineLoading() {
  return <div aria-label={translate("routine.loading")} className="routine-page"><div className="routine-cards">{Array.from({ length: 3 }, (_, index) => <div className="routine-card routine-card--skeleton" key={index} />)}</div></div>;
}
