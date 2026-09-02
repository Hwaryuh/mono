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
const dayNames = [translate("routine.text.001"), translate("routine.text.002"), translate("routine.text.003"), translate("routine.text.004"), translate("routine.text.005"), translate("routine.text.006"), translate("routine.text.007")];

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
  return error instanceof Error ? error.message : translate("scrap.text.010");
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
  if (snapshotQuery.isError) return <div className="routine-state" role="alert"><Icon name="alert" size={18} />{translate("routine.text.008")}</div>;
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
    if (!input.title) { setFormError(translate("scrap.text.013")); return; }
    if (input.days.length === 0) { setFormError(translate("routine.text.009")); return; }
    if (!input.labelId) { setFormError(translate("scrap.text.014")); return; }
    if (!draft.endless && !draft.endDate) { setFormError(translate("routine.text.010")); return; }
    if (editorItem === "new") createMutation.mutate(input);
    else if (editorItem) updateMutation.mutate({ routineId: editorItem.id, input, expectedVersion: editorItem.version ?? 1 });
  }

  const selectedDays = dayNames.filter((_, day) => draft.days.includes(day));

  return (
    <div className="routine-page">
      <div className="routine-cards">
        {snapshot.items.map((routine) => <RoutineCard key={routine.id} onEdit={() => openEditor(routine)} repository={repository} routine={routine} snapshot={snapshot} />)}
        {snapshot.items.length === 0 && <div className="routine-empty"><Icon name="routine" size={28} /><strong>{translate("routine.text.011")}</strong><span>{translate("routine.text.012")}</span><Button onClick={openCreate} variant="primary">{translate("app.action.newRoutine")}</Button></div>}
      </div>

      <Modal
        className="routine-editor-modal"
        footer={<><Button disabled={editorBusy} onClick={() => closeEditor()}>{translate("scrap.text.025")}</Button><Button form="routine-editor-form" loading={editorBusy} type="submit" variant="primary">{editorItem === "new" ? translate("routine.text.013") : translate("settings.text.021")}</Button></>}
        icon="routine"
        onClose={closeEditor}
        open={editorItem !== null}
        title={editorItem === "new" ? translate("app.action.newRoutine") : translate("routine.text.014")}
      >
        <form className="routine-editor" id="routine-editor-form" onSubmit={submit}>
          <label><span>{translate("scrap.text.028")}</span><Input autoFocus maxLength={500} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder={translate("routine.text.015")} value={draft.title} /></label>
          <div className="routine-editor__group">
            <div className="routine-editor__group-title">{translate("routine.text.016")}<small>{draft.days.length === 7 ? translate("routine.text.017") : selectedDays.join(" · ") || translate("routine.text.018")}</small><Button onClick={() => setDraft((current) => ({ ...current, days: [0, 1, 2, 3, 4, 5, 6] }))} size="small" type="button" variant="text">{translate("routine.text.017")}</Button></div>
            <div className="routine-editor__days" role="group" aria-label={translate("routine.text.019")}>{dayNames.map((name, day) => <button aria-pressed={draft.days.includes(day)} className={draft.days.includes(day) ? "routine-editor__day routine-editor__day--selected" : "routine-editor__day"} key={name} onClick={() => toggleDay(day)} type="button">{name}</button>)}</div>
          </div>
          <div className="routine-editor__group">
            <div className="routine-editor__group-title">{translate("routine.text.020")}</div>
            <div className="routine-editor__period" role="radiogroup" aria-label={translate("routine.text.020")}><button aria-checked={draft.endless} onClick={() => setDraft((current) => ({ ...current, endless: true }))} role="radio" type="button">∞</button><button aria-checked={!draft.endless} onClick={() => setDraft((current) => ({ ...current, endless: false }))} role="radio" type="button">{translate("routine.text.021")}</button></div>
            {draft.endless ? <p>{translate("routine.text.022")}</p> : <div className="routine-editor__end"><DatePicker align="end" label={translate("routine.text.023")} min={editorItem === "new" ? snapshot.today : undefined} onChange={(endDate) => setDraft((current) => ({ ...current, endDate }))} value={draft.endDate} /><span>{translate("routine.text.024")}</span></div>}
          </div>
          <div className="routine-editor__label-field">
            <div className="todo-editor__label-legend"><span>{translate("scrap.text.040")}</span><button onClick={() => setLabelManagerOpen(true)} type="button">{translate("scrap.text.041")}</button></div>
            <Select label={translate("scrap.text.040")} onChange={(labelId) => setDraft((current) => ({ ...current, labelId }))} options={snapshot.labels.map((label) => ({ value: label.id, label: label.name, dotColor: label.color }))} value={draft.labelId} />
          </div>
          {formError && <div className="routine-mutation-error" role="alert"><Icon name="alert" size={13} />{formError}</div>}
        </form>
      </Modal>

      <TodoLabelManagerModal
        labels={snapshot.labels}
        onClose={() => setLabelManagerOpen(false)}
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
  const todayNote = expired ? translate("routine.text.025") : startsLater ? translate("routine.text.026") : !availableToday ? translate("routine.text.027") : todayOccurrence?.done ? translate("routine.text.028") : translate("routine.text.029");
  const progressNote = expired ? translate("routine.text.025") : startsLater ? translate("routine.text.026") : routine.endDate ? translate("routine.text.030", { value1: dayDifference(snapshot.today, routine.endDate) }) : translate("routine.text.031");

  return (
    <article aria-busy={toggleMutation.isPending} className={`routine-card ${expired ? "routine-card--expired" : ""}`}>
      <button aria-label={translate("routine.text.032", { value1: routine.title, value2: todayOccurrence?.done ? translate("routine.text.038") : translate("todo.text.008") })} aria-pressed={Boolean(todayOccurrence?.done)} className={todayOccurrence?.done ? "routine-card__check routine-card__check--done" : "routine-card__check"} disabled={!availableToday || toggleMutation.isPending} onClick={() => toggleMutation.mutate()} title={availableToday ? translate("routine.text.028") : todayNote} type="button"><Icon name="check" size={14} strokeWidth={3} /></button>
      <div className="routine-card__identity"><strong title={routine.title}>{routine.title}</strong><span><i style={{ backgroundColor: label?.color }} />{label?.name ?? translate("routine.text.033")} · {todayNote}</span></div>
      <div className="routine-card__schedule"><span>{translate("routine.text.019")}</span><div>{dayNames.map((name, day) => <i className={routine.days.includes(day) ? "routine-card__dow routine-card__dow--active" : "routine-card__dow"} key={name}>{name}</i>)}</div></div>
      <div className="routine-card__activity"><div className="routine-card__period"><span>{translate("routine.text.020")}</span><strong>{routine.endDate ? `~ ${formatShortDate(routine.endDate)}` : "∞"}</strong><small>{progressNote}</small></div><div className="routine-card__progress"><span style={{ width: `${progress}%` }} /></div><div className="routine-card__history"><span>{translate("routine.text.034")}</span>{historyDates.map((date) => { const occurrence = occurrenceByDate.get(date); const scheduled = isScheduled(routine, date); const className = occurrence?.done ? "routine-history routine-history--done" : scheduled ? "routine-history routine-history--missed" : "routine-history"; return <i aria-label={translate("routine.text.035", { value1: date, value2: occurrence?.done ? translate("todo.text.008") : scheduled ? translate("routine.text.038") : translate("routine.text.039") })} className={className} key={date} title={date} />; })}</div></div>
      <Button disabled={toggleMutation.isPending} onClick={onEdit} size="small">{translate("routine.text.036")}</Button>
      {mutationError && <div className="routine-card__error" role="alert"><Icon name="alert" size={12} />{mutationError}</div>}
    </article>
  );
}

function RoutineLoading() {
  return <div aria-label={translate("routine.text.037")} className="routine-page"><div className="routine-cards">{Array.from({ length: 3 }, (_, index) => <div className="routine-card routine-card--skeleton" key={index} />)}</div></div>;
}
