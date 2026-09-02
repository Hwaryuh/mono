import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent, type UIEvent, type WheelEvent } from "react";
import { Icon } from "./icons";
import { uiMessage } from "./i18n";

export type TimePickerProps = {
  value: string;
  label: string;
  onChange: (value: string) => void;
  align?: "start" | "end";
  minuteStep?: number;
  min?: string;
  max?: string;
  disabled?: boolean;
};

const hourValues = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));
const wheelItemHeight = 32;

type TimeWheelProps = {
  label: string;
  unit: string;
  value: string;
  values: string[];
  onChange: (value: string) => void;
  disabled: (value: string) => boolean;
  autoFocus?: boolean;
};

function isTime(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function normalizeTimeInput(value: string) {
  const input = value.trim();
  if (!input) return "";
  let hourText: string;
  let minuteText: string;
  if (/^\d{1,2}:\d{1,2}$/.test(input)) {
    [hourText, minuteText] = input.split(":");
  } else if (/^\d{1,4}$/.test(input)) {
    if (input.length <= 2) [hourText, minuteText] = [input, "0"];
    else [hourText, minuteText] = [input.slice(0, -2), input.slice(-2)];
  } else {
    return null;
  }
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function currentTime() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

function minuteValuesOf(step: number, value: string) {
  const normalizedStep = Number.isInteger(step) && step > 0 && step <= 60 ? step : 1;
  const values = Array.from({ length: Math.ceil(60 / normalizedStep) }, (_, index) => index * normalizedStep)
    .filter((minute) => minute < 60)
    .map((minute) => String(minute).padStart(2, "0"));
  const selectedMinute = isTime(value) ? value.slice(3) : null;
  if (selectedMinute && !values.includes(selectedMinute)) values.push(selectedMinute);
  return values.sort();
}

function available(value: string, min?: string, max?: string) {
  return (!min || value >= min) && (!max || value <= max);
}

function timeLabel(value: string) {
  if (!isTime(value)) return uiMessage("timeSelect");
  const hour = Number(value.slice(0, 2));
  const minute = Number(value.slice(3));
  const period = hour < 12 ? uiMessage("am") : uiMessage("pm");
  const displayHour = hour % 12 || 12;
  return `${period} ${displayHour}:${String(minute).padStart(2, "0")}`;
}

function draftValueOf(value: string, minutes: string[], min?: string, max?: string) {
  if (isTime(value)) return value;
  const now = currentTime();
  const currentMinute = Number(now.slice(3));
  const nearestMinute = minutes.reduce((nearest, candidate) => (
    Math.abs(Number(candidate) - currentMinute) < Math.abs(Number(nearest) - currentMinute) ? candidate : nearest
  ), minutes[0] ?? "00");
  const nearestTime = `${now.slice(0, 2)}:${nearestMinute}`;
  if (available(nearestTime, min, max)) return nearestTime;
  return hourValues.flatMap((hour) => minutes.map((minute) => `${hour}:${minute}`)).find((candidate) => available(candidate, min, max)) ?? nearestTime;
}

function nearestEnabledIndex(values: string[], targetIndex: number, disabled: (value: string) => boolean) {
  for (let distance = 0; distance < values.length; distance += 1) {
    const before = targetIndex - distance;
    if (before >= 0 && !disabled(values[before])) return before;
    const after = targetIndex + distance;
    if (after < values.length && !disabled(values[after])) return after;
  }
  return -1;
}

function TimeWheel({ label, unit, value, values, onChange, disabled, autoFocus = false }: TimeWheelProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const scrollFrameRef = useRef<number | null>(null);
  const scrollEndRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastInternalValueRef = useRef<string | null>(null);
  const mountedRef = useRef(false);

  const scrollToIndex = (index: number, behavior: ScrollBehavior) => {
    const list = listRef.current;
    if (!list) return;
    const top = index * wheelItemHeight;
    if (typeof list.scrollTo === "function") list.scrollTo({ top, behavior });
    else list.scrollTop = top;
  };

  const choose = (nextValue: string, focus = false) => {
    if (disabled(nextValue)) return;
    lastInternalValueRef.current = nextValue;
    onChange(nextValue);
    const index = values.indexOf(nextValue);
    if (index >= 0) scrollToIndex(index, "smooth");
    if (focus) requestAnimationFrame(() => itemRefs.current.get(nextValue)?.focus({ preventScroll: true }));
  };

  useLayoutEffect(() => {
    const index = values.indexOf(value);
    if (index < 0 || !listRef.current) return;
    if (lastInternalValueRef.current === value) {
      lastInternalValueRef.current = null;
      return;
    }
    listRef.current.scrollTop = index * wheelItemHeight;
    if (!mountedRef.current && autoFocus) requestAnimationFrame(() => itemRefs.current.get(value)?.focus({ preventScroll: true }));
    mountedRef.current = true;
  }, [autoFocus, value, values]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    if (scrollEndRef.current !== null) clearTimeout(scrollEndRef.current);
  }, []);

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const list = event.currentTarget;
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = requestAnimationFrame(() => {
      const index = Math.max(0, Math.min(values.length - 1, Math.round(list.scrollTop / wheelItemHeight)));
      const nextValue = values[index];
      if (nextValue && !disabled(nextValue) && nextValue !== value) {
        lastInternalValueRef.current = nextValue;
        onChange(nextValue);
      }
    });

    if (scrollEndRef.current !== null) clearTimeout(scrollEndRef.current);
    scrollEndRef.current = setTimeout(() => {
      const targetIndex = Math.max(0, Math.min(values.length - 1, Math.round(list.scrollTop / wheelItemHeight)));
      const index = nearestEnabledIndex(values, targetIndex, disabled);
      if (index < 0) return;
      const nextValue = values[index];
      if (nextValue !== value) {
        lastInternalValueRef.current = nextValue;
        onChange(nextValue);
      }
      scrollToIndex(index, "smooth");
    }, 100);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const enabledValues = values.filter((candidate) => !disabled(candidate));
    const currentIndex = enabledValues.indexOf(value);
    let nextIndex = currentIndex;
    if (event.key === "ArrowUp") nextIndex = Math.max(0, currentIndex - 1);
    else if (event.key === "ArrowDown") nextIndex = Math.min(enabledValues.length - 1, currentIndex + 1);
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = enabledValues.length - 1;
    else return;
    event.preventDefault();
    const nextValue = enabledValues[nextIndex];
    if (nextValue) choose(nextValue, true);
  };

  const stopWheelPropagation = (event: WheelEvent<HTMLDivElement>) => event.stopPropagation();

  return (
    <section aria-label={label} className="ui-time-picker__column">
      <span aria-hidden="true">{label}</span>
      <div onScroll={onScroll} onWheel={stopWheelPropagation} ref={listRef} role="group">
        {values.map((nextValue) => (
          <button
            aria-label={`${Number(nextValue)}${unit}`}
            aria-pressed={nextValue === value}
            disabled={disabled(nextValue)}
            key={nextValue}
            onClick={() => choose(nextValue)}
            onKeyDown={onKeyDown}
            ref={(element) => {
              if (element) itemRefs.current.set(nextValue, element);
              else itemRefs.current.delete(nextValue);
            }}
            tabIndex={nextValue === value ? 0 : -1}
            type="button"
          >
            {nextValue}
          </button>
        ))}
      </div>
    </section>
  );
}

export function TimePicker({ value, label, onChange, align = "start", minuteStep = 1, min, max, disabled = false }: TimePickerProps) {
  const minutes = useMemo(() => minuteValuesOf(minuteStep, value), [minuteStep, value]);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(() => draftValueOf(value, minutes, min, max));
  const [inputValue, setInputValue] = useState(value);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogId = useId();
  const hour = draft.slice(0, 2);
  const minute = draft.slice(3);

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const openPicker = () => {
    const normalizedInput = normalizeTimeInput(inputValue);
    const nextDraft = normalizedInput && available(normalizedInput, min, max)
      ? normalizedInput
      : draftValueOf(value, minutes, min, max);
    setDraft(nextDraft);
    setOpen(true);
  };

  useEffect(() => setInputValue(value), [value]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const enabledMinutes = (nextHour: string) => minutes.filter((nextMinute) => available(`${nextHour}:${nextMinute}`, min, max));

  const selectHour = (nextHour: string) => {
    const validMinutes = enabledMinutes(nextHour);
    if (validMinutes.length === 0) return;
    const nextMinute = validMinutes.includes(minute) ? minute : validMinutes[0];
    setDraft(`${nextHour}:${nextMinute}`);
  };

  const selectMinute = (nextMinute: string) => {
    const nextValue = `${hour}:${nextMinute}`;
    if (available(nextValue, min, max)) setDraft(nextValue);
  };

  const confirm = () => {
    if (!available(draft, min, max)) return;
    onChange(draft);
    close();
  };

  const updateInput = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value.replace(/[^\d:]/g, "").slice(0, 5);
    setInputValue(nextValue);
    if (!nextValue) onChange("");
    else if (isTime(nextValue) && available(nextValue, min, max)) onChange(nextValue);
  };

  const commitInput = () => {
    const nextValue = normalizeTimeInput(inputValue);
    if (nextValue === null || (nextValue && !available(nextValue, min, max))) {
      setInputValue(value);
      return;
    }
    setInputValue(nextValue);
    if (nextValue !== value) onChange(nextValue);
  };

  return (
    <div className="ui-time-picker" ref={rootRef}>
      <div className="ui-time-picker__control">
        <input
          aria-label={label}
          autoComplete="off"
          className="ui-input ui-time-picker__input"
          disabled={disabled}
          inputMode="numeric"
          maxLength={5}
          onBlur={commitInput}
          onChange={updateInput}
          onFocus={() => { if (open) close(false); }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitInput();
              event.currentTarget.select();
            } else if (event.key === "Escape") {
              setInputValue(value);
              event.currentTarget.blur();
            }
          }}
          placeholder="HH:MM"
          spellCheck={false}
          value={inputValue}
        />
        <button
          aria-controls={open ? dialogId : undefined}
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={uiMessage("timeDialogOpen", { label })}
          className="ui-time-picker__dial-trigger"
          disabled={disabled}
          onClick={() => open ? close() : openPicker()}
          ref={triggerRef}
          type="button"
        >
          <Icon name="clock" size={13} />
        </button>
      </div>

      {open && (
        <div aria-label={uiMessage("pickerSelect", { label })} className={`ui-time-picker__popup ui-time-picker__popup--${align}`} id={dialogId} role="dialog">
          <header className="ui-time-picker__header">
            <strong>{uiMessage("timeSelect")}</strong>
            <span aria-live="polite">{timeLabel(draft)}</span>
          </header>
          <div className="ui-time-picker__columns">
            <TimeWheel autoFocus disabled={(nextHour) => enabledMinutes(nextHour).length === 0} label={uiMessage("hour")} onChange={selectHour} unit={uiMessage("hour")} value={hour} values={hourValues} />
            <TimeWheel disabled={(nextMinute) => !available(`${hour}:${nextMinute}`, min, max)} label={uiMessage("minute")} onChange={selectMinute} unit={uiMessage("minute")} value={minute} values={minutes} />
          </div>
          <footer className="ui-time-picker__footer">
            <button onClick={() => { setInputValue(""); onChange(""); close(); }} type="button">{uiMessage("clear")}</button>
            <button disabled={!available(draft, min, max)} onClick={confirm} type="button">{uiMessage("done")}</button>
          </footer>
        </div>
      )}
    </div>
  );
}
