import { translate } from "../../i18n/i18n";
import { errorMessage } from "../../i18n/error-message";
import type { CalendarCategory, InboxField, InboxItem, InboxSnapshot, InboxUpdateInput, LedgerCategory, TodoLabel } from "@mono/contracts";
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
import { isConflictError } from "../../infrastructure/http/http-client";
import { resyncConflictVersion } from "../../infrastructure/http/conflict-recovery";
import { useMedia } from "../../infrastructure/media/media-store-context";
import type { CalendarRepository } from "../calendar/calendar-repository";
import { LedgerAmountInput } from "../ledger/LedgerAmountInput";
import type { LedgerRepository } from "../ledger/ledger-repository";
import type { ScrapRepository } from "../scrap/scrap-repository";
import type { TodoRepository } from "../todo/todo-repository";
import type { InboxRepository } from "./inbox-repository";
import { inboxTabOrder, inboxViewStateStoreOf, type InboxTab, type InboxViewStateStore } from "./inbox-view-state-store";

const inboxQueryKey = ["inbox"] as const;
const dashboardQueryKey = ["dashboard"] as const;
const todoQueryKey = ["todo"] as const;
const ledgerQueryKey = ["ledger"] as const;
const scrapQueryKey = ["scrap"] as const;
const calendarQueryKey = ["calendar"] as const;
const moduleMeta: Record<InboxTargetModuleId, { name: string; color: string; icon: IconName }> = {
  todo: { name: translate("app.navigation.todo"), color: "oklch(0.539 0.082 160.129)", icon: "todo" },
  calendar: { name: translate("app.navigation.calendar"), color: "oklch(0.604 0.149 260.322)", icon: "calendar" },
  scrap: { name: translate("app.navigation.scrap"), color: "oklch(0.502 0.132 309.199)", icon: "scrap" },
  ledger: { name: translate("app.navigation.ledger"), color: "oklch(0.603 0.109 75.876)", icon: "wallet" },
};

const sourceMeta: Record<InboxItem["source"], { name: string; icon: IconName }> = {
  text: { name: translate("inbox.source.text"), icon: "note" },
  url: { name: translate("inbox.source.link"), icon: "scrap" },
  image: { name: translate("inbox.source.file"), icon: "image" },
  video: { name: translate("inbox.source.video"), icon: "video" },
};

const fieldLabels: Record<InboxTargetModuleId, string[]> = {
  todo: [translate("common.field.title"), translate("common.field.label"), translate("inbox.field.due"), translate("common.field.note")],
  calendar: [translate("common.field.title"), translate("inbox.field.schedule"), translate("common.field.location"), translate("common.field.label")],
  scrap: [translate("common.field.title"), translate("common.field.note"), translate("inbox.field.original"), translate("common.field.label")],
  ledger: [translate("ledger.field.item"), translate("ledger.field.amount"), translate("common.field.date"), translate("common.field.label")],
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
      inputLabel: translate("inbox.labels.todo"),
      emptyMessage: translate("inbox.labels.todoLoadError"),
      options: todoLabels.map((label) => ({ value: label.name, label: label.name, dotColor: label.color })),
    },
    calendar: {
      inputLabel: translate("inbox.labels.calendar"),
      emptyMessage: translate("inbox.labels.calendarLoadError"),
      options: calendarCategories.map((category) => ({ value: category.name, label: category.name, dotColor: category.color })),
    },
    scrap: {
      inputLabel: translate("inbox.labels.scrap"),
      emptyMessage: translate("inbox.labels.scrapLoadError"),
      options: scrapLabels.map((label) => ({ value: label, label })),
    },
    ledger: {
      inputLabel: translate("inbox.labels.ledger"),
      emptyMessage: translate("inbox.labels.ledgerLoadError"),
      options: ledgerCategories.map((category) => ({ value: category.name, label: category.name, dotColor: category.color })),
    },
  };
}

function unifiedFieldLabel(label: string) {
  return label === translate("inbox.field.category") || label === translate("inbox.field.tag") ? translate("common.field.label") : label;
}

function defaultFields(target: InboxTargetModuleId, raw: string): InboxField[] {
  return fieldLabels[target].map((label, index) => ({
    label,
    value: index === 0 ? raw : label === translate("common.field.note") || label === translate("inbox.field.original") ? raw : label === translate("inbox.field.due") ? translate("common.date.noDueDate") : translate("routine.label.unassigned"),
  }));
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
      <legend>{translate("inbox.target.title")}</legend>
      <button
        aria-controls={listId}
        aria-expanded={open}
        aria-label={translate("inbox.target.currentLabel", { target: selectedMeta.name })}
        className="inbox-editor__target-trigger"
        onClick={() => open ? setOpen(false) : openList()}
        ref={triggerRef}
        type="button"
      >
        <Icon name={selectedMeta.icon} size={15} style={{ color: selectedMeta.color }} />
        <span>{selectedMeta.name}</span>
        <small>{translate("common.action.change")}</small>
        <Icon className="inbox-editor__target-chevron" name="chevronDown" size={12} />
      </button>
      {open && (
        <div aria-label={translate("inbox.target.optionsLabel")} className="inbox-editor__target-list" id={listId} role="radiogroup">
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
        {translate("inbox.field.schedule")}{field.confidence !== undefined && <small className={field.confidence < 0.7 ? "inbox-field--low" : ""}>{translate("inbox.confidence.aiLabel", { percent: Math.round(field.confidence * 100) })}</small>}
      </legend>
      <div className="inbox-editor__schedule-grid">
        <label>
          <span>{translate("inbox.schedule.startDate")}</span>
          <DatePicker
            label={translate("inbox.schedule.startDate")}
            onChange={(startDate) => update({ startDate, endDate: draft.endDate && draft.endDate >= startDate ? draft.endDate : startDate })}
            value={draft.startDate}
          />
        </label>
        <label>
          <span>{translate("inbox.schedule.endDate")}</span>
          <DatePicker align="end" label={translate("inbox.schedule.endDate")} min={draft.startDate} onChange={(endDate) => update({ endDate })} value={draft.endDate} />
        </label>
        <label>
          <span>{translate("inbox.schedule.startTime")}</span>
          <TimePicker label={translate("inbox.schedule.startTime")} onChange={(startTime) => update({ startTime })} value={draft.startTime} />
        </label>
        <label>
          <span>{translate("inbox.schedule.endTime")}</span>
          <TimePicker align="end" label={translate("inbox.schedule.endTime")} onChange={(endTime) => update({ endTime })} value={draft.endTime} />
        </label>
      </div>
    </fieldset>
  );
}

function InboxLabelField({ field, source, onChange }: { field: InboxField; source: InboxLabelCatalog[InboxTargetModuleId]; onChange: (value: string) => void }) {
  return (
    <label>
      <span>{translate("common.field.label")}{field.confidence !== undefined && <small className={field.confidence < 0.7 ? "inbox-field--low" : ""}>{translate("inbox.confidence.aiLabel", { percent: Math.round(field.confidence * 100) })}</small>}</span>
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
        <span>{translate("ledger.field.amount")}{amountField.confidence !== undefined && <small className={amountField.confidence < 0.7 ? "inbox-field--low" : ""}>{translate("inbox.confidence.aiLabel", { percent: Math.round(amountField.confidence * 100) })}</small>}</span>
        <LedgerAmountInput onChange={(value) => onAmountChange(value ? `₩ ${value}` : "")} value={amountField.value} />
      </label>
      <label>
        <span>{translate("common.field.date")}{dateField.confidence !== undefined && <small className={dateField.confidence < 0.7 ? "inbox-field--low" : ""}>{translate("inbox.confidence.aiLabel", { percent: Math.round(dateField.confidence * 100) })}</small>}</span>
        <DatePicker align="end" label={translate("common.field.date")} onChange={onDateChange} value={dateField.value} />
      </label>
    </div>
  );
}

function InboxTodoDueField({ field, onChange }: { field: InboxField; onChange: (value: string) => void }) {
  const dueDate = field.value.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "";
  return (
    <label>
      <span>{translate("inbox.field.due")}{field.confidence !== undefined && <small className={field.confidence < 0.7 ? "inbox-field--low" : ""}>{translate("inbox.confidence.aiLabel", { percent: Math.round(field.confidence * 100) })}</small>}</span>
      <DatePicker label={translate("todo.field.dueDate")} onChange={(value) => onChange(value || translate("common.date.noDueDate"))} value={dueDate} />
    </label>
  );
}

interface InboxPageProps {
  repository: InboxRepository;
  calendarRepository: CalendarRepository;
  ledgerRepository: LedgerRepository;
  scrapRepository: ScrapRepository;
  todoRepository: TodoRepository;
  viewStateStore?: InboxViewStateStore;
}

export function InboxPage({ repository, calendarRepository, ledgerRepository, scrapRepository, todoRepository, viewStateStore }: InboxPageProps) {
  const [store] = useState(() => viewStateStore ?? inboxViewStateStoreOf());
  const [viewState, setViewState] = useState(() => store.read());
  const { tab } = viewState;
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
    return <div className="inbox-state" role="alert"><StatusIndicator icon="alert" label={translate("inbox.error.load")} tone="danger" /></div>;
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
  const tabs: Array<{ id: InboxTab; label: string; count: number }> = [
    { id: "pending", label: translate("inbox.status.pending"), count: items.filter((item) => item.status === "pending" || item.status === "processing").length },
    { id: "approved", label: translate("inbox.status.approved"), count: items.filter((item) => item.status === "approved").length },
    { id: "failed", label: translate("inbox.status.failed"), count: items.filter((item) => item.status === "failed").length },
  ];

  function selectTab(nextTab: InboxTab) {
    const next = { tab: nextTab };
    store.write(next);
    setViewState(next);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-inbox-tab="${nextTab}"]`)?.focus());
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, current: InboxTab) {
    const index = inboxTabOrder.indexOf(current);
    let next: InboxTab | undefined;
    if (event.key === "ArrowRight") next = inboxTabOrder[(index + 1) % inboxTabOrder.length];
    if (event.key === "ArrowLeft") next = inboxTabOrder[(index - 1 + inboxTabOrder.length) % inboxTabOrder.length];
    if (event.key === "Home") next = inboxTabOrder[0];
    if (event.key === "End") next = inboxTabOrder[inboxTabOrder.length - 1];
    if (!next) return;
    event.preventDefault();
    selectTab(next);
  }

  function focusCurrentTab() {
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-inbox-tab="${tab}"]`)?.focus());
  }

  return (
    <div className="inbox-page">
      <div aria-label={translate("inbox.status.tabsLabel")} className="inbox-tabs" role="tablist">
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
          {translate("inbox.action.approveHighConfidence", { count: highConfidenceCount })}</Button>
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
          <div className="inbox-empty"><Icon name="inbox" size={28} /><strong>{translate("inbox.empty.title")}</strong></div>
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
  const [editorVersion, setEditorVersion] = useState(1);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [target, setTarget] = useState<InboxTargetModuleId>(item.target ?? "todo");
  const [fields, setFields] = useState<InboxField[]>(item.target ? item.fields : defaultFields("todo", item.raw));
  const [actionError, setActionError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const source = sourceMeta[item.source];
  const targetMeta = item.target ? moduleMeta[item.target] : null;
  const videoRoutingLocked = item.source === "video";
  const ledgerAmountFieldIndex = target === "ledger" ? fields.findIndex((field) => field.label === translate("ledger.field.amount")) : -1;
  const ledgerDateFieldIndex = target === "ledger" ? fields.findIndex((field) => field.label === translate("common.field.date")) : -1;

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
    mutationFn: (input: InboxUpdateInput) => repository.update(item.id, input, editorVersion),
    onMutate: () => setActionError(null),
    onSuccess: async () => {
      await invalidateSnapshots();
      setEditorOpen(false);
    },
    onError: async (error) => {
      setActionError(errorMessage(error));
      if (isConflictError(error)) {
        const version = await resyncConflictVersion<InboxSnapshot>(
          queryClient, inboxQueryKey, invalidateSnapshots,
          (snapshot) => snapshot.items.find((candidate) => candidate.id === item.id),
        );
        if (version !== null) setEditorVersion(version);
      }
    },
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
    setEditorVersion(item.version ?? 1);
    setEditorOpen(true);
  }

  function changeTarget(nextTarget: InboxTargetModuleId) {
    if (nextTarget === target) return;
    setTarget(nextTarget);
    setFields(defaultFields(nextTarget, item.raw).map((field) => {
      if (nextTarget === "calendar") {
        if (field.label === translate("inbox.field.schedule")) return { ...field, value: calendarToday };
      }
      if (field.label === translate("common.field.label")) return { ...field, value: labelCatalog[nextTarget].options[0]?.value ?? "" };
      return field;
    }));
  }

  function updateField(index: number, value: string) {
    setFields((current) => current.map((field, fieldIndex) => fieldIndex === index ? { ...field, value } : field));
  }

  function submitUpdate(event: FormEvent) {
    event.preventDefault();
    const normalizedFields = fields.map((field) => ({ ...field, value: field.value.trim() }));
    const label = normalizedFields.find((field) => field.label === translate("common.field.label"))?.value;
    if (label !== undefined && !labelCatalog[target].options.some((option) => option.value === label)) {
      setActionError(translate("inbox.validation.labelRequired", { target: moduleMeta[target].name }));
      return;
    }
    if (normalizedFields.some((field) => !field.value)) {
      setActionError(translate("inbox.validation.fieldsRequired"));
      return;
    }
    if (target === "calendar") {
      const schedule = normalizedFields.find((field) => field.label === translate("inbox.field.schedule"))?.value ?? "";
      if (!/\d{4}-\d{2}-\d{2}/.test(schedule)) {
        setActionError(translate("inbox.validation.calendarDateRequired"));
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
        {item.source === "video" && <div aria-label={translate("common.media.video")} className="inbox-item__thumbnail" role="img"><Icon name="video" size={18} /></div>}
      </div>

      <div className="inbox-item__result">
        {item.status === "failed" ? (
          <div className="inbox-item__failure"><StatusIndicator icon="alert" label={translate("inbox.classification.failed")} tone="warning" /><span>{translate("inbox.classification.manualHint")}</span></div>
        ) : item.status === "approved" ? (
          <div className="inbox-item__approved"><StatusIndicator icon="check" label={translate("inbox.status.savedTo", { target: targetMeta?.name ?? translate("common.target") })} tone="success" /><span>{translate("inbox.confidence.label", { percent: Math.round(item.confidence * 100) })}</span></div>
        ) : item.status === "processing" ? (
          <div className="inbox-item__processing"><StatusIndicator icon="sync" label={translate("inbox.classification.processing")} tone="accent" /></div>
        ) : (
          <>
            <div className="inbox-item__classification">
              <ConfidenceIndicator value={item.confidence} />
              <div><span className="inbox-item__confidence-label">{videoRoutingLocked ? translate("inbox.classification.videoRule") : item.pinned ? translate("inbox.classification.pinnedTarget") : translate("inbox.classification.aiResult")}</span>
                <div className="inbox-item__target">
                  {targetMeta && (
                    <Button aria-label={videoRoutingLocked ? translate("inbox.action.editScrapFields") : translate("inbox.action.changeTargetLabel", { target: targetMeta.name })} disabled={busy} onClick={openEditor} size="small" style={{ backgroundColor: `color-mix(in srgb, ${targetMeta.color} 13%, var(--color-surface))` }}>
                      <Icon name={targetMeta.icon} size={13} style={{ color: targetMeta.color }} />{targetMeta.name}{!videoRoutingLocked && <Icon name="chevronDown" size={11} />}
                    </Button>
                  )}
                  {item.confidence < 0.75 && <Badge tone="warning">{translate("inbox.classification.reviewRecommended")}</Badge>}
                  {videoRoutingLocked && <Badge>{translate("inbox.classification.videoLocked")}</Badge>}
                </div>
              </div>
            </div>
            <div className="inbox-fields">
              {item.fields.map((field, index) => {
                const fieldLabel = unifiedFieldLabel(field.label);
                return (
                <button aria-label={translate("inbox.action.editFieldLabel", { field: fieldLabel })} disabled={busy} key={`${field.label}-${index}`} onClick={openEditor} type="button">
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
          {item.status === "pending" && <Button loading={approveMutation.isPending} onClick={() => approveMutation.mutate()} variant="primary">{translate("inbox.action.approve")}</Button>}
          <Button disabled={busy} onClick={openEditor}>{item.status === "failed" ? translate("inbox.action.classifyManually") : translate("inbox.action.editFields")}</Button>
          <Button disabled={busy} onClick={() => { setActionError(null); setDiscardOpen(true); }} variant="ghost">{translate("inbox.action.discard")}</Button>
        </div>
      )}

      <Modal
        className="inbox-editor"
        footer={<><Button disabled={updateMutation.isPending} onClick={() => setEditorOpen(false)}>{translate("common.action.cancel")}</Button><Button form={`inbox-editor-${item.id}`} loading={updateMutation.isPending} type="submit" variant="primary">{translate("common.action.save")}</Button></>}
        icon={moduleMeta[target].icon}
        onClose={() => { if (!updateMutation.isPending) setEditorOpen(false); }}
        open={editorOpen}
        title={item.status === "failed" ? translate("inbox.action.classifyManually") : translate("inbox.action.editFields")}
      >
        <form id={`inbox-editor-${item.id}`} onSubmit={submitUpdate}>
          <div className="inbox-editor__source"><span>{translate("inbox.source.originalLabel", { source: source.name })}</span><p>{item.raw}</p></div>
          {videoRoutingLocked
            ? <div className="inbox-editor__fixed-target"><span>{translate("inbox.target.savedModule")}</span><strong><Icon name="scrap" size={13} />{translate("app.navigation.scrap")}</strong><small>{translate("inbox.classification.videoLockedDescription")}</small></div>
            : <ModuleTargetPicker onChange={changeTarget} value={target} />}
          <div className="inbox-editor__fields">
            {fields.map((field, index) => {
              if (target === "calendar" && field.label === translate("inbox.field.schedule")) {
                return <InboxScheduleField fallbackDate={calendarToday} field={field} key={`${field.label}-${index}`} onChange={(value) => updateField(index, value)} />;
              }
              if (field.label === translate("common.field.label")) {
                return <InboxLabelField field={field} key={`${field.label}-${index}`} onChange={(value) => updateField(index, value)} source={labelCatalog[target]} />;
              }
              if (target === "todo" && field.label === translate("inbox.field.due")) {
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
              const multiline = field.label === translate("common.field.note") || field.label === translate("inbox.field.original") || field.label === translate("common.field.reason");
              return (
                <label key={`${field.label}-${index}`}>
                  <span>{field.label}{field.confidence !== undefined && <small className={field.confidence < 0.7 ? "inbox-field--low" : ""}>{translate("inbox.confidence.aiLabel", { percent: Math.round(field.confidence * 100) })}</small>}</span>
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
        footer={<><Button autoFocus disabled={discardMutation.isPending} onClick={() => setDiscardOpen(false)}>{translate("common.action.cancel")}</Button><Button loading={discardMutation.isPending} onClick={() => discardMutation.mutate()} variant="danger">{translate("inbox.action.discard")}</Button></>}
        icon="alert"
        onClose={() => { if (!discardMutation.isPending) setDiscardOpen(false); }}
        open={discardOpen}
        title={translate("inbox.discard.question")}
      >
        <p>{translate("inbox.discard.warning")}</p>
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
  return <div className="inbox-list inbox-list--loading" aria-label={translate("inbox.loading")}>{Array.from({ length: 4 }, (_, index) => <Card className="inbox-item inbox-item--skeleton" key={index} />)}</div>;
}
