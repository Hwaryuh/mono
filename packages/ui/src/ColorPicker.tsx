import { hexToOklch, oklchToHex, relativeLuminanceOfColor } from "@mono/domain";
import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent } from "react";
import { Icon, type IconName } from "./icons";

type HsvColor = { hue: number; saturation: number; value: number };

export type ColorPickerProps = {
  value: string;
  label: string;
  onChange: (value: string) => void;
  align?: "start" | "end";
  disabled?: boolean;
  selected?: boolean;
  icon?: IconName;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  return {
    red: Number.parseInt(normalized.slice(0, 2), 16),
    green: Number.parseInt(normalized.slice(2, 4), 16),
    blue: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function rgbToHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue].map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

function hexToHsv(hex: string): HsvColor {
  const { red, green, blue } = hexToRgb(hex);
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let hue = 0;
  if (delta > 0) {
    if (max === r) hue = 60 * (((g - b) / delta) % 6);
    else if (max === g) hue = 60 * ((b - r) / delta + 2);
    else hue = 60 * ((r - g) / delta + 4);
  }
  return { hue: hue < 0 ? hue + 360 : hue, saturation: max === 0 ? 0 : delta / max, value: max };
}

function hsvToHex({ hue, saturation, value }: HsvColor) {
  const chroma = value * saturation;
  const sector = hue / 60;
  const intermediate = chroma * (1 - Math.abs((sector % 2) - 1));
  const match = value - chroma;
  let red = 0;
  let green = 0;
  let blue = 0;
  if (sector < 1) [red, green] = [chroma, intermediate];
  else if (sector < 2) [red, green] = [intermediate, chroma];
  else if (sector < 3) [green, blue] = [chroma, intermediate];
  else if (sector < 4) [green, blue] = [intermediate, chroma];
  else if (sector < 5) [red, blue] = [intermediate, chroma];
  else [red, blue] = [chroma, intermediate];
  return rgbToHex((red + match) * 255, (green + match) * 255, (blue + match) * 255);
}

function contrastColor(hex: string) {
  const luminance = relativeLuminanceOfColor(hex) ?? 0;
  const lightContrast = 1.05 / (luminance + 0.05);
  const darkLuminance = relativeLuminanceOfColor("oklch(0.222 0.002 106.554)") ?? 0;
  const darkContrast = (luminance + 0.05) / (darkLuminance + 0.05);
  return darkContrast > lightContrast ? "oklch(0.222 0.002 106.554)" : "oklch(1 0 0)";
}

function editableHexOf(value: string) {
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
  return oklchToHex(value) ?? "#000000";
}

export function ColorPicker({ value, label, onChange, align = "start", disabled = false, selected = false, icon = "plus" }: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const editableHex = editableHexOf(value);
  const [hexDraft, setHexDraft] = useState(editableHex.toUpperCase());
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hsv = hexToHsv(editableHex);

  useEffect(() => setHexDraft(editableHex.toUpperCase()), [editableHex]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: globalThis.PointerEvent) => {
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

  const updateSaturationValue = (event: PointerEvent<HTMLDivElement>) => {
    if (event.type === "pointermove" && !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    if (event.type === "pointerdown") event.currentTarget.setPointerCapture(event.pointerId);
    const bounds = event.currentTarget.getBoundingClientRect();
    const saturation = clamp((event.clientX - bounds.left) / bounds.width, 0, 1);
    const nextValue = clamp(1 - (event.clientY - bounds.top) / bounds.height, 0, 1);
    onChange(hexToOklch(hsvToHex({ hue: hsv.hue, saturation, value: nextValue }))!);
  };

  const updateHue = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(hexToOklch(hsvToHex({ ...hsv, hue: Number(event.target.value) }))!);
  };

  const updateHex = (event: ChangeEvent<HTMLInputElement>) => {
    const nextValue = event.target.value.startsWith("#") ? event.target.value : `#${event.target.value}`;
    setHexDraft(nextValue.toUpperCase());
    if (/^#[0-9a-fA-F]{6}$/.test(nextValue)) onChange(hexToOklch(nextValue)!);
  };

  const { red, green, blue } = hexToRgb(editableHex);

  return (
    <div className="ui-color-picker" ref={rootRef}>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
        className={`ui-color-picker__trigger${selected ? " ui-color-picker__trigger--selected" : ""}`}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        ref={triggerRef}
        style={{ backgroundColor: value, color: contrastColor(value) }}
        type="button"
      >
        <Icon name={icon} size={12} strokeWidth={2.2} />
      </button>

      {open && (
        <div aria-label={`${label} 선택`} className={`ui-color-picker__popup ui-color-picker__popup--${align}`} role="dialog">
          <header>
            <strong>색 선택</strong>
            <button aria-label="색 선택 닫기" onClick={() => setOpen(false)} type="button"><Icon name="close" size={12} /></button>
          </header>
          <div
            aria-hidden="true"
            className="ui-color-picker__sv"
            onPointerDown={updateSaturationValue}
            onPointerMove={updateSaturationValue}
            style={{ backgroundColor: hexToOklch(hsvToHex({ hue: hsv.hue, saturation: 1, value: 1 }))! }}
          >
            <span style={{ left: `${hsv.saturation * 100}%`, top: `${(1 - hsv.value) * 100}%` }} />
          </div>
          <input aria-label="색조" className="ui-color-picker__hue" max={359} min={0} onChange={updateHue} type="range" value={Math.round(hsv.hue)} />
          <div className="ui-color-picker__values">
            <span aria-hidden="true" style={{ backgroundColor: value }} />
            <input aria-label="HEX 색상" maxLength={7} onBlur={() => setHexDraft(editableHex.toUpperCase())} onChange={updateHex} spellCheck={false} value={hexDraft} />
            <small>{red}, {green}, {blue}</small>
          </div>
        </div>
      )}
    </div>
  );
}
