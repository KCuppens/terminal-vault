import { SEGMENT_COUNT, STRENGTH_HINT, type Strength } from "../lib/strength";

interface Props {
  strength: Strength;
  length: number;
  minLength: number;
}

export function StrengthMeter({ strength, length, minLength }: Props) {
  const short = length > 0 && length < minLength;
  return (
    <div className="strength" data-tone={strength.tone}>
      <div className="strength-bar" role="img" aria-label={strength.label || "Passphrase strength"}>
        {Array.from({ length: SEGMENT_COUNT }, (_, i) => (
          <span key={i} className={i < strength.segments ? "seg on" : "seg"} />
        ))}
      </div>
      <p className="hint" aria-live="polite">
        {short ? `Use at least ${minLength} characters.` : strength.label || STRENGTH_HINT}
      </p>
    </div>
  );
}
