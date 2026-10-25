export interface Strength {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
  hint: string;
}

const LABELS = ["Very weak", "Weak", "Fair", "Strong", "Excellent"] as const;

export function passphraseStrength(pass: string): Strength {
  const chars = [...pass];
  const pool =
    (/[a-z]/.test(pass) ? 26 : 0) +
    (/[A-Z]/.test(pass) ? 26 : 0) +
    (/[0-9]/.test(pass) ? 10 : 0) +
    (/[^a-zA-Z0-9]/.test(pass) ? 33 : 0);
  const distinct = new Set(chars).size;
  const effective = Math.min(chars.length, distinct * 2);
  const bits = pool === 0 ? 0 : effective * Math.log2(pool);
  const score = bits < 28 ? 0 : bits < 45 ? 1 : bits < 65 ? 2 : bits < 90 ? 3 : 4;
  const hint =
    chars.length < 12
      ? "Use at least 12 characters"
      : score < 3
        ? "Add more words or mix character types"
        : "Good. This passphrase cannot be recovered if you forget it";
  return { score: score as Strength["score"], label: LABELS[score], hint };
}
