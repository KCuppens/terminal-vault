import { type ReactNode, type Ref } from "react";

const PATHS = {
  terminal: "M4 17l6-6-6-6M12 19h8",
  server: "M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01",
  monitor: "M3 4h18v12H3zM8 20h8M12 16v4",
  key: "M21 2l-9.6 9.6M15.5 7.5l3 3M7.5 11a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z",
  layout: "M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z",
  sliders: "M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM9 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM17 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  lock: "M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3",
  unlock: "M6 11h12v9H6zM8 11V8a4 4 0 0 1 7.5-2",
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-5-5",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6L6 18",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  chevronDown: "M6 9l6 6 6-6",
  chevronUp: "M6 15l6-6 6 6",
  check: "M5 12l5 5 9-10",
  copy: "M9 9h11v11H9zM5 15V4h11",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  eyeOff:
    "M3 3l18 18M10.6 6.2A9.8 9.8 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.2 3.7M6.3 7.5A17 17 0 0 0 2 12s4 7 10 7c1.4 0 2.7-.3 3.9-.8",
  warning: "M12 3l10 18H2zM12 10v5M12 18h.01",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v5M12 8h.01",
  clipboard: "M9 4h6v3H9zM8 5.5H6a1 1 0 0 0-1 1V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6.5a1 1 0 0 0-1-1h-2M9 12h6M9 16h4",
  prompt: "M5 6l7 6-7 6M13 19h7",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2",
  splitH: "M3 4h18v16H3zM12 4v16",
  splitV: "M3 4h18v16H3zM3 12h18",
  minimize: "M5 12h14",
  maximize: "M5 5h14v14H5z",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  edit: "M4 20h4L19 9l-4-4L4 16zM13 7l4 4",
  refresh: "M20 11a8 8 0 1 0-2.3 6M20 4v7h-7",
  arrowUp: "M12 19V5M6 11l6-6 6 6",
  arrowDown: "M12 5v14M6 13l6 6 6-6",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  file: "M6 3h8l4 4v14H6zM14 3v4h4",
  command: "M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z",
  tag: "M3 12V4h8l10 10-8 8zM7.5 8h.01",
  terminalBox: "M3 4h18v16H3zM7 10l3 2-3 2M12 15h4",
  upload: "M12 15V4M7.5 8.5L12 4l4.5 4.5M4 15v5h16v-5",
  gear: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0z",
  rack: "M6 4h12a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM6 13h12a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2zM8 7.5h.01M8 16.5h.01",
  grid: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM3 12h18M12 3v18",
  tileColumns: "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM12 4v16",
  tileRows: "M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 12h18",
  expand: "M15 3h6v6M14 10l7-7M9 21H3v-6M10 14l-7 7",
  chevronsUpDown: "M8 9l4-4 4 4M8 15l4 4 4-4",
  lockSolid:
    "M6 10h12a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM8 10V7a4 4 0 0 1 8 0v3h-2V7a2 2 0 0 0-4 0v3zM12 13.2a1.4 1.4 0 0 0-.7 2.6V18h1.4v-2.2a1.4 1.4 0 0 0-.7-2.6z",
  unlockSolid:
    "M6 10h12a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1zM8 10V7a4 4 0 0 1 7.6-1.7l-1.8.9A2 2 0 0 0 10 7v3zM12 13.2a1.4 1.4 0 0 0-.7 2.6V18h1.4v-2.2a1.4 1.4 0 0 0-.7-2.6z",
  alertSolid: "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM11 6.5h2V13h-2zM11 15h2v2.2h-2z",
} as const;

export type IconName = keyof typeof PATHS;

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

export function Icon({ name, size = 16, className }: IconProps) {
  const solid = name.endsWith("Solid");
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={solid ? "currentColor" : "none"}
      stroke={solid ? "none" : "currentColor"}
      strokeWidth={name === "more" ? 3 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} fillRule={solid ? "evenodd" : undefined} />
    </svg>
  );
}

export function Spinner({ label }: { label?: string }) {
  return <span className="spinner" role={label ? "status" : undefined} aria-label={label} />;
}

export type DotState = "live" | "connecting" | "ended" | "none";

export function StatusDot({ state }: { state: DotState }) {
  return <span className={`dot dot-${state}`} aria-hidden="true" />;
}

export function Keycaps({ keys }: { keys: readonly string[] }) {
  return (
    <span className="keycaps">
      {keys.map((k) => (
        <kbd key={k} className="kbd">
          {k}
        </kbd>
      ))}
    </span>
  );
}

interface SwitchProps {
  checked: boolean;
  onChange(next: boolean): void;
  label: string;
}

export function Switch({ checked, onChange, label }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      onClick={() => onChange(!checked)}
    >
      <span className="switch-knob" />
    </button>
  );
}

interface SegmentedProps<V extends string> {
  value: V;
  options: readonly { value: V; label: string }[];
  onChange(next: V): void;
  label: string;
}

export function Segmented<V extends string>({ value, options, onChange, label }: SegmentedProps<V>) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? "seg active" : "seg"}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

type CalloutTone = "info" | "warn" | "danger";

export function Callout({ tone, title, children }: { tone: CalloutTone; title?: string; children: ReactNode }) {
  return (
    <div className={`callout callout-${tone}`} role={tone === "danger" ? "alert" : undefined}>
      <Icon name={tone === "info" ? "info" : "warning"} size={18} />
      <div>
        {title && <strong>{title}</strong>}
        <div>{children}</div>
      </div>
    </div>
  );
}

interface PasswordFieldProps {
  id: string;
  label: string;
  value: string;
  onChange(next: string): void;
  shown: boolean;
  onToggleShown(): void;
  autoComplete: "current-password" | "new-password";
  autoFocus?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  invalid?: boolean;
  disabled?: boolean;
  describedBy?: string;
  hint?: string;
}

export function PasswordField(props: PasswordFieldProps) {
  const { id, label, value, onChange, shown, onToggleShown, hint, describedBy } = props;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className={props.invalid ? "input-wrap invalid" : "input-wrap"}>
        <input
          id={id}
          type={shown ? "text" : "password"}
          value={value}
          autoComplete={props.autoComplete}
          ref={props.inputRef}
          autoFocus={props.autoFocus}
          disabled={props.disabled}
          aria-invalid={props.invalid ? true : undefined}
          aria-describedby={describedBy}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="icon-btn"
          aria-label={shown ? "Hide passphrase" : "Show passphrase"}
          aria-pressed={shown}
          disabled={props.disabled}
          onClick={onToggleShown}
        >
          <Icon name={shown ? "eyeOff" : "eye"} />
        </button>
      </div>
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}
