export type StrengthTone = "none" | "weak" | "fair" | "good" | "strong";

export interface Strength {
  bits: number;
  /** Filled segments of the 6-segment meter, 0 for an empty passphrase. */
  segments: number;
  tone: StrengthTone;
  label: string;
}

export const SEGMENT_COUNT = 6;
export const MIN_PASSPHRASE_LENGTH = 8;
export const STRENGTH_HINT = `Use at least ${MIN_PASSPHRASE_LENGTH} characters. Longer and more random is better.`;

const BITS_PER_SEGMENT = 14;

export function passphraseStrength(pass: string): Strength {
  if (pass === "") return { bits: 0, segments: 0, tone: "none", label: "" };
  const chars = [...pass];
  const pool =
    (/[a-z]/.test(pass) ? 26 : 0) +
    (/[A-Z]/.test(pass) ? 26 : 0) +
    (/[0-9]/.test(pass) ? 10 : 0) +
    (/[^a-zA-Z0-9]/.test(pass) ? 33 : 0);
  const distinct = new Set(chars).size;
  const effective = Math.min(chars.length, distinct * 2);
  const bits = pool === 0 ? 0 : effective * Math.log2(pool);
  const segments = Math.min(SEGMENT_COUNT, 1 + Math.floor(bits / BITS_PER_SEGMENT));
  const tone: StrengthTone = bits < 28 ? "weak" : bits < 45 ? "fair" : bits < 65 ? "good" : "strong";
  const name = { weak: "Weak", fair: "Fair", good: "Good", strong: "Strong" }[tone];
  const rounded = Math.max(5, Math.round(bits / 5) * 5);
  return { bits, segments, tone, label: `${name} (about ${rounded} bits)` };
}

export function acceptablePassphrase(pass: string): boolean {
  return [...pass].length >= MIN_PASSPHRASE_LENGTH;
}
