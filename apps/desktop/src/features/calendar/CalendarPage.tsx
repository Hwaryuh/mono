import { calendarCategoryWriteInputSchema, type CalendarCategory, type CalendarCategoryWriteInput, type CalendarEvent, type CalendarSnapshot, type CalendarWriteInput } from "@mono/contracts";
import { Button, ColorPicker, DatePicker, Icon, IconButton, Input, Modal, Select, TextArea, TimePicker } from "@mono/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router";
import type { CalendarRepository } from "./calendar-repository";

export const calendarQueryKey = ["calendar"] as const;
const dayNames = ["일", "월", "화", "수", "목", "금", "토"];
const maxVisibleEventsPerDay = 3;
// 월간 셀에서 이어지는 일정 막대를 몇 줄까지 그릴지. 넘치는 건 날짜별 일정 창에서 본다.
const maxSpanLanes = 3;

type CalendarView = "month" | "agenda";
type EditorItem = CalendarEvent | "new" | null;
type Draft = Omit<CalendarWriteInput, "startTime" | "endTime"> & { startTime: string; endTime: string };
type CategoryCommand =
  | { type: "create"; input: CalendarCategoryWriteInput }
  | { type: "update"; categoryId: string; input: CalendarCategoryWriteInput }
  | { type: "reorder"; categoryIds: string[] }
  | { type: "delete"; categoryId: string; replacementCategoryId: string };

const blankCategoryDraft: CalendarCategoryWriteInput = { name: "", color: "oklch(0.604 0.149 260.322)" };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "작업을 완료하지 못했습니다.";
}

function dateOf(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month, day));
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function monthKey(date: Date) {
  return date.toISOString().slice(0, 7);
}

function formatMonth(key: string) {
  const [year, month] = key.split("-").map(Number);
  return `${year}년 ${month}월`;
}

function formatDay(date: string) {
  const [, month, day] = date.split("-").map(Number);
  return `${month}월 ${day}일`;
}

function formatRange(event: CalendarEvent) {
  if (!event.startTime && !event.endTime) return "종일";
  if (event.startDate === event.endDate) return `${event.startTime ?? "00:00"}–${event.endTime ?? event.startTime ?? "00:00"}`;
  return `${formatDay(event.startDate)} ${event.startTime ?? "종일"}–${formatDay(event.endDate)} ${event.endTime ?? "종일"}`;
}

function eventTime(event: CalendarEvent) {
  return event.startTime ?? "종일";
}

function blankDraft(snapshot: CalendarSnapshot, selectedDate = snapshot.today): Draft {
  return {
    title: "",
    startDate: selectedDate,
    startTime: "09:00",
    endDate: selectedDate,
    endTime: "10:00",
    location: "",
    categoryId: snapshot.categories[0]?.id ?? "",
    note: "",
  };
}

function draftOf(event: CalendarEvent): Draft {
  return { ...event, startTime: event.startTime ?? "", endTime: event.endTime ?? "" };
}

function categoryOf(snapshot: CalendarSnapshot, event: CalendarEvent) {
  return snapshot.categories.find((category) => category.id === event.categoryId) ?? snapshot.categories[0];
}

function sortEvents(events: CalendarEvent[]) {
  return [...events].sort((left, right) => `${left.startDate} ${left.startTime ?? ""}`.localeCompare(`${right.startDate} ${right.startTime ?? ""}`));
}

function isMultiDay(event: CalendarEvent) {
  return event.startDate < event.endDate;
}

function coversDate(event: CalendarEvent, date: string) {
  return event.startDate <= date && event.endDate >= date;
}

type SpanSegment = {
  event: CalendarEvent;
  category?: CalendarCategory;
  week: number;
  startCol: number;
  endCol: number;
  lane: number;
  continuesLeft: boolean;
  continuesRight: boolean;
};

// 여러 날 이어지는 일정을 주 단위로 잘라, 겹치지 않게 줄(lane)을 배정한 막대 세그먼트로 만든다.
// laneByDate: 각 날짜 셀이 위쪽에 비워 둬야 할 막대 줄 수(그만큼 단일 일정 칩을 아래로 민다).
function computeMonthSpans(cells: Array<{ date: string }>, snapshot: CalendarSnapshot) {
  const multiDay = snapshot.events.filter(isMultiDay);
  const segments: SpanSegment[] = [];
  const laneByDate = new Map<string, number>();
  if (multiDay.length === 0) return { segments, laneByDate };

  for (let week = 0; week < cells.length / 7; week += 1) {
    const weekDates = cells.slice(week * 7, week * 7 + 7).map((cell) => cell.date);
    const weekStart = weekDates[0];
    const weekEnd = weekDates[6];
    const weekSegments = multiDay
      .filter((event) => event.startDate <= weekEnd && event.endDate >= weekStart)
      .map<SpanSegment>((event) => {
        const startInWeek = event.startDate < weekStart;
        const endInWeek = event.endDate > weekEnd;
        const startCol = startInWeek ? 0 : Math.max(0, weekDates.indexOf(event.startDate));
        const rawEndCol = weekDates.indexOf(event.endDate);
        return {
          event,
          category: categoryOf(snapshot, event),
          week,
          startCol,
          endCol: endInWeek || rawEndCol === -1 ? 6 : rawEndCol,
          lane: 0,
          continuesLeft: startInWeek,
          continuesRight: endInWeek,
        };
      })
      .sort((left, right) =>
        left.startCol - right.startCol
        || (right.endCol - right.startCol) - (left.endCol - left.startCol)
        || left.event.startDate.localeCompare(right.event.startDate)
        || left.event.id.localeCompare(right.event.id));

    const laneEnd: number[] = [];
    for (const segment of weekSegments) {
      let lane = laneEnd.findIndex((end) => end < segment.startCol);
      if (lane === -1) {
        lane = laneEnd.length;
        laneEnd.push(segment.endCol);
      } else {
        laneEnd[lane] = segment.endCol;
      }
      if (lane >= maxSpanLanes) continue;
      segment.lane = lane;
      segments.push(segment);
      for (let col = segment.startCol; col <= segment.endCol; col += 1) {
        const date = weekDates[col];
        laneByDate.set(date, Math.max(laneByDate.get(date) ?? 0, lane + 1));
      }
    }
  }
  return { segments, laneByDate };
}

export function CalendarPage({ repository }: { repository: CalendarRepository }) {
  const [view, setView] = useState<CalendarView>("month");
  const [visibleMonth, setVisibleMonth] = useState("");
  const [dayDialogDate, setDayDialogDate] = useState<string | null>(null);
  const [editorItem, setEditorItem] = useState<EditorItem>(null);
  const [draft, setDraft] = useState<Draft>({ title: "", startDate: "", startTime: "", endDate: "", endTime: "", location: "", categoryId: "", note: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [categoryDraft, setCategoryDraft] = useState<CalendarCategoryWriteInput>(blankCategoryDraft);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [deleteCategoryId, setDeleteCategoryId] = useState<string | null>(null);
  const [replacementCategoryId, setReplacementCategoryId] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const handledParamRef = useRef("");
  const viewRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const queryClient = useQueryClient();
  const snapshotQuery = useQuery({ queryKey: calendarQueryKey, queryFn: () => repository.getSnapshot() });

  const invalidateSnapshots = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: calendarQueryKey }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
  };
  const createMutation = useMutation({
    mutationFn: (input: CalendarWriteInput) => repository.create(input),
    onMutate: () => setFormError(null),
    onSuccess: async () => { await invalidateSnapshots(); closeEditor(true); },
    onError: (error) => setFormError(errorMessage(error)),
  });
  const updateMutation = useMutation({
    mutationFn: ({ eventId, input }: { eventId: string; input: CalendarWriteInput }) => repository.update(eventId, input),
    onMutate: () => setFormError(null),
    onSuccess: async () => { await invalidateSnapshots(); closeEditor(true); },
    onError: (error) => setFormError(errorMessage(error)),
  });
  const categoryMutation = useMutation({
    mutationFn: async (command: CategoryCommand) => {
      if (command.type === "create") await repository.createCategory(command.input);
      else if (command.type === "update") await repository.updateCategory(command.categoryId, command.input);
      else if (command.type === "reorder") await repository.reorderCategories(command.categoryIds);
      else await repository.deleteCategory(command.categoryId, command.replacementCategoryId);
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
        setDraft((current) => current.categoryId === command.categoryId ? { ...current, categoryId: command.replacementCategoryId } : current);
      }
      await invalidateSnapshots();
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>("#calendar-category-editor input")?.focus());
    },
    onError: (error) => setCategoryError(errorMessage(error)),
  });

  useEffect(() => {
    if (!visibleMonth && snapshotQuery.data) setVisibleMonth(snapshotQuery.data.today.slice(0, 7));
  }, [snapshotQuery.data, visibleMonth]);

  useEffect(() => {
    const snapshot = snapshotQuery.data;
    const modal = searchParams.get("modal");
    const id = searchParams.get("id") ?? "";
    const paramKey = `${modal ?? ""}:${id}`;
    if (!modal) { handledParamRef.current = ""; return; }
    if (!snapshot || handledParamRef.current === paramKey) return;
    handledParamRef.current = paramKey;
    if (modal === "new") {
      setDraft(blankDraft(snapshot));
      setEditorItem("new");
      setFormError(null);
    } else if (modal === "edit") {
      const item = snapshot.events.find((candidate) => candidate.id === id);
      if (item) openEditorState(item);
    }
  }, [searchParams, snapshotQuery.data]);

  if (snapshotQuery.isPending || !visibleMonth) return <CalendarLoading />;
  if (snapshotQuery.isError) return <div className="calendar-state" role="alert"><Icon name="alert" size={18} />일정을 불러오지 못했습니다.</div>;

  const snapshot = snapshotQuery.data;
  const monthEvents = sortEvents(snapshot.events.filter((event) => event.startDate.startsWith(visibleMonth)));
  const editorBusy = createMutation.isPending || updateMutation.isPending;
  const cells = monthCells(visibleMonth, snapshot.today, snapshot.events);
  const monthSpans = computeMonthSpans(cells, snapshot);
  const dayEvents = dayDialogDate ? sortEvents(snapshot.events.filter((event) => coversDate(event, dayDialogDate))) : [];

  function moveMonth(offset: number) {
    const [year, month] = visibleMonth.split("-").map(Number);
    setVisibleMonth(monthKey(dateOf(year, month - 1 + offset, 1)));
  }

  function openCreate(selectedDate = snapshot.today) {
    setDraft(blankDraft(snapshot, selectedDate));
    setEditorItem("new");
    setFormError(null);
    setSearchParams({ modal: "new" }, { replace: true });
  }

  function openEditorState(item: CalendarEvent) {
    setDayDialogDate(null);
    setDraft(draftOf(item));
    setEditorItem(item);
    setFormError(null);
  }

  function openEditor(item: CalendarEvent) {
    openEditorState(item);
    setSearchParams({ modal: "edit", id: item.id }, { replace: true });
  }

  function closeEditor(force = false) {
    if (editorBusy && !force) return;
    setEditorItem(null);
    setFormError(null);
    if (searchParams.has("modal")) setSearchParams({}, { replace: true });
  }

  function openCategoryManager() {
    setEditingCategoryId(null);
    setCategoryDraft(blankCategoryDraft);
    setCategoryError(null);
    setCategoryManagerOpen(true);
  }

  function closeCategoryManager() {
    if (categoryMutation.isPending) return;
    setCategoryManagerOpen(false);
    setEditingCategoryId(null);
    setDeleteCategoryId(null);
    setCategoryError(null);
  }

  function editCategory(category: CalendarCategory) {
    setEditingCategoryId(category.id);
    setCategoryDraft({ name: category.name, color: category.color });
    setCategoryError(null);
  }

  function submitCategory(event: FormEvent) {
    event.preventDefault();
    const parsed = calendarCategoryWriteInputSchema.safeParse(categoryDraft);
    if (!parsed.success) {
      setCategoryError(parsed.error.issues[0]?.message ?? "라벨 입력값을 확인해야 합니다.");
      return;
    }
    if (editingCategoryId) categoryMutation.mutate({ type: "update", categoryId: editingCategoryId, input: parsed.data });
    else categoryMutation.mutate({ type: "create", input: parsed.data });
  }

  function moveCategory(index: number, offset: -1 | 1) {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= snapshot.categories.length) return;
    const categoryIds = snapshot.categories.map((category) => category.id);
    [categoryIds[index], categoryIds[targetIndex]] = [categoryIds[targetIndex], categoryIds[index]];
    categoryMutation.mutate({ type: "reorder", categoryIds });
  }

  function openDeleteCategory(categoryId: string) {
    const replacement = snapshot.categories.find((category) => category.id !== categoryId);
    if (!replacement) return;
    setDeleteCategoryId(categoryId);
    setReplacementCategoryId(replacement.id);
    setCategoryError(null);
  }

  function setDraftField<Key extends keyof Draft>(key: Key, value: Draft[Key]) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const input: CalendarWriteInput = {
      ...draft,
      title: draft.title.trim(),
      location: draft.location.trim(),
      note: draft.note.trim(),
      startTime: draft.startTime || null,
      endTime: draft.endTime || null,
    };
    if (!input.title) { setFormError("제목을 입력해야 합니다."); return; }
    if (!input.startDate || !input.endDate) { setFormError("시작일과 종료일을 입력해야 합니다."); return; }
    if (!input.categoryId) { setFormError("라벨을 선택해야 합니다."); return; }
    if (Boolean(input.startTime) !== Boolean(input.endTime)) { setFormError("시작과 종료 시간을 모두 입력하거나 모두 비워야 합니다."); return; }
    const start = `${input.startDate}T${input.startTime ?? "00:00"}`;
    const end = `${input.endDate}T${input.endTime ?? "23:59"}`;
    if (end < start) { setFormError("종료 일시는 시작 일시보다 빠를 수 없습니다."); return; }
    if (editorItem === "new") createMutation.mutate(input);
    else if (editorItem) updateMutation.mutate({ eventId: editorItem.id, input });
  }

  function onViewKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % 2;
    else if (event.key === "ArrowLeft") next = (index + 1) % 2;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 1;
    else return;
    event.preventDefault();
    const nextView: CalendarView = next === 0 ? "month" : "agenda";
    setView(nextView);
    viewRefs.current[next]?.focus();
  }

  return (
    <div className="calendar-page">
      <div className="calendar-toolbar">
        <div className="calendar-toolbar__pager">
          <button aria-label="이전 달" onClick={() => moveMonth(-1)} type="button"><Icon name="arrowLeft" size={13} /></button>
          <button aria-label="다음 달" onClick={() => moveMonth(1)} type="button"><Icon name="chevronRight" size={13} /></button>
        </div>
        <strong>{formatMonth(visibleMonth)}</strong>
        <Button onClick={() => setVisibleMonth(snapshot.today.slice(0, 7))} size="small">오늘</Button>
        <div aria-label="일정 보기" className="calendar-view-tabs" role="tablist">
          {(["month", "agenda"] as const).map((candidate, index) => <button aria-selected={view === candidate} key={candidate} onClick={() => setView(candidate)} onKeyDown={(event) => onViewKeyDown(event, index)} ref={(element) => { viewRefs.current[index] = element; }} role="tab" tabIndex={view === candidate ? 0 : -1} type="button">{candidate === "month" ? "월" : "일정표"}</button>)}
        </div>
      </div>

      {view === "month" ? (
        <div className="calendar-month" role="tabpanel">
          <div className="calendar-weekdays">{dayNames.map((name) => <span key={name}>{name}</span>)}</div>
          <div className="calendar-grid">
            {cells.map((cell) => {
              const dayClassName = cell.today ? "calendar-cell__day calendar-cell__day--today" : "calendar-cell__day";
              const dayNumber = Number(cell.date.slice(-2));
              const spanLanes = monthSpans.laneByDate.get(cell.date) ?? 0;
              const coveringCount = snapshot.events.filter((event) => coversDate(event, cell.date)).length;
              return (
                <div className={cell.inMonth ? "calendar-cell" : "calendar-cell calendar-cell--outside"} key={cell.date}>
                  {coveringCount > 0
                    ? <button aria-label={`${formatDay(cell.date)} 일정 ${coveringCount}개 보기`} className={dayClassName} onClick={() => setDayDialogDate(cell.date)} type="button">{dayNumber}</button>
                    : <span className={dayClassName}>{dayNumber}</span>}
                  {spanLanes > 0 && <div className="calendar-cell__span-reserve" style={{ height: `calc(${spanLanes} * var(--cal-span-lane))` }} />}
                  {cell.events.slice(0, maxVisibleEventsPerDay).map((item) => <CalendarEventButton category={categoryOf(snapshot, item)} event={item} key={item.id} onClick={() => openEditor(item)} />)}
                  {cell.events.length > maxVisibleEventsPerDay && <span className="calendar-cell__more">+{cell.events.length - maxVisibleEventsPerDay}개 더</span>}
                </div>
              );
            })}
            {monthSpans.segments.length > 0 && (
              <div className="calendar-span-layer">
                {monthSpans.segments.map((segment) => (
                  <button
                    className={[
                      "calendar-span",
                      segment.continuesLeft && "calendar-span--from-before",
                      segment.continuesRight && "calendar-span--into-after",
                    ].filter(Boolean).join(" ")}
                    key={`${segment.event.id}-w${segment.week}`}
                    onClick={() => openEditor(segment.event)}
                    style={{
                      gridColumn: `${segment.startCol + 1} / ${segment.endCol + 2}`,
                      gridRow: segment.week + 1,
                      marginTop: `calc(var(--cal-span-top) + ${segment.lane} * var(--cal-span-lane))`,
                      "--event-color": segment.category?.color ?? "oklch(0.645 0.009 106.643)",
                    } as React.CSSProperties}
                    title={`${segment.event.title} · ${formatRange(segment.event)}`}
                    type="button"
                  >
                    {segment.continuesLeft && <Icon name="arrowLeft" size={10} />}
                    {!segment.continuesLeft && segment.event.startTime && <time>{segment.event.startTime}</time>}
                    <span>{segment.event.title}</span>
                    {segment.continuesRight && <Icon name="chevronRight" size={10} />}
                  </button>
                ))}
              </div>
            )}
            {monthEvents.length === 0 && <CalendarEmpty onCreate={() => openCreate(`${visibleMonth}-01`)} />}
          </div>
        </div>
      ) : (
        <div className="calendar-agenda" role="tabpanel">
          {agendaGroups(monthEvents).map((group) => <div className="calendar-agenda__group" key={group.date}><div className="calendar-agenda__date"><strong>{formatDay(group.date)}</strong><span className={group.date === snapshot.today ? "calendar-agenda__today" : ""}>{dayLabel(group.date, snapshot.today)}</span></div><div className="calendar-agenda__events">{group.events.map((item) => <AgendaEventButton category={categoryOf(snapshot, item)} event={item} key={item.id} onClick={() => openEditor(item)} />)}</div></div>)}
          {monthEvents.length === 0 && <CalendarEmpty onCreate={() => openCreate(`${visibleMonth}-01`)} />}
        </div>
      )}

      <Modal className="calendar-day-modal" icon="calendar" onClose={() => setDayDialogDate(null)} open={dayDialogDate !== null} title={<>{dayDialogDate ? formatDay(dayDialogDate) : ""}<small>일정 {dayEvents.length}개</small></>}>
        <div className="calendar-day-list">{dayEvents.map((item) => <AgendaEventButton category={categoryOf(snapshot, item)} event={item} key={item.id} onClick={() => openEditor(item)} />)}</div>
      </Modal>

      <Modal
        className="calendar-event-modal"
        footer={<><Button disabled={editorBusy} onClick={() => closeEditor()}>취소</Button><Button form="calendar-event-form" loading={editorBusy} type="submit" variant="primary">{editorItem === "new" ? "생성" : "저장"}</Button></>}
        icon="calendar"
        onClose={closeEditor}
        open={editorItem !== null}
        title={editorItem === "new" ? "새 일정" : "일정 수정"}
      >
        <form aria-busy={editorBusy} className="calendar-event-form" id="calendar-event-form" onSubmit={submit}>
          <label className="calendar-event-form__title"><span>제목</span><Input autoFocus maxLength={500} onChange={(event) => setDraftField("title", event.target.value)} value={draft.title} /></label>
          <DateTimeFields draft={draft} label="시작" onChange={setDraftField} prefix="start" />
          <DateTimeFields draft={draft} label="종료" onChange={setDraftField} prefix="end" />
          <label className="calendar-event-form__location-field"><span>장소</span><div className="calendar-event-form__location"><Icon name="location" size={12} /><Input maxLength={500} onChange={(event) => setDraftField("location", event.target.value)} value={draft.location} /></div></label>
          <fieldset aria-labelledby="calendar-event-category-label" className="calendar-event-form__category">
            <div className="calendar-event-form__category-header">
              <span id="calendar-event-category-label">라벨</span>
              <button disabled={editorBusy} onClick={openCategoryManager} type="button">관리</button>
            </div>
            <Select align="end" label="라벨" onChange={(value) => setDraftField("categoryId", value)} options={snapshot.categories.map((category) => ({ value: category.id, label: category.name, dotColor: category.color }))} value={draft.categoryId} />
          </fieldset>
          <label className="calendar-event-form__note"><span>메모</span><TextArea maxLength={4_000} onChange={(event) => setDraftField("note", event.target.value)} rows={3} value={draft.note} /></label>
          {formError && <div className="calendar-mutation-error" role="alert"><Icon name="alert" size={13} />{formError}</div>}
        </form>
      </Modal>

      <Modal className="calendar-category-modal" icon="calendar" onClose={closeCategoryManager} open={categoryManagerOpen} title="라벨 관리">
        <div className="calendar-category-manager">
          <div aria-label="일정 라벨" className="calendar-category-manager__list">
            {snapshot.categories.map((category, index) => {
              const usageCount = snapshot.events.filter((event) => event.categoryId === category.id).length;
              return (
                <div className="calendar-category-manager__row" key={category.id}>
                  <i style={{ backgroundColor: category.color }} />
                  <strong>{category.name}</strong>
                  <span>{usageCount}개</span>
                  <div>
                    <IconButton aria-label={`${category.name} 위로 이동`} disabled={categoryMutation.isPending || index === 0} onClick={() => moveCategory(index, -1)} size="small" title="위로 이동" type="button" variant="ghost"><Icon name="arrowUp" size={13} /></IconButton>
                    <IconButton aria-label={`${category.name} 아래로 이동`} disabled={categoryMutation.isPending || index === snapshot.categories.length - 1} onClick={() => moveCategory(index, 1)} size="small" title="아래로 이동" type="button" variant="ghost"><Icon name="arrowDown" size={13} /></IconButton>
                    <IconButton aria-label={`${category.name} 편집`} disabled={categoryMutation.isPending} onClick={() => editCategory(category)} size="small" title="편집" type="button" variant="ghost"><Icon name="edit" size={13} /></IconButton>
                    <IconButton aria-label={snapshot.categories.length === 1 ? `${category.name} 삭제 불가` : `${category.name} 삭제`} disabled={categoryMutation.isPending || snapshot.categories.length === 1} onClick={() => openDeleteCategory(category.id)} size="small" title={snapshot.categories.length === 1 ? "마지막 라벨은 삭제할 수 없습니다" : "삭제"} type="button" variant="ghost"><Icon name="trash" size={13} /></IconButton>
                  </div>
                </div>
              );
            })}
          </div>
          <form aria-busy={categoryMutation.isPending} className="calendar-category-editor" id="calendar-category-editor" onSubmit={submitCategory}>
            <div className="calendar-category-editor__header">
              <strong>{editingCategoryId ? "라벨 수정" : "새 라벨"}</strong>
              {editingCategoryId && <button disabled={categoryMutation.isPending} onClick={() => { setEditingCategoryId(null); setCategoryDraft(blankCategoryDraft); setCategoryError(null); }} type="button">취소</button>}
            </div>
            <div className="calendar-category-editor__controls">
              <ColorPicker disabled={categoryMutation.isPending} label="라벨 색상" onChange={(color) => setCategoryDraft((current) => ({ ...current, color }))} selected value={categoryDraft.color} />
              <Input aria-label="라벨 이름" autoFocus disabled={categoryMutation.isPending} maxLength={100} onChange={(event) => setCategoryDraft((current) => ({ ...current, name: event.target.value }))} placeholder="라벨 이름" value={categoryDraft.name} />
              <Button loading={categoryMutation.isPending} type="submit" variant="primary">{editingCategoryId ? "저장" : "추가"}</Button>
            </div>
            {categoryError && <div className="calendar-category-error" role="alert"><Icon name="alert" size={13} />{categoryError}</div>}
          </form>
        </div>
      </Modal>

      <Modal
        className="calendar-category-delete-modal"
        footer={<><Button disabled={categoryMutation.isPending} onClick={() => setDeleteCategoryId(null)}>취소</Button><Button loading={categoryMutation.isPending} onClick={() => deleteCategoryId && replacementCategoryId && categoryMutation.mutate({ type: "delete", categoryId: deleteCategoryId, replacementCategoryId })} variant="danger">삭제</Button></>}
        icon="alert"
        onClose={() => { if (!categoryMutation.isPending) setDeleteCategoryId(null); }}
        open={deleteCategoryId !== null}
        title="라벨 삭제"
      >
        <div className="calendar-category-delete">
          <p><strong>{snapshot.categories.find((category) => category.id === deleteCategoryId)?.name}</strong> 라벨을 삭제할까요?</p>
          <label>
            <span>기존 일정 이동</span>
            <Select disabled={categoryMutation.isPending} label="이동할 라벨" onChange={setReplacementCategoryId} options={snapshot.categories.filter((category) => category.id !== deleteCategoryId).map((category) => ({ value: category.id, label: category.name, dotColor: category.color }))} value={replacementCategoryId} />
          </label>
          <small>이 라벨을 사용 중인 일정은 모두 선택한 라벨로 이동합니다.</small>
          {categoryError && <div className="calendar-category-error" role="alert"><Icon name="alert" size={13} />{categoryError}</div>}
        </div>
      </Modal>
    </div>
  );
}

function monthCells(visibleMonth: string, today: string, events: CalendarEvent[]) {
  const [year, month] = visibleMonth.split("-").map(Number);
  const first = dateOf(year, month - 1, 1);
  const start = dateOf(year, month - 1, 1 - first.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = dateOf(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + index);
    const key = isoDate(date);
    // 여러 날 일정은 셀 칩이 아니라 이어지는 막대로 그린다.
    return { date: key, inMonth: key.startsWith(visibleMonth), today: key === today, events: sortEvents(events.filter((event) => event.startDate === key && !isMultiDay(event))) };
  });
}

function agendaGroups(events: CalendarEvent[]) {
  const groups = new Map<string, CalendarEvent[]>();
  events.forEach((event) => groups.set(event.startDate, [...(groups.get(event.startDate) ?? []), event]));
  return Array.from(groups, ([date, groupedEvents]) => ({ date, events: groupedEvents }));
}

function dayLabel(date: string, today: string) {
  const name = `${dayNames[new Date(`${date}T00:00:00Z`).getUTCDay()]}요일`;
  return date === today ? `${name} · 오늘` : name;
}

function CalendarEventButton({ event, category, onClick }: { event: CalendarEvent; category?: CalendarCategory; onClick: () => void }) {
  const color = category?.color ?? "oklch(0.645 0.009 106.643)";
  return <button className="calendar-event" onClick={onClick} style={{ "--event-color": color } as React.CSSProperties} title={`${event.title} · ${formatRange(event)}`} type="button"><time>{eventTime(event)}</time><span>{event.title}</span></button>;
}

function AgendaEventButton({ event, category, onClick }: { event: CalendarEvent; category?: CalendarCategory; onClick: () => void }) {
  return <button className="calendar-agenda-event" onClick={onClick} type="button"><i style={{ backgroundColor: category?.color ?? "oklch(0.645 0.009 106.643)" }} /><time>{formatRange(event)}</time><strong title={event.title}>{event.title}</strong><span title={event.location}>{event.location}</span></button>;
}

function DateTimeFields({ draft, label, prefix, onChange }: { draft: Draft; label: string; prefix: "start" | "end"; onChange: <Key extends keyof Draft>(key: Key, value: Draft[Key]) => void }) {
  const dateKey = `${prefix}Date` as "startDate" | "endDate";
  const timeKey = `${prefix}Time` as "startTime" | "endTime";
  return <fieldset className="calendar-event-form__date-time"><legend>{label}</legend><div><DatePicker align={prefix === "end" ? "end" : "start"} label={`${label} 날짜`} onChange={(value) => onChange(dateKey, value)} value={draft[dateKey]} /><TimePicker align={prefix === "end" ? "end" : "start"} label={`${label} 시간`} onChange={(value) => onChange(timeKey, value)} value={draft[timeKey]} /></div></fieldset>;
}

function CalendarEmpty({ onCreate }: { onCreate: () => void }) {
  return <div className="calendar-empty"><Icon name="calendar" size={28} /><strong>이 달에는 일정이 없습니다</strong><span>새 일정을 만들어 날짜와 시간을 정리하세요.</span><Button onClick={onCreate} variant="primary">새 일정</Button></div>;
}

function CalendarLoading() {
  return <div aria-label="일정 불러오는 중" className="calendar-page calendar-page--loading"><div className="calendar-toolbar" /><div className="calendar-month"><div className="calendar-grid calendar-grid--skeleton" /></div></div>;
}
