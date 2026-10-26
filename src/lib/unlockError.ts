export type UnlockFailure =
  | { kind: "wrong" }
  | { kind: "throttled"; seconds: number }
  | { kind: "corrupt" }
  | { kind: "other"; message: string };

const RETRY = /retry in (\d+)\s*s/i;
const CORRUPT = /corrupt|unsupported vault format|invalid key derivation|invalid vault data/i;
const WRONG = /wrong passphrase/i;

/** Seconds from "too many attempts: retry in <N>s", or null when the message has no such hint. */
export function parseRetrySeconds(message: string): number | null {
  const match = RETRY.exec(message);
  return match ? Number(match[1]) : null;
}

export function classifyUnlockError(message: string): UnlockFailure {
  const seconds = parseRetrySeconds(message);
  if (seconds !== null) return { kind: "throttled", seconds };
  if (CORRUPT.test(message)) return { kind: "corrupt" };
  if (WRONG.test(message)) return { kind: "wrong" };
  return { kind: "other", message };
}
