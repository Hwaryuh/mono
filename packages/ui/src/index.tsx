import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type RefObject,
  type TextareaHTMLAttributes,
} from "react";
import { Icon, type IconName } from "./icons";

function classes(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "danger" | "text" | "ghost";
type ButtonSize = "small" | "medium";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  static?: boolean;
  loading?: boolean;
};

export function Button({
  variant = "secondary",
  size = "medium",
  static: isStatic = false,
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={classes("ui-button", `ui-button--${variant}`, `ui-button--${size}`, !isStatic && "ui-control--pressable", className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <Icon className="ui-button__spinner" name="sync" size={13} />}
      {children}
    </button>
  );
}

export type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "secondary" | "ghost";
  size?: "small" | "medium";
  static?: boolean;
};

export function IconButton({ variant = "secondary", size = "medium", static: isStatic = false, className, ...props }: IconButtonProps) {
  return (
    <button
      className={classes("ui-icon-button", `ui-icon-button--${variant}`, `ui-icon-button--${size}`, !isStatic && "ui-control--pressable", className)}
      {...props}
    />
  );
}

export type InputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean };

export function Input({ className, invalid, ...props }: InputProps) {
  return <input aria-invalid={invalid || undefined} className={classes("ui-input", className)} {...props} />;
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={classes("ui-input", "ui-textarea", className)} {...props} />;
}

export type ChipProps = HTMLAttributes<HTMLSpanElement> & {
  selected?: boolean;
  tone?: "neutral" | "accent" | "warning" | "danger";
  dotColor?: string;
};

export function Chip({ selected = false, tone = "neutral", dotColor, className, children, ...props }: ChipProps) {
  return (
    <span className={classes("ui-chip", `ui-chip--${tone}`, selected && "ui-chip--selected", className)} {...props}>
      {dotColor && <span aria-hidden="true" className="ui-chip__dot" style={{ backgroundColor: dotColor }} />}
      {children}
    </span>
  );
}

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: "neutral" | "accent" | "warning" | "danger" | "success";
};

export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return <span className={classes("ui-badge", `ui-badge--${tone}`, className)} {...props} />;
}

export type CheckboxProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> & {
  checked: boolean;
  label: string;
  onCheckedChange?: (checked: boolean) => void;
};

export function Checkbox({ checked, label, onCheckedChange, className, disabled, ...props }: CheckboxProps) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={classes("ui-checkbox", checked && "ui-checkbox--checked", "ui-control--pressable", className)}
      disabled={disabled}
      onClick={() => onCheckedChange?.(!checked)}
      role="checkbox"
      type="button"
      {...props}
    >
      <Icon name="check" size={11} strokeWidth={3} />
    </button>
  );
}

export type ConfidenceIndicatorProps = {
  value: number;
  variant?: "ring" | "bar";
  label?: string;
  className?: string;
};

export function ConfidenceIndicator({ value, variant = "ring", label = "확신도", className }: ConfidenceIndicatorProps) {
  const percent = Math.max(0, Math.min(100, Math.round(value * 100)));
  const low = percent < 75;

  if (variant === "bar") {
    return (
      <div className={classes("ui-confidence-bar", low && "ui-confidence--low", className)}>
        <div className="ui-confidence-bar__label"><span>{label}</span><span>{percent}%</span></div>
        <div aria-label={`${label} ${percent}%`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={percent} className="ui-confidence-bar__track" role="progressbar">
          <span style={{ width: `${percent}%` }} />
        </div>
      </div>
    );
  }

  return (
    <span
      aria-label={`${label} ${percent}%`}
      className={classes("ui-confidence-ring", low && "ui-confidence--low", className)}
      style={{ "--ui-confidence": `${percent}%` } as CSSProperties}
    >
      <span>{percent}</span>
    </span>
  );
}

type StatusTone = "neutral" | "accent" | "warning" | "danger" | "success";

export function StatusIndicator({ icon, label, tone = "neutral", className }: { icon?: IconName; label: ReactNode; tone?: StatusTone; className?: string }) {
  return (
    <span className={classes("ui-status", `ui-status--${tone}`, className)}>
      {icon ? <Icon name={icon} size={12} /> : <span aria-hidden="true" className="ui-status__dot" />}
      {label}
    </span>
  );
}

export type CardProps = HTMLAttributes<HTMLDivElement> & { variant?: "default" | "subtle" | "interactive" };

export function Card({ variant = "default", className, ...props }: CardProps) {
  return <div className={classes("ui-card", `ui-card--${variant}`, className)} {...props} />;
}

export function SectionHeader({ title, action, className }: { title: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={classes("ui-section-header", className)}>
      <span>{title}</span>
      {action}
    </div>
  );
}

const focusableSelector = [
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  "select:not([disabled])",
  "[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

const openOverlayPanels: HTMLElement[] = [];

function useOverlayLifecycle(open: boolean, onClose: () => void, panelRef: RefObject<HTMLElement | null>) {
  const onCloseRef = useRef(onClose);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  onCloseRef.current = onClose;

  if (open && !wasOpenRef.current && typeof document !== "undefined") {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasOpenRef.current = open;

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (panel) openOverlayPanels.push(panel);
    const focusable = () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])
      .filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");
    const onKeyDown = (event: KeyboardEvent) => {
      if (openOverlayPanels.at(-1) !== panelRef.current) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      if (elements.length === 0) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const focusedInside = document.activeElement instanceof HTMLElement && panelRef.current?.contains(document.activeElement)
      ? document.activeElement
      : null;
    const initialFocus = panelRef.current?.querySelector<HTMLElement>("[data-overlay-autofocus], [autofocus]") ?? focusedInside ?? focusable()[0];
    (initialFocus ?? panelRef.current)?.focus();
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      const panelIndex = panel ? openOverlayPanels.lastIndexOf(panel) : -1;
      if (panelIndex >= 0) openOverlayPanels.splice(panelIndex, 1);
      const returnFocus = returnFocusRef.current;
      returnFocusRef.current = null;
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [open, panelRef]);
}

function usePresence(open: boolean, exitDurationMs: number) {
  const [present, setPresent] = useState(open);
  const [closing, setClosing] = useState(false);
  const openRef = useRef(open);

  // Adjust state synchronously during render (not in an effect) so `present`
  // never lags a frame behind `open` — a lagging frame would let Modal/Drawer
  // render null on the very commit useOverlayLifecycle's effect reads
  // panelRef.current, permanently missing the focus-trap registration.
  if (open !== openRef.current) {
    openRef.current = open;
    if (open) {
      setPresent(true);
      setClosing(false);
    } else if (present) {
      setClosing(true);
    }
  }

  useEffect(() => {
    if (!closing) return;
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => {
      setPresent(false);
      setClosing(false);
    }, reduced ? 0 : exitDurationMs);
    return () => window.clearTimeout(timer);
  }, [closing, exitDurationMs]);

  return { present, closing };
}

type OverlayProps = {
  open: boolean;
  title: ReactNode;
  icon?: IconName;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
};

export function Modal({ open, title, icon, onClose, children, footer, className }: OverlayProps) {
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  useOverlayLifecycle(open, onClose, panelRef);
  const { present, closing } = usePresence(open, 160);
  if (!present) return null;
  return (
    <div aria-labelledby={titleId} aria-modal="true" className={classes("ui-overlay", "ui-overlay--center", closing && "ui-overlay--closing")} onMouseDown={onClose} role="dialog">
      <section className={classes("ui-modal", closing && "ui-modal--closing", className)} onMouseDown={(event) => event.stopPropagation()} ref={panelRef} tabIndex={-1}>
        <OverlayHeader icon={icon} onClose={onClose} title={title} titleId={titleId} />
        <div className="ui-overlay__body">{children}</div>
        {footer && <footer className="ui-overlay__footer">{footer}</footer>}
      </section>
    </div>
  );
}

export function Drawer({ open, title, icon, onClose, children, footer, className }: OverlayProps) {
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  useOverlayLifecycle(open, onClose, panelRef);
  const { present, closing } = usePresence(open, 180);
  if (!present) return null;
  return (
    <div aria-labelledby={titleId} aria-modal="true" className={classes("ui-overlay", "ui-overlay--end", closing && "ui-overlay--closing")} onMouseDown={onClose} role="dialog">
      <aside className={classes("ui-drawer", closing && "ui-drawer--closing", className)} onMouseDown={(event) => event.stopPropagation()} ref={panelRef} tabIndex={-1}>
        <OverlayHeader icon={icon} onClose={onClose} title={title} titleId={titleId} />
        <div className="ui-overlay__body">{children}</div>
        {footer && <footer className="ui-overlay__footer">{footer}</footer>}
      </aside>
    </div>
  );
}

function OverlayHeader({ title, titleId, icon, onClose }: { title: ReactNode; titleId: string; icon?: IconName; onClose: () => void }) {
  return (
    <header className="ui-overlay__header">
      {icon && <Icon name={icon} size={16} />}
      <strong id={titleId}>{title}</strong>
      <IconButton aria-label="닫기" onClick={onClose} size="small" variant="ghost">
        <Icon name="close" size={15} />
      </IconButton>
    </header>
  );
}

export { Icon, type IconName } from "./icons";
export { DatePicker, type DatePickerProps } from "./DatePicker";
export { TimePicker, type TimePickerProps } from "./TimePicker";
export { Select, type SelectOption, type SelectProps } from "./Select";
export { ColorPicker, type ColorPickerProps } from "./ColorPicker";
export { MorphingIcon, type MorphingIconName, type MorphingIconProps } from "./MorphingIcon";
