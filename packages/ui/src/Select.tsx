import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";

export type SelectOption = {
  value: string;
  label: string;
  dotColor?: string;
  disabled?: boolean;
};

export type SelectProps = {
  value: string;
  label: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  align?: "start" | "end";
  disabled?: boolean;
};

type ListboxPosition = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
  placement: "above" | "below";
};

const listboxGap = 6;
const viewportPadding = 8;
const listboxMinWidth = 180;
const listboxMaxHeight = 240;
const optionHeight = 34;
const listboxPadding = 8;

function nextEnabledIndex(options: SelectOption[], start: number, direction: 1 | -1) {
  if (options.length === 0) return -1;
  for (let step = 1; step <= options.length; step += 1) {
    const index = (start + direction * step + options.length) % options.length;
    if (!options[index]?.disabled) return index;
  }
  return -1;
}

export function Select({ value, label, options, onChange, align = "start", disabled = false }: SelectProps) {
  const selectedIndex = options.findIndex((option) => option.value === value);
  const selectedOption = options[selectedIndex];
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(selectedIndex);
  const [listboxPosition, setListboxPosition] = useState<ListboxPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef(new Map<number, HTMLButtonElement>());
  const listboxId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !listboxRef.current?.contains(target)) setOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
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

  useLayoutEffect(() => {
    if (!open) {
      setListboxPosition(null);
      return;
    }

    const updatePosition = () => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const width = Math.min(Math.max(rect.width, listboxMinWidth), viewportWidth - viewportPadding * 2);
      const preferredLeft = align === "end" ? rect.right - width : rect.left;
      const left = Math.min(Math.max(viewportPadding, preferredLeft), viewportWidth - width - viewportPadding);
      const desiredHeight = Math.min(listboxMaxHeight, options.length * optionHeight + listboxPadding);
      const spaceBelow = viewportHeight - rect.bottom - listboxGap - viewportPadding;
      const spaceAbove = rect.top - listboxGap - viewportPadding;
      const placement = spaceBelow >= desiredHeight || spaceBelow >= spaceAbove ? "below" : "above";
      const availableHeight = placement === "below" ? spaceBelow : spaceAbove;
      const maxHeight = Math.max(optionHeight + listboxPadding, Math.min(listboxMaxHeight, availableHeight));
      const renderedHeight = Math.min(desiredHeight, maxHeight);
      const top = placement === "below"
        ? rect.bottom + listboxGap
        : Math.max(viewportPadding, rect.top - listboxGap - renderedHeight);

      setListboxPosition({ left, top, width, maxHeight, placement });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [align, open, options.length]);

  useEffect(() => {
    if (!open || highlightedIndex < 0) return;
    optionRefs.current.get(highlightedIndex)?.scrollIntoView?.({ block: "nearest" });
  }, [highlightedIndex, open]);

  const select = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const openListbox = (initialIndex = selectedIndex >= 0 ? selectedIndex : nextEnabledIndex(options, -1, 1)) => {
    setHighlightedIndex(initialIndex);
    setOpen(true);
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      if (!open) {
        const origin = selectedIndex >= 0 ? selectedIndex : direction === 1 ? -1 : 0;
        openListbox(nextEnabledIndex(options, origin, direction));
      } else {
        setHighlightedIndex((current) => nextEnabledIndex(options, current, direction));
      }
      return;
    }
    if (!open) return;
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setHighlightedIndex(event.key === "Home" ? nextEnabledIndex(options, -1, 1) : nextEnabledIndex(options, 0, -1));
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      select(highlightedIndex);
    }
  };

  return (
    <div className="ui-select" ref={rootRef}>
      <button
        aria-activedescendant={open && highlightedIndex >= 0 ? `${listboxId}-option-${highlightedIndex}` : undefined}
        aria-controls={open ? listboxId : undefined}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={label}
        className="ui-input ui-select__trigger"
        disabled={disabled}
        onClick={() => open ? setOpen(false) : openListbox()}
        onKeyDown={onTriggerKeyDown}
        ref={triggerRef}
        role="combobox"
        type="button"
      >
        {selectedOption?.dotColor && <span aria-hidden="true" className="ui-select__dot" style={{ backgroundColor: selectedOption.dotColor }} />}
        <span className="ui-select__value">{selectedOption?.label ?? "선택"}</span>
        <Icon className="ui-select__chevron" name="chevronDown" size={13} />
      </button>

      {open && listboxPosition && createPortal(
        <div
          aria-label={`${label} 옵션`}
          className={`ui-select__listbox ui-select__listbox--${listboxPosition.placement}`}
          id={listboxId}
          ref={listboxRef}
          role="listbox"
          style={{
            left: listboxPosition.left,
            top: listboxPosition.top,
            width: listboxPosition.width,
            maxHeight: listboxPosition.maxHeight,
          } as CSSProperties}
        >
          {options.map((option, index) => {
            const selected = option.value === value;
            return (
              <button
                aria-selected={selected}
                className="ui-select__option"
                data-highlighted={highlightedIndex === index || undefined}
                disabled={option.disabled}
                id={`${listboxId}-option-${index}`}
                key={option.value}
                onClick={() => select(index)}
                onMouseEnter={() => setHighlightedIndex(index)}
                ref={(element) => {
                  if (element) optionRefs.current.set(index, element);
                  else optionRefs.current.delete(index);
                }}
                role="option"
                tabIndex={-1}
                type="button"
              >
                {option.dotColor && <span aria-hidden="true" className="ui-select__dot" style={{ backgroundColor: option.dotColor }} />}
                <span className="ui-select__option-label">{option.label}</span>
                {selected && <Icon name="check" size={12} strokeWidth={2.2} />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
