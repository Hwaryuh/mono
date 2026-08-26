import type { RoutineDefinition, RoutineOccurrence, RoutineSnapshot, RoutineWriteInput, TodoLabel } from "@mono/contracts";
import { Button, DatePicker, Icon, Input, Modal, Select } from "@mono/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { TodoLabelManagerModal } from "../todo/TodoLabelManagerModal";
import type { TodoRepository } from "../todo/todo-repository";
import type { RoutineRepository } from "./routine-repository";

export const routineQueryKey = ["routine"] as const;
const dayNames = ["일", "월", "화", "수", "목", "금", "토"];

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
  return error instanceof Error ? error.message : "작업을 완료하지 못했습니다.";
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
    mutationFn: ({ routineId, input }: { routineId: string; input: RoutineWriteInput }) => repository.update(routineId, input),
    onMutate: () => setFormError(null),
    onSuccess: async () => { await invalidateSnapshots(); closeEditor(true); },
    onError: (error) => setFormError(errorMessage(error)),
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
  if (snapshotQuery.isError) return <div className="routine-state" role="alert"><Icon name="alert" size={18} />루틴을 불러오지 못했습니다.</div>;
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
    if (!input.title) { setFormError("제목을 입력해야 합니다."); return; }
    if (input.days.length === 0) { setFormError("반복 요일을 하나 이상 골라야 합니다."); return; }
    if (!input.labelId) { setFormError("라벨을 선택해야 합니다."); return; }
    if (!draft.endless && !draft.endDate) { setFormError("종료일을 입력해야 합니다."); return; }
    if (editorItem === "new") createMutation.mutate(input);
    else if (editorItem) updateMutation.mutate({ routineId: editorItem.id, input });
  }

  const selectedDays = dayNames.filter((_, day) => draft.days.includes(day));

  return (
    <div className="routine-page">
      <div className="routine-notice"><Icon name="routine" size={14} /><span>지정한 요일이 오면 루틴은 <b>그날의 할 일</b>로 자동 생성됩니다. 기간이 끝나면 생성도 멈춥니다.</span></div>
      <div className="routine-cards">
        {snapshot.items.map((routine) => <RoutineCard key={routine.id} onEdit={() => openEditor(routine)} repository={repository} routine={routine} snapshot={snapshot} />)}
        {snapshot.items.length === 0 && <div className="routine-empty"><Icon name="routine" size={28} /><strong>아직 루틴이 없습니다</strong><span>반복할 일을 만들면 지정 요일의 할 일에 자동으로 나타납니다.</span><Button onClick={openCreate} variant="primary">새 루틴</Button></div>}
      </div>

      <Modal
        className="routine-editor-modal"
        footer={<><Button disabled={editorBusy} onClick={() => closeEditor()}>취소</Button><Button form="routine-editor-form" loading={editorBusy} type="submit" variant="primary">{editorItem === "new" ? "생성" : "저장"}</Button></>}
        icon="routine"
        onClose={closeEditor}
        open={editorItem !== null}
        title={editorItem === "new" ? "새 루틴" : "루틴 수정"}
      >
        <form className="routine-editor" id="routine-editor-form" onSubmit={submit}>
          <label><span>제목</span><Input autoFocus maxLength={500} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} placeholder="예: 비타민 먹기" value={draft.title} /></label>
          <fieldset><legend>반복 요일 <small>{draft.days.length === 7 ? "매일" : selectedDays.join(" · ") || "요일을 고르세요"}</small><Button onClick={() => setDraft((current) => ({ ...current, days: [0, 1, 2, 3, 4, 5, 6] }))} size="small" type="button" variant="text">매일</Button></legend>
            <div className="routine-editor__days" role="group" aria-label="반복 요일">{dayNames.map((name, day) => <button aria-pressed={draft.days.includes(day)} className={draft.days.includes(day) ? "routine-editor__day routine-editor__day--selected" : "routine-editor__day"} key={name} onClick={() => toggleDay(day)} type="button">{name}</button>)}</div>
          </fieldset>
          <fieldset><legend>기간</legend>
            <div className="routine-editor__period" role="radiogroup"><button aria-checked={draft.endless} onClick={() => setDraft((current) => ({ ...current, endless: true }))} role="radio" type="button">∞</button><button aria-checked={!draft.endless} onClick={() => setDraft((current) => ({ ...current, endless: false }))} role="radio" type="button">종료일 지정</button></div>
            {draft.endless ? <p>끝을 정하지 않습니다. 언제든 루틴 화면에서 기간을 수정할 수 있습니다.</p> : <div className="routine-editor__end"><DatePicker align="end" label="종료일" min={editorItem === "new" ? snapshot.today : undefined} onChange={(endDate) => setDraft((current) => ({ ...current, endDate }))} value={draft.endDate} /><span>이 날짜까지만 지정 요일에 할 일이 생성됩니다. 이후에는 비활성 상태가 됩니다.</span></div>}
          </fieldset>
          <fieldset className="routine-editor__label-fieldset">
            <legend className="todo-editor__label-legend"><span>라벨</span><button onClick={() => setLabelManagerOpen(true)} type="button">관리</button></legend>
            <Select label="라벨" onChange={(labelId) => setDraft((current) => ({ ...current, labelId }))} options={snapshot.labels.map((label) => ({ value: label.id, label: label.name, dotColor: label.color }))} value={draft.labelId} />
          </fieldset>
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
  const todayNote = expired ? "기간 만료" : startsLater ? "시작 전" : !availableToday ? "오늘은 해당 없음" : todayOccurrence?.done ? "오늘 완료" : "오늘 해야 함";
  const progressNote = expired ? "기간 만료" : startsLater ? "시작 전" : routine.endDate ? `${dayDifference(snapshot.today, routine.endDate)}일 남음` : "종료일 없음";

  return (
    <article aria-busy={toggleMutation.isPending} className={`routine-card ${expired ? "routine-card--expired" : ""}`}>
      <button aria-label={`${routine.title} ${todayOccurrence?.done ? "미완료" : "완료"} 처리`} aria-pressed={Boolean(todayOccurrence?.done)} className={todayOccurrence?.done ? "routine-card__check routine-card__check--done" : "routine-card__check"} disabled={!availableToday || toggleMutation.isPending} onClick={() => toggleMutation.mutate()} title={availableToday ? "오늘 완료" : todayNote} type="button"><Icon name="check" size={14} strokeWidth={3} /></button>
      <div className="routine-card__identity"><strong title={routine.title}>{routine.title}</strong><span><i style={{ backgroundColor: label?.color }} />{label?.name ?? "미지정"} · {todayNote}</span></div>
      <div className="routine-card__schedule"><span>반복 요일</span><div>{dayNames.map((name, day) => <i className={routine.days.includes(day) ? "routine-card__dow routine-card__dow--active" : "routine-card__dow"} key={name}>{name}</i>)}</div></div>
      <div className="routine-card__activity"><div className="routine-card__period"><span>기간</span><strong>{routine.endDate ? `~ ${formatShortDate(routine.endDate)}` : "∞"}</strong><small>{progressNote}</small></div><div className="routine-card__progress"><span style={{ width: `${progress}%` }} /></div><div className="routine-card__history"><span>최근 2주</span>{historyDates.map((date) => { const occurrence = occurrenceByDate.get(date); const scheduled = isScheduled(routine, date); const className = occurrence?.done ? "routine-history routine-history--done" : scheduled ? "routine-history routine-history--missed" : "routine-history"; return <i aria-label={`${date} ${occurrence?.done ? "완료" : scheduled ? "미완료" : "비지정"}`} className={className} key={date} title={date} />; })}</div></div>
      <Button disabled={toggleMutation.isPending} onClick={onEdit} size="small">수정</Button>
      {mutationError && <div className="routine-card__error" role="alert"><Icon name="alert" size={12} />{mutationError}</div>}
    </article>
  );
}

function RoutineLoading() {
  return <div aria-label="루틴 불러오는 중" className="routine-page"><div className="routine-notice" /><div className="routine-cards">{Array.from({ length: 3 }, (_, index) => <div className="routine-card routine-card--skeleton" key={index} />)}</div></div>;
}
