import { translate } from "../../i18n/i18n";
import { calendarCategoryWriteInputSchema, type CalendarCategory, type CalendarCategoryWriteInput, type CalendarEditScope, type CalendarEvent, type CalendarRecurrence, type CalendarSnapshot, type CalendarWriteInput, type RecurrenceFreq } from "@mono/contracts";
import { Button, ColorPicker, DatePicker, Icon, IconButton, Input, Modal, Select, TextArea, TimePicker } from "@mono/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router";
import { isConflictError } from "../../infrastructure/http/http-client";
import type { CalendarRepository } from "./calendar-repository";
import { calendarViewStateStoreOf, type CalendarView, type CalendarViewStateStore } from "./calendar-view-state-store";
import { addDays, weekdayOf } from "./recurrence";

export const calendarQueryKey = ["calendar"] as const;
const dayNames = [translate("routine.weekday.sun"), translate("routine.weekday.mon"), translate("routine.weekday.tue"), translate("routine.weekday.wed"), translate("routine.weekday.thu"), translate("routine.weekday.fri"), translate("routine.weekday.sat")];
const maxVisibleEventsPerDay = 3;
// 월간 셀에서 이어지는 일정 막대를 몇 줄까지 그릴지. 넘치는 건 날짜별 일정 창에서 본다.
const maxSpanLanes = 3;

type EditorItem = CalendarEvent | "new" | null;
type Draft = Omit<CalendarWriteInput, "startTime" | "endTime" | "recurrence"> & { startTime: string; endTime: string; recurrence: CalendarRecurrence | null };
type RecurrencePreset = "none" | "daily" | "weekly" | "weekdays" | "biweekly" | "monthly" | "yearly" | "custom";
type RecurrenceEnd = "never" | "until" | "count";
type CategoryCommand =
  | { type: "create"; input: CalendarCategoryWriteInput }
  | { type: "update"; categoryId: string; input: CalendarCategoryWriteInput; expectedVersion: number }
  | { type: "reorder"; categoryIds: string[] }
  | { type: "delete"; categoryId: string; replacementCategoryId: string };

const blankCategoryDraft: CalendarCategoryWriteInput = { name: "", color: "oklch(0.604 0.149 260.322)" };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : translate("common.error.actionFailed");
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
  return translate("calendar.date.month", { year, month });
}

function formatDay(date: string) {
  const [, month, day] = date.split("-").map(Number);
  return translate("calendar.date.monthDay", { month, day });
}

function formatRange(event: CalendarEvent) {
  if (!event.startTime && !event.endTime) return translate("calendar.time.allDay");
  if (event.startDate === event.endDate) return `${event.startTime ?? "00:00"}–${event.endTime ?? event.startTime ?? "00:00"}`;
  return translate("calendar.event.dateTimeRange", { startDate: formatDay(event.startDate), startTime: event.startTime ?? translate("calendar.time.allDay"), endDate: formatDay(event.endDate), endTime: event.endTime ?? translate("calendar.time.allDay") });
}

function eventTime(event: CalendarEvent) {
  return event.startTime ?? translate("calendar.time.allDay");
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
    recurrence: null,
  };
}

function draftOf(event: CalendarEvent): Draft {
  return {
    title: event.title,
    startDate: event.startDate,
    startTime: event.startTime ?? "",
    endDate: event.endDate,
    endTime: event.endTime ?? "",
    location: event.location,
    categoryId: event.categoryId,
    note: event.note,
    recurrence: event.recurrence,
  };
}

const monFri = [1, 2, 3, 4, 5];
const sameWeekdays = (left: number[], right: number[]) =>
  left.length === right.length && [...left].sort().join() === [...right].sort().join();

function recurrenceToPreset(rule: CalendarRecurrence | null, startDate: string): RecurrencePreset {
  if (!rule) return "none";
  const naturalWeekday = [weekdayOf(startDate)];
  const isNatural = rule.weekdays.length === 0 || sameWeekdays(rule.weekdays, naturalWeekday);
  if (rule.freq === "daily" && rule.interval === 1) return "daily";
  if (rule.freq === "weekly" && rule.interval === 1 && isNatural) return "weekly";
  if (rule.freq === "weekly" && rule.interval === 1 && sameWeekdays(rule.weekdays, monFri)) return "weekdays";
  if (rule.freq === "weekly" && rule.interval === 2 && isNatural) return "biweekly";
  if (rule.freq === "monthly" && rule.interval === 1) return "monthly";
  if (rule.freq === "yearly" && rule.interval === 1) return "yearly";
  return "custom";
}

function presetToRecurrence(preset: RecurrencePreset, startDate: string, prev: CalendarRecurrence | null): CalendarRecurrence | null {
  const end = { until: prev?.until ?? null, count: prev?.count ?? null };
  switch (preset) {
    case "none": return null;
    case "daily": return { freq: "daily", interval: 1, weekdays: [], ...end };
    case "weekly": return { freq: "weekly", interval: 1, weekdays: [weekdayOf(startDate)], ...end };
    case "weekdays": return { freq: "weekly", interval: 1, weekdays: monFri, ...end };
    case "biweekly": return { freq: "weekly", interval: 2, weekdays: [weekdayOf(startDate)], ...end };
    case "monthly": return { freq: "monthly", interval: 1, weekdays: [], ...end };
    case "yearly": return { freq: "yearly", interval: 1, weekdays: [], ...end };
    case "custom": return prev ?? { freq: "weekly", interval: 1, weekdays: [weekdayOf(startDate)], until: null, count: null };
  }
}

function recurrenceSummary(rule: CalendarRecurrence, startDate: string): string {
  const every = rule.interval > 1 ? `${rule.interval}` : "";
  const unit = { daily: translate("routine.weekday.sun"), weekly: translate("calendar.recurrence.unit.week"), monthly: translate("calendar.recurrence.unit.month"), yearly: translate("calendar.recurrence.unit.year") }[rule.freq];
  let base = every ? translate("calendar.recurrence.intervalSummary", { interval: every, unit }) : { daily: translate("routine.recurrence.daily"), weekly: translate("calendar.recurrence.weekly"), monthly: translate("calendar.recurrence.monthly"), yearly: translate("calendar.recurrence.yearly") }[rule.freq];
  if (rule.freq === "weekly") {
    const days = (rule.weekdays.length ? rule.weekdays : [weekdayOf(startDate)]).slice().sort((a, b) => a - b).map((d) => dayNames[d]);
    base = `${base} ${days.join("·")}`;
  }
  if (rule.until) return translate("calendar.recurrence.untilSummary", { summary: base, endDate: formatDay(rule.until) });
  if (rule.count) return translate("calendar.recurrence.countSummary", { summary: base, count: rule.count });
  return base;
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

function gridRange(visibleMonth: string): { from: string; to: string } {
  const [year, month] = visibleMonth.split("-").map(Number);
  const first = dateOf(year, month - 1, 1);
  const gridStart = dateOf(year, month - 1, 1 - first.getUTCDay());
  const start = isoDate(gridStart);
  // 6주 그리드 42일 + 앞뒤 1주 여유.
  return { from: addDays(start, -7), to: addDays(start, 48) };
}

export function CalendarPage({ repository, viewStateStore }: { repository: CalendarRepository; viewStateStore?: CalendarViewStateStore }) {
  const [store] = useState(() => viewStateStore ?? calendarViewStateStoreOf());
  const [viewState, setViewState] = useState(() => store.read());
  const { view, visibleMonth } = viewState;
  // 월 전환 애니메이션 방향: 1 = 다음 달(왼쪽으로 슬라이드), -1 = 이전 달, 0 = 애니메이션 없음.
  const [slideDir, setSlideDir] = useState<-1 | 0 | 1>(0);
  const [dayDialogDate, setDayDialogDate] = useState<string | null>(null);
  const [editorItem, setEditorItem] = useState<EditorItem>(null);
  const [draft, setDraft] = useState<Draft>({ title: "", startDate: "", startTime: "", endDate: "", endTime: "", location: "", categoryId: "", note: "", recurrence: null });
  const [formError, setFormError] = useState<string | null>(null);
  // 반복 시리즈의 occurrence를 저장/삭제할 때 범위를 고르는 다이얼로그.
  const [scopePrompt, setScopePrompt] = useState<{ mode: "save" | "delete"; event: CalendarEvent; input?: CalendarWriteInput } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingCategoryVersion, setEditingCategoryVersion] = useState(1);
  const [categoryDraft, setCategoryDraft] = useState<CalendarCategoryWriteInput>(blankCategoryDraft);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [deleteCategoryId, setDeleteCategoryId] = useState<string | null>(null);
  const [replacementCategoryId, setReplacementCategoryId] = useState("");
  const [searchParams, setSearchParams] = useSearchParams();
  const handledParamRef = useRef("");
  const viewRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const moveMonth = useCallback((offset: number) => {
    setSlideDir(offset > 0 ? 1 : -1);
    setViewState((current) => {
      const [year, month] = current.visibleMonth.split("-").map(Number);
      const next = { ...current, visibleMonth: monthKey(dateOf(year, month - 1 + offset, 1)) };
      store.write(next);
      return next;
    });
  }, [store]);

  // macOS 트랙패드 두 손가락 좌우 스와이프로 이전/다음 달 이동. 세로 스크롤과 모달 위에서는 무시.
  // 콜백 ref로 붙여 로딩 → 로드 전환 시점에도 확실히 리스너가 걸리게 한다.
  const wheelNavCleanup = useRef<(() => void) | undefined>(undefined);
  const attachWheelNav = useCallback((node: HTMLDivElement | null) => {
    wheelNavCleanup.current?.();
    wheelNavCleanup.current = undefined;
    if (!node) return;
    let accum = 0;
    let locked = false;
    let resetTimer: number | undefined;
    const onWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      if (document.querySelector(".ui-overlay")) return;
      event.preventDefault();
      if (locked) return;
      accum += event.deltaX;
      window.clearTimeout(resetTimer);
      resetTimer = window.setTimeout(() => { accum = 0; }, 140);
      if (Math.abs(accum) < 64) return;
      const dir = accum > 0 ? 1 : -1;
      accum = 0;
      locked = true;
      window.setTimeout(() => { locked = false; }, 420);
      moveMonth(dir);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    wheelNavCleanup.current = () => {
      node.removeEventListener("wheel", onWheel);
      window.clearTimeout(resetTimer);
    };
  }, [moveMonth]);
  const queryClient = useQueryClient();
  const range = gridRange(visibleMonth);
  const snapshotQuery = useQuery({
    queryKey: [...calendarQueryKey, range.from, range.to],
    queryFn: () => repository.getSnapshot(range),
  });

  const invalidateSnapshots = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: calendarQueryKey }),
      queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    ]);
  };
  // 스냅샷 쿼리 키에 표시 범위가 붙어 있어 고정 키로 읽을 수 없다 — 무효화 뒤 캐시된 범위들에서 찾는다.
  const resyncCalendarVersion = async (pick: (snapshot: CalendarSnapshot) => { version?: number } | undefined): Promise<number | null> => {
    await invalidateSnapshots();
    for (const [, snapshot] of queryClient.getQueriesData<CalendarSnapshot>({ queryKey: calendarQueryKey })) {
      const found = snapshot && pick(snapshot);
      if (found) return found.version ?? null;
    }
    return null;
  };
  const createMutation = useMutation({
    mutationFn: (input: CalendarWriteInput) => repository.create(input),
    onMutate: () => setFormError(null),
    onSuccess: async () => { await invalidateSnapshots(); closeEditor(true); },
    onError: (error) => setFormError(errorMessage(error)),
  });
  const updateMutation = useMutation({
    mutationFn: ({ eventId, input, scope, expectedVersion }: { eventId: string; input: CalendarWriteInput; scope?: CalendarEditScope; expectedVersion: number }) =>
      repository.update(eventId, input, scope, expectedVersion),
    onMutate: () => setFormError(null),
    onSuccess: async () => { await invalidateSnapshots(); setScopePrompt(null); closeEditor(true); },
    onError: async (error) => {
      setFormError(errorMessage(error));
      if (isConflictError(error) && editorItem && editorItem !== "new") {
        const version = await resyncCalendarVersion((snapshot) => snapshot.events.find((candidate) => candidate.id === editorItem.id));
        if (version !== null) setEditorItem((current) => (current && current !== "new" ? { ...current, version } : current));
      }
    },
  });
  const deleteMutation = useMutation({
    mutationFn: ({ eventId, scope }: { eventId: string; scope?: CalendarEditScope }) => repository.remove(eventId, scope),
    onMutate: () => setFormError(null),
    onSuccess: async () => { await invalidateSnapshots(); setScopePrompt(null); setDeleteConfirm(false); closeEditor(true); },
    onError: (error) => setFormError(errorMessage(error)),
  });
  const categoryMutation = useMutation({
    mutationFn: async (command: CategoryCommand) => {
      if (command.type === "create") await repository.createCategory(command.input);
      else if (command.type === "update") await repository.updateCategory(command.categoryId, command.input, command.expectedVersion);
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
    onError: async (error) => {
      setCategoryError(errorMessage(error));
      if (isConflictError(error) && editingCategoryId) {
        const version = await resyncCalendarVersion((snapshot) => snapshot.categories.find((candidate) => candidate.id === editingCategoryId));
        if (version !== null) setEditingCategoryVersion(version);
      }
    },
  });

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

  if (snapshotQuery.isPending) return <CalendarLoading />;
  if (snapshotQuery.isError) return <div className="calendar-state" role="alert"><Icon name="alert" size={18} />{translate("calendar.error.load")}</div>;

  const snapshot = snapshotQuery.data;
  const monthEvents = sortEvents(snapshot.events.filter((event) => event.startDate.startsWith(visibleMonth)));
  const editorBusy = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;
  const editingEvent = editorItem && editorItem !== "new" ? editorItem : null;
  const cells = monthCells(visibleMonth, snapshot.today, snapshot.events);
  const monthSpans = computeMonthSpans(cells, snapshot);
  const dayEvents = dayDialogDate ? sortEvents(snapshot.events.filter((event) => coversDate(event, dayDialogDate))) : [];

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
    setDeleteConfirm(false);
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
    setEditingCategoryVersion(category.version ?? 1);
    setCategoryDraft({ name: category.name, color: category.color });
    setCategoryError(null);
  }

  function submitCategory(event: FormEvent) {
    event.preventDefault();
    const parsed = calendarCategoryWriteInputSchema.safeParse(categoryDraft);
    if (!parsed.success) {
      setCategoryError(parsed.error.issues[0]?.message ?? translate("common.validation.labelInvalid"));
      return;
    }
    if (editingCategoryId) categoryMutation.mutate({ type: "update", categoryId: editingCategoryId, input: parsed.data, expectedVersion: editingCategoryVersion });
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

  function draftToInput(): CalendarWriteInput | null {
    const input: CalendarWriteInput = {
      title: draft.title.trim(),
      startDate: draft.startDate,
      startTime: draft.startTime || null,
      endDate: draft.endDate,
      endTime: draft.endTime || null,
      location: draft.location.trim(),
      categoryId: draft.categoryId,
      note: draft.note.trim(),
      recurrence: draft.recurrence,
    };
    if (!input.title) { setFormError(translate("common.validation.titleRequired")); return null; }
    if (!input.startDate || !input.endDate) { setFormError(translate("calendar.validation.dateRangeRequired")); return null; }
    if (!input.categoryId) { setFormError(translate("common.validation.labelRequired")); return null; }
    if (Boolean(input.startTime) !== Boolean(input.endTime)) { setFormError(translate("calendar.validation.timeRangeIncomplete")); return null; }
    const start = `${input.startDate}T${input.startTime ?? "00:00"}`;
    const end = `${input.endDate}T${input.endTime ?? "23:59"}`;
    if (end < start) { setFormError(translate("calendar.validation.endBeforeStart")); return null; }
    if (input.recurrence?.until && input.recurrence.until < input.startDate) {
      setFormError(translate("calendar.validation.recurrenceEndBeforeStart")); return null;
    }
    return input;
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const input = draftToInput();
    if (!input) return;
    if (editorItem === "new") { createMutation.mutate(input); return; }
    if (!editingEvent) return;
    // 반복 시리즈의 한 회차를 고치는 중이면 범위를 먼저 묻는다.
    if (editingEvent.seriesId) { setScopePrompt({ mode: "save", event: editingEvent, input }); return; }
    updateMutation.mutate({ eventId: editingEvent.id, input, expectedVersion: editingEvent.version ?? 1 });
  }

  function requestDelete() {
    if (!editingEvent) return;
    // 반복 일정은 범위 선택 다이얼로그가 확인 단계를 겸한다. 단발 일정은 확인 모달.
    if (editingEvent.seriesId) { setScopePrompt({ mode: "delete", event: editingEvent }); return; }
    setDeleteConfirm(true);
  }

  function runScope(scope: CalendarEditScope) {
    if (!scopePrompt) return;
    if (scopePrompt.mode === "save" && scopePrompt.input) {
      updateMutation.mutate({ eventId: scopePrompt.event.id, input: scopePrompt.input, scope, expectedVersion: scopePrompt.event.version ?? 1 });
    } else if (scopePrompt.mode === "delete") {
      deleteMutation.mutate({ eventId: scopePrompt.event.id, scope });
    }
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
    selectView(nextView);
    viewRefs.current[next]?.focus();
  }

  function selectView(nextView: CalendarView) {
    setViewState((current) => {
      const next = { ...current, view: nextView };
      store.write(next);
      return next;
    });
  }

  function showCurrentMonth() {
    setSlideDir(0);
    setViewState((current) => {
      const next = { ...current, visibleMonth: snapshot.today.slice(0, 7) };
      store.write(next);
      return next;
    });
  }

  return (
    <div className="calendar-page" data-slide={slideDir} ref={attachWheelNav}>
      <div className="calendar-toolbar">
        <div className="calendar-toolbar__pager">
          <button aria-label={translate("calendar.navigation.previousMonth")} onClick={() => moveMonth(-1)} type="button"><Icon name="arrowLeft" size={13} /></button>
          <button aria-label={translate("calendar.navigation.nextMonth")} onClick={() => moveMonth(1)} type="button"><Icon name="chevronRight" size={13} /></button>
        </div>
        <strong>{formatMonth(visibleMonth)}</strong>
        <Button onClick={showCurrentMonth} size="small">{translate("todo.filter.today")}</Button>
        <div aria-label={translate("calendar.view.label")} className="calendar-view-tabs" role="tablist">
          {(["month", "agenda"] as const).map((candidate, index) => <button aria-selected={view === candidate} key={candidate} onClick={() => selectView(candidate)} onKeyDown={(event) => onViewKeyDown(event, index)} ref={(element) => { viewRefs.current[index] = element; }} role="tab" tabIndex={view === candidate ? 0 : -1} type="button">{candidate === "month" ? translate("routine.weekday.mon") : translate("calendar.view.agenda")}</button>)}
        </div>
      </div>

      {view === "month" ? (
        <div className="calendar-month" role="tabpanel">
          <div className="calendar-weekdays">{dayNames.map((name) => <span key={name}>{name}</span>)}</div>
          <div className="calendar-grid" key={visibleMonth}>
            {cells.map((cell) => {
              const dayClassName = cell.today ? "calendar-cell__day calendar-cell__day--today" : "calendar-cell__day";
              const dayNumber = Number(cell.date.slice(-2));
              const spanLanes = monthSpans.laneByDate.get(cell.date) ?? 0;
              const coveringCount = snapshot.events.filter((event) => coversDate(event, cell.date)).length;
              return (
                <div className={cell.inMonth ? "calendar-cell" : "calendar-cell calendar-cell--outside"} key={cell.date}>
                  {coveringCount > 0
                    ? <button aria-label={translate("calendar.day.openEvents", { date: formatDay(cell.date), count: coveringCount })} className={dayClassName} onClick={() => setDayDialogDate(cell.date)} type="button">{dayNumber}</button>
                    : <span className={dayClassName}>{dayNumber}</span>}
                  {spanLanes > 0 && <div className="calendar-cell__span-reserve" style={{ height: `calc(${spanLanes} * var(--cal-span-lane))` }} />}
                  {cell.events.slice(0, maxVisibleEventsPerDay).map((item) => <CalendarEventButton category={categoryOf(snapshot, item)} event={item} key={item.id} onClick={() => openEditor(item)} />)}
                  {cell.events.length > maxVisibleEventsPerDay && <span className="calendar-cell__more">{translate("calendar.day.moreEvents", { count: cell.events.length - maxVisibleEventsPerDay })}</span>}
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
                    {segment.event.seriesId && <Icon name="routine" size={9} strokeWidth={1.8} />}
                    {segment.continuesRight && <Icon name="chevronRight" size={10} />}
                  </button>
                ))}
              </div>
            )}
            {monthEvents.length === 0 && <CalendarEmpty onCreate={() => openCreate(`${visibleMonth}-01`)} />}
          </div>
        </div>
      ) : (
        <div className="calendar-agenda" key={visibleMonth} role="tabpanel">
          {agendaGroups(monthEvents).map((group) => <div className="calendar-agenda__group" key={group.date}><div className="calendar-agenda__date"><strong>{formatDay(group.date)}</strong><span className={group.date === snapshot.today ? "calendar-agenda__today" : ""}>{dayLabel(group.date, snapshot.today)}</span></div><div className="calendar-agenda__events">{group.events.map((item) => <AgendaEventButton category={categoryOf(snapshot, item)} event={item} key={item.id} onClick={() => openEditor(item)} />)}</div></div>)}
          {monthEvents.length === 0 && <CalendarEmpty onCreate={() => openCreate(`${visibleMonth}-01`)} />}
        </div>
      )}

      <Modal className="calendar-day-modal" icon="calendar" onClose={() => setDayDialogDate(null)} open={dayDialogDate !== null} title={<>{dayDialogDate ? formatDay(dayDialogDate) : ""}<small>{translate("calendar.day.eventCount", { count: dayEvents.length })}</small></>}>
        <div className="calendar-day-list">{dayEvents.map((item) => <AgendaEventButton category={categoryOf(snapshot, item)} event={item} key={item.id} onClick={() => openEditor(item)} />)}</div>
      </Modal>

      <Modal
        className="calendar-event-modal"
        footer={<>
          {editingEvent && <Button className="calendar-event-modal__delete" disabled={editorBusy} onClick={requestDelete} variant="ghost">{translate("common.action.delete")}</Button>}
          <Button disabled={editorBusy} onClick={() => closeEditor()}>{translate("common.action.cancel")}</Button>
          <Button form="calendar-event-form" loading={createMutation.isPending || updateMutation.isPending} type="submit" variant="primary">{editorItem === "new" ? translate("routine.action.create") : translate("common.action.save")}</Button>
        </>}
        icon="calendar"
        onClose={closeEditor}
        open={editorItem !== null}
        title={editorItem === "new" ? translate("app.action.newCalendar") : translate("calendar.action.editEvent")}
      >
        <form aria-busy={editorBusy} className="calendar-event-form" id="calendar-event-form" onSubmit={submit}>
          <label className="calendar-event-form__title"><span>{translate("common.field.title")}</span><Input autoFocus maxLength={500} onChange={(event) => setDraftField("title", event.target.value)} value={draft.title} /></label>
          <DateTimeFields draft={draft} label={translate("calendar.field.start")} onChange={setDraftField} prefix="start" />
          <DateTimeFields draft={draft} label={translate("calendar.field.end")} onChange={setDraftField} prefix="end" />
          <RecurrenceField
            disabled={editorBusy}
            onChange={(recurrence) => setDraftField("recurrence", recurrence)}
            startDate={draft.startDate}
            value={draft.recurrence}
          />
          <label className="calendar-event-form__location-field"><span>{translate("common.field.location")}</span><div className="calendar-event-form__location"><Icon name="location" size={12} /><Input maxLength={500} onChange={(event) => setDraftField("location", event.target.value)} value={draft.location} /></div></label>
          <fieldset aria-labelledby="calendar-event-category-label" className="calendar-event-form__category">
            <div className="calendar-event-form__category-header">
              <span id="calendar-event-category-label">{translate("common.field.label")}</span>
              <button disabled={editorBusy} onClick={openCategoryManager} type="button">{translate("common.action.manage")}</button>
            </div>
            <Select align="end" label={translate("common.field.label")} onChange={(value) => setDraftField("categoryId", value)} options={snapshot.categories.map((category) => ({ value: category.id, label: category.name, dotColor: category.color }))} value={draft.categoryId} />
          </fieldset>
          <label className="calendar-event-form__note"><span>{translate("common.field.note")}</span><TextArea maxLength={4_000} onChange={(event) => setDraftField("note", event.target.value)} rows={3} value={draft.note} /></label>
          {formError && <div className="calendar-mutation-error" role="alert"><Icon name="alert" size={13} />{formError}</div>}
        </form>
      </Modal>

      <Modal
        className="calendar-scope-modal"
        footer={<Button disabled={editorBusy} onClick={() => setScopePrompt(null)}>{translate("common.action.cancel")}</Button>}
        icon={scopePrompt?.mode === "delete" ? "trash" : "calendar"}
        onClose={() => { if (!editorBusy) setScopePrompt(null); }}
        open={scopePrompt !== null}
        title={scopePrompt?.mode === "delete" ? translate("calendar.scope.deleteTitle") : translate("calendar.scope.editTitle")}
      >
        <div className="calendar-scope">
          <p>{translate("calendar.scope.prompt", { title: scopePrompt?.event.title ?? "", action: scopePrompt?.mode === "delete" ? translate("common.action.delete") : translate("calendar.scope.applyAction") })}</p>
          <div className="calendar-scope__choices">
            <button className="calendar-scope__choice" disabled={editorBusy} onClick={() => runScope("this")} type="button">
              <strong>{translate("calendar.scope.thisEvent")}</strong><span>{translate("calendar.scope.singleDay", { date: scopePrompt?.event.occurrenceDate ? formatDay(scopePrompt.event.occurrenceDate) : "" })}</span>
            </button>
            <button className="calendar-scope__choice" disabled={editorBusy} onClick={() => runScope("future")} type="button">
              <strong>{translate("calendar.scope.futureEvents")}</strong><span>{translate("calendar.scope.futureDescription")}</span>
            </button>
            <button className="calendar-scope__choice" disabled={editorBusy} onClick={() => runScope("all")} type="button">
              <strong>{translate("calendar.scope.allEvents")}</strong><span>{translate("calendar.scope.allDescription")}</span>
            </button>
          </div>
          {formError && <div className="calendar-mutation-error" role="alert"><Icon name="alert" size={13} />{formError}</div>}
        </div>
      </Modal>

      <Modal
        className="calendar-category-delete-modal"
        footer={<><Button disabled={deleteMutation.isPending} onClick={() => setDeleteConfirm(false)}>{translate("common.action.cancel")}</Button><Button loading={deleteMutation.isPending} onClick={() => editingEvent && deleteMutation.mutate({ eventId: editingEvent.id })} variant="danger">{translate("common.action.delete")}</Button></>}
        icon="alert"
        onClose={() => { if (!deleteMutation.isPending) setDeleteConfirm(false); }}
        open={deleteConfirm}
        title={translate("calendar.delete.title")}
      >
        <div className="calendar-category-delete">
          <p>{translate("calendar.delete.confirm", { title: editingEvent?.title ?? "" })}</p>
          {formError && <div className="calendar-mutation-error" role="alert"><Icon name="alert" size={13} />{formError}</div>}
        </div>
      </Modal>

      <Modal className="calendar-category-modal" icon="calendar" onClose={closeCategoryManager} open={categoryManagerOpen} title={translate("common.labels.manage")}>
        <div className="calendar-category-manager">
          <div aria-label={translate("inbox.labels.calendar")} className="calendar-category-manager__list">
            {snapshot.categories.map((category, index) => {
              const usageCount = snapshot.events.filter((event) => event.categoryId === category.id).length;
              return (
                <div className="calendar-category-manager__row" key={category.id}>
                  <i style={{ backgroundColor: category.color }} />
                  <strong>{category.name}</strong>
                  <span>{usageCount}{translate("common.unit.items")}</span>
                  <div>
                    <IconButton aria-label={translate("common.action.moveUpLabel", { name: category.name })} disabled={categoryMutation.isPending || index === 0} onClick={() => moveCategory(index, -1)} size="small" title={translate("common.action.moveUp")} type="button" variant="ghost"><Icon name="arrowUp" size={13} /></IconButton>
                    <IconButton aria-label={translate("common.action.moveDownLabel", { name: category.name })} disabled={categoryMutation.isPending || index === snapshot.categories.length - 1} onClick={() => moveCategory(index, 1)} size="small" title={translate("common.action.moveDown")} type="button" variant="ghost"><Icon name="arrowDown" size={13} /></IconButton>
                    <IconButton aria-label={translate("common.action.editLabel", { name: category.name })} disabled={categoryMutation.isPending} onClick={() => editCategory(category)} size="small" title={translate("common.action.edit")} type="button" variant="ghost"><Icon name="edit" size={13} /></IconButton>
                    <IconButton aria-label={snapshot.categories.length === 1 ? translate("common.action.deleteDisabledLabel", { name: category.name }) : translate("common.action.deleteLabel", { name: category.name })} disabled={categoryMutation.isPending || snapshot.categories.length === 1} onClick={() => openDeleteCategory(category.id)} size="small" title={snapshot.categories.length === 1 ? translate("common.labels.lastDeleteDisabled") : translate("common.action.delete")} type="button" variant="ghost"><Icon name="trash" size={13} /></IconButton>
                  </div>
                </div>
              );
            })}
          </div>
          <form aria-busy={categoryMutation.isPending} className="calendar-category-editor" id="calendar-category-editor" onSubmit={submitCategory}>
            <div className="calendar-category-editor__header">
              <strong>{editingCategoryId ? translate("common.labels.edit") : translate("common.labels.new")}</strong>
              {editingCategoryId && <button disabled={categoryMutation.isPending} onClick={() => { setEditingCategoryId(null); setCategoryDraft(blankCategoryDraft); setCategoryError(null); }} type="button">{translate("common.action.cancel")}</button>}
            </div>
            <div className="calendar-category-editor__controls">
              <ColorPicker disabled={categoryMutation.isPending} label={translate("common.labels.color")} onChange={(color) => setCategoryDraft((current) => ({ ...current, color }))} selected value={categoryDraft.color} />
              <Input aria-label={translate("common.labels.name")} autoFocus disabled={categoryMutation.isPending} maxLength={100} onChange={(event) => setCategoryDraft((current) => ({ ...current, name: event.target.value }))} placeholder={translate("common.labels.name")} value={categoryDraft.name} />
              <Button loading={categoryMutation.isPending} type="submit" variant="primary">{editingCategoryId ? translate("common.action.save") : translate("common.action.add")}</Button>
            </div>
            {categoryError && <div className="calendar-category-error" role="alert"><Icon name="alert" size={13} />{categoryError}</div>}
          </form>
        </div>
      </Modal>

      <Modal
        className="calendar-category-delete-modal"
        footer={<><Button disabled={categoryMutation.isPending} onClick={() => setDeleteCategoryId(null)}>{translate("common.action.cancel")}</Button><Button loading={categoryMutation.isPending} onClick={() => deleteCategoryId && replacementCategoryId && categoryMutation.mutate({ type: "delete", categoryId: deleteCategoryId, replacementCategoryId })} variant="danger">{translate("common.action.delete")}</Button></>}
        icon="alert"
        onClose={() => { if (!categoryMutation.isPending) setDeleteCategoryId(null); }}
        open={deleteCategoryId !== null}
        title={translate("common.labels.deleteTitle")}
      >
        <div className="calendar-category-delete">
          <p>{translate("common.labels.deleteQuestion", { name: snapshot.categories.find((category) => category.id === deleteCategoryId)?.name ?? "" })}</p>
          <label>
            <span>{translate("calendar.labels.moveExisting")}</span>
            <Select disabled={categoryMutation.isPending} label={translate("common.labels.moveTarget")} onChange={setReplacementCategoryId} options={snapshot.categories.filter((category) => category.id !== deleteCategoryId).map((category) => ({ value: category.id, label: category.name, dotColor: category.color }))} value={replacementCategoryId} />
          </label>
          <small>{translate("calendar.labels.moveExistingDescription")}</small>
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
  const name = translate("calendar.weekday.full", { name: dayNames[new Date(`${date}T00:00:00Z`).getUTCDay()] });
  return date === today ? translate("calendar.day.todayLabel", { name }) : name;
}

function CalendarEventButton({ event, category, onClick }: { event: CalendarEvent; category?: CalendarCategory; onClick: () => void }) {
  const color = category?.color ?? "oklch(0.645 0.009 106.643)";
  return <button className="calendar-event" onClick={onClick} style={{ "--event-color": color } as React.CSSProperties} title={`${event.title} · ${formatRange(event)}`} type="button"><time>{eventTime(event)}</time><span>{event.title}</span>{event.seriesId && <Icon name="routine" size={9} strokeWidth={1.8} />}</button>;
}

function AgendaEventButton({ event, category, onClick }: { event: CalendarEvent; category?: CalendarCategory; onClick: () => void }) {
  return <button className="calendar-agenda-event" onClick={onClick} type="button"><i style={{ backgroundColor: category?.color ?? "oklch(0.645 0.009 106.643)" }} /><time>{formatRange(event)}</time><strong title={event.title}>{event.title}{event.seriesId && <Icon name="routine" size={10} strokeWidth={1.8} />}</strong><span title={event.location}>{event.location}</span></button>;
}

function DateTimeFields({ draft, label, prefix, onChange }: { draft: Draft; label: string; prefix: "start" | "end"; onChange: <Key extends keyof Draft>(key: Key, value: Draft[Key]) => void }) {
  const dateKey = `${prefix}Date` as "startDate" | "endDate";
  const timeKey = `${prefix}Time` as "startTime" | "endTime";
  return <fieldset className="calendar-event-form__date-time"><legend>{label}</legend><div><DatePicker align={prefix === "end" ? "end" : "start"} label={translate("calendar.field.dateLabel", { label })} onChange={(value) => onChange(dateKey, value)} value={draft[dateKey]} /><TimePicker align={prefix === "end" ? "end" : "start"} label={translate("calendar.field.timeLabel", { label })} onChange={(value) => onChange(timeKey, value)} value={draft[timeKey]} /></div></fieldset>;
}

const recurrencePresetOptions: { value: RecurrencePreset; label: string }[] = [
  { value: "none", label: translate("calendar.recurrence.none") },
  { value: "daily", label: translate("routine.recurrence.daily") },
  { value: "weekly", label: translate("calendar.recurrence.weekly") },
  { value: "weekdays", label: translate("calendar.recurrence.weekdays") },
  { value: "biweekly", label: translate("calendar.recurrence.biweekly") },
  { value: "monthly", label: translate("calendar.recurrence.monthly") },
  { value: "yearly", label: translate("calendar.recurrence.yearly") },
  { value: "custom", label: translate("calendar.recurrence.custom") },
];
const recurrenceFreqOptions: { value: RecurrenceFreq; label: string }[] = [
  { value: "daily", label: translate("routine.weekday.sun") },
  { value: "weekly", label: translate("calendar.recurrence.unit.week") },
  { value: "monthly", label: translate("calendar.recurrence.unit.month") },
  { value: "yearly", label: translate("calendar.recurrence.unit.year") },
];

function clamp(raw: string, min: number, max: number, fallback: number): number {
  const parsed = Number(raw.replace(/[^\d]/g, ""));
  if (!Number.isFinite(parsed) || parsed < min) return raw === "" ? min : fallback;
  return Math.min(max, Math.max(min, parsed));
}

function RecurrenceField({ value, startDate, disabled, onChange }: {
  value: CalendarRecurrence | null;
  startDate: string;
  disabled: boolean;
  onChange: (recurrence: CalendarRecurrence | null) => void;
}) {
  const preset = recurrenceToPreset(value, startDate);
  const end: RecurrenceEnd = value?.until ? "until" : value?.count ? "count" : "never";
  const patch = (partial: Partial<CalendarRecurrence>) => { if (value) onChange({ ...value, ...partial }); };
  const toggleWeekday = (weekday: number) => {
    if (!value) return;
    const next = value.weekdays.includes(weekday)
      ? value.weekdays.filter((day) => day !== weekday)
      : [...value.weekdays, weekday].sort((a, b) => a - b);
    onChange({ ...value, weekdays: next.length ? next : [weekdayOf(startDate)] });
  };
  const setEnd = (next: RecurrenceEnd) => {
    if (!value) return;
    if (next === "never") onChange({ ...value, until: null, count: null });
    else if (next === "until") onChange({ ...value, until: value.until ?? addDays(startDate, 90), count: null });
    else onChange({ ...value, until: null, count: value.count ?? 10 });
  };

  return (
    <fieldset className="calendar-event-form__recurrence">
      <legend>{translate("calendar.recurrence.title")}</legend>
      <Select
        align="end"
        disabled={disabled}
        label={translate("calendar.recurrence.title")}
        onChange={(next) => onChange(presetToRecurrence(next as RecurrencePreset, startDate, value))}
        options={recurrencePresetOptions}
        value={preset}
      />
      {value && (
        <div className="calendar-recurrence">
          {preset === "custom" && (
            <>
              <label className="calendar-recurrence__interval">
                <span>{translate("calendar.recurrence.interval")}</span>
                <div>
                  <Input aria-label={translate("calendar.recurrence.intervalLabel")} disabled={disabled} inputMode="numeric" onChange={(event) => patch({ interval: clamp(event.target.value, 1, 999, value.interval) })} value={String(value.interval)} />
                  <Select
                    align="end"
                    disabled={disabled}
                    label={translate("calendar.recurrence.frequencyLabel")}
                    onChange={(next) => patch({ freq: next as RecurrenceFreq, weekdays: next === "weekly" ? (value.weekdays.length ? value.weekdays : [weekdayOf(startDate)]) : [] })}
                    options={recurrenceFreqOptions}
                    value={value.freq}
                  />
                </div>
              </label>
              {value.freq === "weekly" && (
                <div aria-label={translate("routine.field.days")} className="calendar-recurrence__weekdays" role="group">
                  {dayNames.map((name, index) => (
                    <button
                      aria-pressed={value.weekdays.includes(index)}
                      className="calendar-recurrence__weekday"
                      disabled={disabled}
                      key={name}
                      onClick={() => toggleWeekday(index)}
                      type="button"
                    >{name}</button>
                  ))}
                </div>
              )}
            </>
          )}
          <label className="calendar-recurrence__end">
            <span>{translate("calendar.recurrence.end")}</span>
            <div>
              <Select
                align="end"
                disabled={disabled}
                label={translate("calendar.recurrence.end")}
                onChange={(next) => setEnd(next as RecurrenceEnd)}
                options={[{ value: "never", label: translate("calendar.recurrence.none") }, { value: "until", label: translate("common.field.date") }, { value: "count", label: translate("calendar.recurrence.count") }]}
                value={end}
              />
              {end === "until" && <DatePicker align="end" disabled={disabled} label={translate("calendar.recurrence.endDate")} min={startDate} onChange={(next) => patch({ until: next })} value={value.until ?? ""} />}
              {end === "count" && <Input aria-label={translate("calendar.recurrence.countLabel")} disabled={disabled} inputMode="numeric" onChange={(event) => patch({ count: clamp(event.target.value, 1, 999, value.count ?? 10) })} value={String(value.count ?? "")} />}
            </div>
          </label>
          <p className="calendar-recurrence__summary"><Icon name="routine" size={11} strokeWidth={1.8} />{recurrenceSummary(value, startDate)}</p>
        </div>
      )}
    </fieldset>
  );
}

function CalendarEmpty({ onCreate }: { onCreate: () => void }) {
  return <div className="calendar-empty"><Icon name="calendar" size={28} /><strong>{translate("calendar.empty.title")}</strong><span>{translate("calendar.empty.description")}</span><Button onClick={onCreate} variant="primary">{translate("app.action.newCalendar")}</Button></div>;
}

function CalendarLoading() {
  return <div aria-label={translate("calendar.loading")} className="calendar-page calendar-page--loading"><div className="calendar-toolbar" /><div className="calendar-month"><div className="calendar-grid calendar-grid--skeleton" /></div></div>;
}
