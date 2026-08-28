import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "./icons";

const weekdayNames = ["일", "월", "화", "수", "목", "금", "토"];

export type DatePickerProps = {
  value: string;
  label: string;
  onChange: (value: string) => void;
  align?: "start" | "end";
  min?: string;
  max?: string;
  disabled?: boolean;
};

function dateOf(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function monthKey(date: Date) {
  return date.toISOString().slice(0, 7);
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function addDays(value: string, days: number) {
  const date = dateOf(value);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date);
}

function moveMonth(value: string, offset: number) {
  const [year, month] = value.split("-").map(Number);
  return monthKey(new Date(Date.UTC(year, month - 1 + offset, 1)));
}

function moveDateByMonth(value: string, offset: number) {
  const [year, month, day] = value.split("-").map(Number);
  const targetMonth = new Date(Date.UTC(year, month - 1 + offset, 1));
  const lastDay = new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0)).getUTCDate();
  return dateKey(new Date(Date.UTC(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth(), Math.min(day, lastDay))));
}

function calendarDays(visibleMonth: string) {
  const first = dateOf(`${visibleMonth}-01`);
  const start = new Date(first);
  start.setUTCDate(1 - first.getUTCDay());
  return Array.from({ length: 42 }, (_, index) => addDays(dateKey(start), index));
}

function monthLabel(value: string) {
  const [year, month] = value.split("-").map(Number);
  return `${year}년 ${month}월`;
}

function dayLabel(value: string, selected: boolean, today: boolean) {
  const [year, month, day] = value.split("-").map(Number);
  return `${year}년 ${month}월 ${day}일${today ? ", 오늘" : ""}${selected ? ", 선택됨" : ""}`;
}

export function DatePicker({ value, label, onChange, align = "start", min, max, disabled = false }: DatePickerProps) {
  const currentToday = todayKey();
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => (value || currentToday).slice(0, 7));
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dayRefs = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocusRef = useRef<string | null>(null);
  const dialogId = useId();
  const days = calendarDays(visibleMonth);
  const focusableDay = days.includes(value) ? value : days.includes(currentToday) ? currentToday : `${visibleMonth}-01`;

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

  useEffect(() => {
    if (!open) return;
    const target = pendingFocusRef.current ?? focusableDay;
    pendingFocusRef.current = null;
    requestAnimationFrame(() => dayRefs.current.get(target)?.focus());
  }, [focusableDay, open, visibleMonth]);

  const changeMonth = (offset: number) => setVisibleMonth((current) => moveMonth(current, offset));

  const focusDate = (nextDate: string) => {
    pendingFocusRef.current = nextDate;
    const nextMonth = nextDate.slice(0, 7);
    if (nextMonth !== visibleMonth) setVisibleMonth(nextMonth);
    else requestAnimationFrame(() => dayRefs.current.get(nextDate)?.focus());
  };

  const onDayKeyDown = (event: KeyboardEvent<HTMLButtonElement>, date: string) => {
    let nextDate: string | null = null;
    if (event.key === "ArrowLeft") nextDate = addDays(date, -1);
    else if (event.key === "ArrowRight") nextDate = addDays(date, 1);
    else if (event.key === "ArrowUp") nextDate = addDays(date, -7);
    else if (event.key === "ArrowDown") nextDate = addDays(date, 7);
    else if (event.key === "Home") nextDate = addDays(date, -dateOf(date).getUTCDay());
    else if (event.key === "End") nextDate = addDays(date, 6 - dateOf(date).getUTCDay());
    else if (event.key === "PageUp") nextDate = moveDateByMonth(date, -1);
    else if (event.key === "PageDown") nextDate = moveDateByMonth(date, 1);
    if (!nextDate || (min && nextDate < min) || (max && nextDate > max)) return;
    event.preventDefault();
    focusDate(nextDate);
  };

  const select = (nextValue: string) => {
    onChange(nextValue);
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return (
    <div className="ui-date-picker" ref={rootRef}>
      <button
        aria-controls={open ? dialogId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
        className="ui-input ui-date-picker__trigger"
        disabled={disabled}
        onClick={() => {
          setVisibleMonth((value || currentToday).slice(0, 7));
          setOpen((current) => !current);
        }}
        ref={triggerRef}
        type="button"
      >
        <span>{value || "날짜 선택"}</span>
        <Icon name="calendar" size={13} />
      </button>

      {open && (
        <div aria-label={`${label} 선택`} className={`ui-date-picker__popup ui-date-picker__popup--${align}`} id={dialogId} role="dialog">
          <header className="ui-date-picker__header">
            <strong>{monthLabel(visibleMonth)}</strong>
            <div>
              <button aria-label="이전 달" onClick={() => changeMonth(-1)} type="button"><Icon name="arrowLeft" size={13} /></button>
              <button aria-label="다음 달" onClick={() => changeMonth(1)} type="button"><Icon name="chevronRight" size={13} /></button>
            </div>
          </header>
          <div aria-hidden="true" className="ui-date-picker__weekdays">
            {weekdayNames.map((name) => <span key={name}>{name}</span>)}
          </div>
          <div aria-label={monthLabel(visibleMonth)} className="ui-date-picker__days" role="group">
            {days.map((date) => {
              const selected = date === value;
              const today = date === currentToday;
              const outside = !date.startsWith(visibleMonth);
              const unavailable = Boolean((min && date < min) || (max && date > max));
              return (
                <button
                  aria-label={dayLabel(date, selected, today)}
                  aria-current={today ? "date" : undefined}
                  aria-pressed={selected}
                  className={["ui-date-picker__day", outside && "ui-date-picker__day--outside", today && "ui-date-picker__day--today", selected && "ui-date-picker__day--selected"].filter(Boolean).join(" ")}
                  disabled={unavailable}
                  key={date}
                  onClick={() => select(date)}
                  onKeyDown={(event) => onDayKeyDown(event, date)}
                  ref={(element) => {
                    if (element) dayRefs.current.set(date, element);
                    else dayRefs.current.delete(date);
                  }}
                  tabIndex={date === focusableDay ? 0 : -1}
                  type="button"
                >
                  {Number(date.slice(-2))}
                </button>
              );
            })}
          </div>
          <footer className="ui-date-picker__footer">
            <button onClick={() => select("")} type="button">삭제</button>
            <button disabled={Boolean((min && currentToday < min) || (max && currentToday > max))} onClick={() => select(currentToday)} type="button">오늘</button>
          </footer>
        </div>
      )}
    </div>
  );
}
