import type { Ref } from "react";

import { SEGMENT_COUNT, STRENGTH_HINT, type Strength } from "../lib/strength";
import { AuthIcon } from "./authIcons";
import { Icon } from "./ui";

export type BrandVariant = "stack" | "row" | "compact";

const TAGLINE = "Your hosts and keys, encrypted here.";

export function Brand({ variant }: { variant: BrandVariant }) {
  return (
    <div className={`av-brand ${variant}`}>
      <span className="av-tile" aria-hidden="true">
        <AuthIcon name="prompt" />
      </span>
      <div className="av-brand-text">
        <span className="av-brand-name">terminal-vault</span>
        <span className="av-brand-tag">{TAGLINE}</span>
      </div>
    </div>
  );
}

interface PasswordInputProps {
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
  placeholder?: string;
  labelHidden?: boolean;
}

export function AuthPassword(props: PasswordInputProps) {
  const { id, label, labelHidden, invalid } = props;
  return (
    <div className="av-field">
      <label htmlFor={id} className={labelHidden ? "sr-only" : "av-label"}>
        {label}
      </label>
      <div className={invalid ? "av-input invalid" : "av-input"}>
        <input
          id={id}
          type={props.shown ? "text" : "password"}
          value={props.value}
          placeholder={props.placeholder}
          autoComplete={props.autoComplete}
          ref={props.inputRef}
          autoFocus={props.autoFocus}
          disabled={props.disabled}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={props.describedBy}
          spellCheck={false}
          onChange={(e) => props.onChange(e.target.value)}
        />
        <button
          type="button"
          className="av-eye"
          aria-label={props.shown ? "Hide passphrase" : "Show passphrase"}
          aria-pressed={props.shown}
          disabled={props.disabled}
          onClick={props.onToggleShown}
        >
          <Icon name={props.shown ? "eyeOff" : "eye"} size={24} />
        </button>
      </div>
    </div>
  );
}

export function AuthStrength({ strength }: { strength: Strength }) {
  return (
    <div className="av-strength" data-tone={strength.tone}>
      <div className="av-strength-row">
        <div className="av-strength-bar" role="img" aria-label={strength.label || "Passphrase strength"}>
          {Array.from({ length: SEGMENT_COUNT }, (_, i) => (
            <span key={i} className={i < strength.segments ? "seg on" : "seg"} />
          ))}
        </div>
        <span className="av-strength-label" aria-live="polite">
          {strength.label}
        </span>
      </div>
      <p className="av-hint">{STRENGTH_HINT}</p>
    </div>
  );
}
