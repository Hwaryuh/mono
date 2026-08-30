import type { CalendarCategory, InboxField, InboxItem, InboxUpdateInput, LedgerCategory, TodoLabel } from "@mono/contracts";
import { formatTimestamp, inboxTargetModuleIds, type InboxTargetModuleId } from "@mono/domain";
import {
  Badge,
  Button,
  Card,
  ConfidenceIndicator,
  DatePicker,
  Icon,
  Input,
  Modal,
  Select,
  StatusIndicator,
  TextArea,
  TimePicker,
  type IconName,
  type SelectOption,
} from "@mono/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useMedia } from "../../infrastructure/media/media-store-context";
import type { CalendarRepository } from "../calendar/calendar-repository";
import { LedgerAmountInput } from "../ledger/LedgerAmountInput";
import type { LedgerRepository } from "../ledger/ledger-repository";
import type { ScrapRepository } from "../scrap/scrap-repository";
import type { TodoRepository } from "../todo/todo-repository";
import type { InboxRepository } from "./inbox-repository";

const inboxQueryKey = ["inbox"] as const;
const dashboardQueryKey = ["dashboard"] as const;
const todoQueryKey = ["todo"] as const;
const ledgerQueryKey = ["ledger"] as const;
const scrapQueryKey = ["scrap"] as const;
const calendarQueryKey = ["calendar"] as const;
const moduleMeta: Record<InboxTargetModuleId, { name: string; color: string; icon: IconName }> = {
  todo: { name: "할 일", color: "oklch(0.539 0.082 160.129)", icon: "todo" },
  calendar: { name: "일정", color: "oklch(0.604 0.149 260.322)", icon: "calendar" },
  scrap: { name: "스크랩", color: "oklch(0.502 0.132 309.199)", icon: "scrap" },
  ledger: { name: "가계부", color: "oklch(0.603 0.109 75.876)", icon: "wallet" },
};

const sourceMeta: Record<InboxItem["source"], { name: string; icon: IconName }> = {
  text: { name: "텍스트 입력", icon: "note" },
  url: { name: "링크 입력", icon: "scrap" },
  image: { name: "파일 입력", icon: "image" },
  video: { name: "영상 입력", icon: "video" },
};

const fieldLabels: Record<InboxTargetModuleId, string[]> = {
  todo: ["제목", "라벨", "마감", "메모"],
  calendar: ["제목", "일시", "장소", "라벨"],
  scrap: ["제목", "메모", "원문", "라벨"],
  ledger: ["항목", "금액", "날짜", "라벨"],
};

type InboxLabelCatalog = Record<InboxTargetModuleId, {
  inputLabel: string;
  emptyMessage: string;
  options: SelectOption[];
}>;

function labelCatalogOf(
  calendarCategories: CalendarCategory[],
  ledgerCategories: LedgerCategory[],
  scrapLabels: string[],
  todoLabels: TodoLabel[],
): InboxLabelCatalog {
  return {
    todo: {
      inputLabel: "할 일 라벨",
      emptyMessage: "할 일 라벨 목록을 불러오지 못했습니다.",
      options: todoLabels.map((label) => ({ value: label.name, label: label.name, dotColor: label.color })),
    },
    calendar: {
      inputLabel: "일정 라벨",
      emptyMessage: "일정 라벨 목록을 불러오지 못했습니다.",
      options: calendarCategories.map((category) => ({ value: category.name, label: category.name, dotColor: category.color })),
    },
    scrap: {
      inputLabel: "스크랩 라벨",
      emptyMessage: "스크랩 라벨 목록을 불러오지 못했습니다.",
      options: scrapLabels.map((label) => ({ value: label, label })),
    },
    ledger: {
      inputLabel: "가계부 라벨",
      emptyMessage: "가계부 라벨 목록을 불러오지 못했습니다.",
      options: ledgerCategories.map((category) => ({ value: category.name, label: category.name, dotColor: category.color })),
    },
  };
}

function unifiedFieldLabel(label: string) {
  return label === "분류" || label === "태그" ? "라벨" : label;
}

type Tab = "pending" | "approved" | "failed";
const tabOrder: Tab[] = ["pending", "approved", "failed"];

function defaultFields(target: InboxTargetModuleId, raw: string): InboxField[] {
  return fieldLabels[target].map((label, index) => ({
    label,
    value: index === 0 ? raw : label === "메모" || label === "원문" ? raw : label === "마감" ? "기한 없음" : "미지정",
  }));
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "작업을 완료하지 못했습니다.";
}

type ModuleTargetPickerProps = {
  value: InboxTargetModuleId;
  onChange: (value: InboxTargetModuleId) => void;
};

function ModuleTargetPicker({ value, onChange }: ModuleTargetPickerProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const rootRef = useRef<HTMLFieldSetElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef(new Map<InboxTargetModuleId, HTMLButtonElement>());
  const selectedMeta = moduleMeta[value];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function focusOption(moduleId: InboxTargetModuleId) {
    requestAnimationFrame(() => optionRefs.current.get(moduleId)?.focus());
  }

  function openList() {
    setOpen(true);
    focusOption(value);
  }

  function selectTarget(moduleId: InboxTargetModuleId) {
    onChange(moduleId);
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function onOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>, moduleId: InboxTargetModuleId) {
    const currentIndex = inboxTargetModuleIds.indexOf(moduleId);
    let nextIndex: number | undefined;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") nextIndex = (currentIndex + 1) % inboxTargetModuleIds.length;
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + inboxTargetModuleIds.length) % inboxTargetModuleIds.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = inboxTargetModuleIds.length - 1;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
      return;
    }
    if (nextIndex === undefined) return;
    event.preventDefault();
    focusOption(inboxTargetModuleIds[nextIndex]);
  }

  return (
    <fieldset className="inbox-editor__targets" ref={rootRef}>
      <legend>저장할 모듈</legend>
      <button
        aria-controls={listId}
        aria-expanded={open}
        aria-label={`저장할 모듈: ${selectedMeta.name}`}
        className="inbox-editor__target-trigger"
        onClick={() => open ? setOpen(false) : openList()}
        ref={triggerRef}
        type="button"
      >
        <Icon name={selectedMeta.icon} size={15} style={{ color: selectedMeta.color }} />
        <span>{selectedMeta.name}</span>
        <small>변경</small>
        <Icon className="inbox-editor__target-chevron" name="chevronDown" size={12} />
      </button>
      {open && (
        <div aria-label="저장할 모듈 목록" className="inbox-editor__target-list" id={listId} role="radiogroup">
          {inboxTargetModuleIds.map((moduleId) => {
            const meta = moduleMeta[moduleId];
            const selected = value === moduleId;
            return (
              <button
                aria-checked={selected}
                className={selected ? "inbox-editor__target-option inbox-editor__target-option--selected" : "inbox-editor__target-option"}
                key={moduleId}
                onClick={() => selectTarget(moduleId)}
                onKeyDown={(event) => onOptionKeyDown(event, moduleId)}
                ref={(element) => {
                  if (element) optionRefs.current.set(moduleId, element);
                  else optionRefs.current.delete(moduleId);
                }}
                role="radio"
                tabIndex={selected ? 0 : -1}
                type="button"
              >
                <Icon name={meta.icon} size={14} style={{ color: meta.color }} />
                <span>{meta.name}</span>
                {selected && <Icon className="inbox-editor__target-check" name="check" size={13} />}
              </button>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

type ScheduleDraft = {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
};

function scheduleDraftOf(value: string, fallbackDate: string): ScheduleDraft {
  const dates = value.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  const times = value.match(/\d{1,2}:\d{2}/g) ?? [];
  const startDate = dates[0] ?? fallbackDate;
  return {
    startDate,
    startTime: times[0] ?? "",
    endDate: dates[1] ?? startDate,
    endTime: times[1] ?? times[0] ?? "",
  };
}

function scheduleValueOf(draft: ScheduleDraft) {
  if (!draft.startDate) return "";
  const endDate = draft.endDate || draft.startDate;
  if (endDate !== draft.startDate) {
    const start = draft.startTime ? `${draft.startDate} ${draft.startTime}` : draft.startDate;
    const end = draft.endTime ? `${endDate} ${draft.endTime}` : endDate;
    return `${start}–${end}`;
  }
  if (draft.startTime || draft.endTime) {
    return `${draft.startDate} ${draft.startTime || draft.endTime}–${draft.endTime || draft.startTime}`;
  }
  return draft.startDate;
}

function InboxScheduleField({ field, fallbackDate, onChange }: { field: InboxField; fallbackDate: string; onChange: (value: string) => void }) {
  const draft = scheduleDraftOf(field.value, fallbackDate);
  const update = (input: Partial<ScheduleDraft>) => onChange(scheduleValueOf({ ...draft, ...input }));

  return (
    <fieldset className="inbox-editor__schedule">
      <legend>
        일시
        {field.confidence !== undefined && <small className={field.confidence < 0.7 ? "inbox-field--low" : ""}>AI 확신도 {Math.round(field.confidence * 100)}%</small>}
      </legend>
      <div className="inbox-editor__schedule-grid">
        <label>
          <span>시작 날짜</span>
          <DatePicker
            label="시작 날짜"
            onChange={(startDate) => update({ startDate, endDate: draft.endDate && draft.endDate >= startDate ? draft.endDate : startDate })}
            value={draft.startDate}
          />
        </label>
        <label>
          <span>종료 날짜</span>
          <DatePicker align="end" label="종료 날짜" min={draft.startDate} onChange={(endDate) => update({ endDate })} value={draft.endDate} />
        </label>
        <label>
          <span>시작 시간</span>
          <TimePicker label="시작 시간" onChange={(startTime) => update({ startTime })} value={draft.startTime} />
        </label>
        <label>
          <span>종료 시간</span>
          <TimePicker align="end" label="종료 시간" onChange={(endTime) => update({ endTime })} value={draft.endTime} />
        </label>
      </div>
    </fieldset>
  );
}

function InboxLabelField({ field, source, onChange }: { field: InboxField; source: InboxLabelCatalog[InboxTargetModuleId]; onChange: (value: string) => void }) {
  return (
    <label>
      <span>라벨{field.confidence !== undefined && <small className={field.confidence < 0.7 ? "inbox-field--low" : ""}>AI 확신도 {Math.round(field.confidence * 100)}%</small>}</span>
      <Select
        disabled={source.options.length === 0}
        label={source.inputLabel}
        onChange={onChange}
        options={source.options}
        value={field.value}
      />
      {source.options.length === 0 && <small className="inbox-editor__field-hint">{source.emptyMessage}</small>}
    </label>
  );
}

function InboxLedgerAmountDateFields({
  amountField,
  dateField,
  onAmountChange,
  onDateChange,
}: {
  amountField: InboxField;
  dateField: InboxField;
  onAmountChange: (value: string) => void;
  onDateChange: (value: string) => void;
}) {
  return (
    <div className="ledger-expense-form__pair">
      <label>
        <span>금액{amountField.confidence !== undefined && <small className={amountField.confidence < 0.7 ? "inbox-field--low" : ""}>AI 확신도 {Math.round(amountField.confidence * 100)}%</small>}</span>
        <LedgerAmountInput onChange={(value) => onAmountChange(value ? `₩ ${value}` : "")} value={amountField.value} />
      </label>
      <label>
        <span>날짜{dateField.confidence !== undefined && <small className={dateField.confidence < 0.7 ? "inbox-field--low" : ""}>AI 확신도 {Math.round(dateField.confidence * 100)}%</small>}</span>
        <DatePicker align="end" label="날짜" onChange={onDateChange} value={dateField.value} />
      </label>
    </div>
  );
}

function InboxTodoDueField({ field, onChange }: { field: InboxField; onChange: (value: string) => void }) {
  const dueDate = field.value.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
  return (
    <label>
      <span>마감{field.confidence !== undefined && <small className={field.confidence < 0.7 ? "inbox-field--low" : ""}>AI 확신도 {Math.round(field.confidence * 100)}%</small>}</span>
      <DatePicker label="마감일" onChange={(value) => onChange(value || "기한 없음")} value={dueDate} />
    </label>
  );
}

interface InboxPageProps {
  repository: InboxRepository;
  calendarRepository: CalendarRepository;
  ledgerRepository: LedgerRepository;
  scrapRepository: ScrapRepository;
  todoRepository: TodoRepository;
}

export function InboxPage({ repository, calendarRepository, ledgerRepository, scrapRepository, todoRepository }: InboxPageProps) {
  const [tab, setTab] = useState<Tab>("pending");
  const queryClient = useQueryClient();
  const snapshotQuery = useQuery({ queryKey: inboxQueryKey, queryFn: () => repository.getSnapshot() });
  const calendarQuery = useQuery({ queryKey: calendarQueryKey, queryFn: () => calendarRepository.getSnapshot() });
  const ledgerQuery = useQuery({ queryKey: ledgerQueryKey, queryFn: () => ledgerRepository.getSnapshot() });
  const scrapQuery = useQuery({ queryKey: scrapQueryKey, queryFn: () => scrapRepository.getSnapshot() });
  const todoQuery = useQuery({ queryKey: todoQueryKey, queryFn: () => todoRepository.getSnapshot() });
  const approveAllMutation = useMutation({
    mutationFn: () => repository.approveHighConfidence(0.9),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: inboxQueryKey }),
        queryClient.invalidateQueries({ queryKey: dashboardQueryKey }),
        queryClient.invalidateQueries({ queryKey: todoQueryKey }),
        queryClient.invalidateQueries({ queryKey: calendarQueryKey }),
        queryClient.invalidateQueries({ queryKey: scrapQueryKey }),
        queryClient.invalidateQueries({ queryKey: ledgerQueryKey }),
      ]);
    },
  });

  if (snapshotQuery.isPending) return <InboxLoading />;
  if (snapshotQuery.isError) {
    return <div className="inbox-state" role="alert"><StatusIndicator icon="alert" label="수집함을 불러오지 못했습니다" tone="danger" /></div>;
  }

  const items = snapshotQuery.data.items;
  const visible = items.filter((item) => tab === "pending" ? item.status === "pending" || item.status === "processing" : item.status === tab);
  const highConfidenceCount = items.filter((item) => item.status === "pending" && item.confidence >= 0.9).length;
  const labelCatalog = labelCatalogOf(
    calendarQuery.data?.categories ?? [],
    ledgerQuery.data?.categories ?? [],
    scrapQuery.data?.tags ?? [],
    todoQuery.data?.labels ?? [],
  );
  const tabs: Array<{ id: Tab; label: string; count: number }> = [
    { id: "pending", label: "대기", count: items.filter((item) => item.status === "pending" || item.status === "processing").length },
    { id: "approved", label: "승인됨", count: items.filter((item) => item.status === "approved").length },
    { id: "failed", label: "분류 실패", count: items.filter((item) => item.status === "failed").length },
  ];

  function selectTab(nextTab: Tab) {
    setTab(nextTab);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-inbox-tab="${nextTab}"]`)?.focus());
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: Tab) {
    const index = tabOrder.indexOf(current);
    let next: Tab | undefined;
    if (event.key === "ArrowRight") next = tabOrder[(index + 1) % tabOrder.length];
    if (event.key === "ArrowLeft") next = tabOrder[(index - 1 + tabOrder.length) % tabOrder.length];
    if (event.key === "Home") next = tabOrder[0];
    if (event.key === "End") next = tabOrder[tabOrder.length - 1];
    if (!next) return;
    event.preventDefault();
    selectTab(next);
  }

  function focusCurrentTab() {
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-inbox-tab="${tab}"]`)?.focus());
  }

  return (
    <div className="inbox-page">
      <div aria-label="수집함 상태" className="inbox-tabs" role="tablist">
        {tabs.map((item) => (
          <button
            aria-controls={`inbox-panel-${item.id}`}
            aria-selected={tab === item.id}
            className={tab === item.id ? "inbox-tab inbox-tab--active" : "inbox-tab"}
            data-inbox-tab={item.id}
            id={`inbox-tab-${item.id}`}
            key={item.id}
            onClick={() => selectTab(item.id)}
            onKeyDown={(event) => onTabKeyDown(event, item.id)}
            role="tab"
            tabIndex={tab === item.id ? 0 : -1}
            type="button"
          >
            {item.label}<span>{item.count}</span>
          </button>
        ))}
        <Button disabled={highConfidenceCount === 0} loading={approveAllMutation.isPending} onClick={() => approveAllMutation.mutate()} size="small">
          확신도 90% 이상 {highConfidenceCount}건 일괄 승인
        </Button>
      </div>

      {approveAllMutation.isError && <div className="inbox-bulk-error" role="alert">{errorMessage(approveAllMutation.error)}</div>}
      <div aria-labelledby={`inbox-tab-${tab}`} className="inbox-list" id={`inbox-panel-${tab}`} role="tabpanel">
        {visible.map((item) => (
          <InboxRow
            calendarToday={calendarQuery.data?.today ?? ""}
            item={item}
            key={item.id}
            labelCatalog={labelCatalog}
            onDiscarded={focusCurrentTab}
            repository={repository}
          />
        ))}
        {visible.length === 0 && (
          <div className="inbox-empty"><Icon name="inbox" size={28} /><strong>여기에 남은 항목이 없습니다</strong><span>빠른 캡처로 무엇이든 던져 넣으세요.</span></div>
        )}
      </div>
    </div>
  );
}

function InboxRow({
  item,
  repository,
  onDiscarded,
  calendarToday,
  labelCatalog,
}: {
  item: InboxItem;
  repository: InboxRepository;
  onDiscarded: () => void;
  calendarToday: string;
  labelCatalog: InboxLabelCatalog;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [target, setTarget] = useState<InboxTargetModuleId>(item.target ?? "todo");
  const [fields, setFields] = useState<InboxField[]>(item.target ? item.fields : defaultFields("todo", item.raw));
  const [actionError, setActionError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const source = sourceMeta[item.source];
  const targetMeta = item.target ? moduleMeta[item.target] : null;
  const videoRoutingLocked = item.source === "video";
  const ledgerAmountFieldIndex = target === "ledger" ? fields.findIndex((field) => field.label === "금액") : -1;
  const ledgerDateFieldIndex = target === "ledger" ? fields.findIndex((field) => field.label === "날짜") : -1;

  async function invalidateSnapshots() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: inboxQueryKey }),
      queryClient.invalidateQueries({ queryKey: dashboardQueryKey }),
      queryClient.invalidateQueries({ queryKey: todoQueryKey }),
      queryClient.invalidateQueries({ queryKey: calendarQueryKey }),
      queryClient.invalidateQueries({ queryKey: ["scrap"] }),
      queryClient.invalidateQueries({ queryKey: ledgerQueryKey }),
    ]);
  }

  const approveMutation = useMutation({
    mutationFn: () => repository.approve(item.id),
    onMutate: () => setActionError(null),
    onSuccess: invalidateSnapshots,
    onError: (error) => setActionError(errorMessage(error)),
  });
  const updateMutation = useMutation({
    mutationFn: (input: InboxUpdateInput) => repository.update(item.id, input),
    onMutate: () => setActionError(null),
    onSuccess: async () => {
      await invalidateSnapshots();
      setEditorOpen(false);
    },
    onError: (error) => setActionError(errorMessage(error)),
  });
  const discardMutation = useMutation({
    mutationFn: () => repository.discard(item.id),
    onMutate: () => setActionError(null),
    onSuccess: async () => {
      setDiscardOpen(false);
      await invalidateSnapshots();
      onDiscarded();
    },
    onError: (error) => setActionError(errorMessage(error)),
  });
  const busy = approveMutation.isPending || updateMutation.isPending || discardMutation.isPending;

  function openEditor() {
    const initialTarget = item.target ?? "todo";
    setTarget(initialTarget);
    setFields(item.target ? item.fields.map((field) => ({ ...field, label: unifiedFieldLabel(field.label) })) : defaultFields(initialTarget, item.raw));
    setActionError(null);
    setEditorOpen(true);
  }

  function changeTarget(nextTarget: InboxTargetModuleId) {
    if (nextTarget === target) return;
    setTarget(nextTarget);
    setFields(defaultFields(nextTarget, item.raw).map((field) => {
      if (nextTarget === "calendar") {
        if (field.label === "일시") return { ...field, value: calendarToday };
      }
      if (field.label === "라벨") return { ...field, value: labelCatalog[nextTarget].options[0]?.value ?? "" };
      return field;
    }));
  }

  function updateField(index: number, value: string) {
    setFields((current) => current.map((field, fieldIndex) => fieldIndex === index ? { ...field, value } : field));
  }

  function submitUpdate(event: FormEvent) {
    event.preventDefault();
    const normalizedFields = fields.map((field) => ({ ...field, value: field.value.trim() }));
    const label = normalizedFields.find((field) => field.label === "라벨")?.value;
    if (label !== undefined && !labelCatalog[target].options.some((option) => option.value === label)) {
      setActionError(`${moduleMeta[target].name} 라벨을 선택해야 합니다.`);
      return;
    }
    if (normalizedFields.some((field) => !field.value)) {
      setActionError("모든 필드에 값을 입력해야 합니다.");
      return;
    }
    if (target === "calendar") {
      const schedule = normalizedFields.find((field) => field.label === "일시")?.value ?? "";
      if (!/\d{4}-\d{2}-\d{2}/.test(schedule)) {
        setActionError("일정 날짜를 선택해야 합니다.");
        return;
      }
    }
    updateMutation.mutate({ target, fields: normalizedFields });
  }

  return (
    <Card aria-busy={busy} className="inbox-item">
      <div className="inbox-item__source">
        <div><Icon name={source.icon} size={13} /><span>{source.name}</span><time>{formatTimestamp(item.receivedAt)}</time></div>
        <p>{item.raw}</p>
        {item.source === "image" && (item.images?.length
          ? <div className="inbox-item__thumbnails">{item.images.map((image, index) => <InboxMediaThumbnail key={`${image.mediaId}-${index}`} mediaId={image.mediaId} name={image.name} />)}</div>
          : <div className="inbox-item__thumbnail"><Icon name="image" size={18} /></div>)}
        {item.source === "video" && <div aria-label="영상" className="inbox-item__thumbnail" role="img"><Icon name="video" size={18} /></div>}
      </div>

      <div className="inbox-item__result">
        {item.status === "failed" ? (
          <div className="inbox-item__failure"><StatusIndicator icon="alert" label="분류하지 못했습니다" tone="warning" /><span>대상을 직접 고르면 그대로 저장됩니다.</span></div>
        ) : item.status === "approved" ? (
          <div className="inbox-item__approved"><StatusIndicator icon="check" label={`${targetMeta?.name ?? "대상"}에 저장했습니다`} tone="success" /><span>확신도 {Math.round(item.confidence * 100)}%</span></div>
        ) : item.status === "processing" ? (
          <div className="inbox-item__processing"><StatusIndicator icon="sync" label="모듈 분류 중…" tone="accent" /></div>
        ) : (
          <>
            <div className="inbox-item__classification">
              <ConfidenceIndicator value={item.confidence} />
              <div><span className="inbox-item__confidence-label">{videoRoutingLocked ? "영상 규칙 분류 · AI 분석 생략" : item.pinned ? "지정된 모듈" : "AI 분류 결과"}</span>
                <div className="inbox-item__target">
                  {targetMeta && (
                    <Button aria-label={videoRoutingLocked ? "스크랩 필드 수정" : `분류 대상 변경: ${targetMeta.name}`} disabled={busy} onClick={openEditor} size="small" style={{ backgroundColor: `color-mix(in srgb, ${targetMeta.color} 13%, var(--color-surface))` }}>
                      <Icon name={targetMeta.icon} size={13} style={{ color: targetMeta.color }} />{targetMeta.name}{!videoRoutingLocked && <Icon name="chevronDown" size={11} />}
                    </Button>
                  )}
                  {item.confidence < 0.75 && <Badge tone="warning">검토 권장</Badge>}
                  {videoRoutingLocked && <Badge>영상 · 스크랩 고정</Badge>}
                </div>
              </div>
            </div>
            <div className="inbox-fields">
              {item.fields.map((field, index) => {
                const fieldLabel = unifiedFieldLabel(field.label);
                return (
                <button aria-label={`${fieldLabel} 필드 수정`} disabled={busy} key={`${field.label}-${index}`} onClick={openEditor} type="button">
                  <span>{fieldLabel}</span><strong>{field.value}</strong>{field.confidence !== undefined && <small className={field.confidence < 0.6 ? "inbox-field--low" : ""}>{Math.round(field.confidence * 100)}%</small>}
                  <Icon name="edit" size={12} />
                </button>
                );
              })}
            </div>
          </>
        )}
        {actionError && !editorOpen && !discardOpen && <div className="inbox-item__mutation-error" role="alert"><Icon name="alert" size={13} />{actionError}</div>}
      </div>

      {(item.status === "pending" || item.status === "failed") && (
        <div className="inbox-item__actions">
          {item.status === "pending" && <Button loading={approveMutation.isPending} onClick={() => approveMutation.mutate()} variant="primary">승인하고 저장</Button>}
          <Button disabled={busy} onClick={openEditor}>{item.status === "failed" ? "직접 분류" : "필드 수정"}</Button>
          <Button disabled={busy} onClick={() => { setActionError(null); setDiscardOpen(true); }} variant="ghost">버리기</Button>
        </div>
      )}

      <Modal
        className="inbox-editor"
        footer={<><Button disabled={updateMutation.isPending} onClick={() => setEditorOpen(false)}>취소</Button><Button form={`inbox-editor-${item.id}`} loading={updateMutation.isPending} type="submit" variant="primary">저장</Button></>}
        icon={moduleMeta[target].icon}
        onClose={() => { if (!updateMutation.isPending) setEditorOpen(false); }}
        open={editorOpen}
        title={item.status === "failed" ? "직접 분류" : "필드 수정"}
      >
        <form id={`inbox-editor-${item.id}`} onSubmit={submitUpdate}>
          <div className="inbox-editor__source"><span>{source.name} 원문</span><p>{item.raw}</p></div>
          {videoRoutingLocked
            ? <div className="inbox-editor__fixed-target"><span>저장 모듈</span><strong><Icon name="scrap" size={13} />스크랩</strong><small>영상은 AI 분석 없이 스크랩으로 고정됩니다.</small></div>
            : <ModuleTargetPicker onChange={changeTarget} value={target} />}
          <div className="inbox-editor__fields">
            {fields.map((field, index) => {
              if (target === "calendar" && field.label === "일시") {
                return <InboxScheduleField fallbackDate={calendarToday} field={field} key={`${field.label}-${index}`} onChange={(value) => updateField(index, value)} />;
              }
              if (field.label === "라벨") {
                return <InboxLabelField field={field} key={`${field.label}-${index}`} onChange={(value) => updateField(index, value)} source={labelCatalog[target]} />;
              }
              if (target === "todo" && field.label === "마감") {
                return <InboxTodoDueField field={field} key={`${field.label}-${index}`} onChange={(value) => updateField(index, value)} />;
              }
              if (index === ledgerAmountFieldIndex && ledgerDateFieldIndex >= 0) {
                return (
                  <InboxLedgerAmountDateFields
                    amountField={field}
                    dateField={fields[ledgerDateFieldIndex]}
                    key="ledger-amount-date"
                    onAmountChange={(value) => updateField(index, value)}
                    onDateChange={(value) => updateField(ledgerDateFieldIndex, value)}
                  />
                );
              }
              if (index === ledgerDateFieldIndex && ledgerAmountFieldIndex >= 0) return null;
              const multiline = field.label === "메모" || field.label === "원문" || field.label === "원인";
              return (
                <label key={`${field.label}-${index}`}>
                  <span>{field.label}{field.confidence !== undefined && <small className={field.confidence < 0.7 ? "inbox-field--low" : ""}>AI 확신도 {Math.round(field.confidence * 100)}%</small>}</span>
                  {multiline
                    ? <TextArea autoFocus={index === 0} onChange={(event) => updateField(index, event.target.value)} rows={3} value={field.value} />
                    : <Input autoFocus={index === 0} onChange={(event) => updateField(index, event.target.value)} value={field.value} />}
                </label>
              );
            })}
          </div>
          {actionError && <div className="inbox-editor__error" role="alert"><Icon name="alert" size={13} />{actionError}</div>}
        </form>
      </Modal>

      <Modal
        className="inbox-discard-modal"
        footer={<><Button autoFocus disabled={discardMutation.isPending} onClick={() => setDiscardOpen(false)}>취소</Button><Button loading={discardMutation.isPending} onClick={() => discardMutation.mutate()} variant="danger">버리기</Button></>}
        icon="alert"
        onClose={() => { if (!discardMutation.isPending) setDiscardOpen(false); }}
        open={discardOpen}
        title="이 항목을 버릴까요?"
      >
        <p>수집함에서 제거합니다. 이 작업은 되돌릴 수 없습니다.</p>
        <blockquote>{item.raw}</blockquote>
        {actionError && <div className="inbox-editor__error" role="alert"><Icon name="alert" size={13} />{actionError}</div>}
      </Modal>
    </Card>
  );
}

function InboxMediaThumbnail({ mediaId, name }: { mediaId: string; name: string }) {
  const { data } = useMedia(mediaId);
  if (!data) return <div className="inbox-item__thumbnail"><Icon name="image" size={18} /></div>;
  return <img alt={name} src={data} />;
}

function InboxLoading() {
  return <div className="inbox-list inbox-list--loading" aria-label="수집함 불러오는 중">{Array.from({ length: 4 }, (_, index) => <Card className="inbox-item inbox-item--skeleton" key={index} />)}</div>;
}
