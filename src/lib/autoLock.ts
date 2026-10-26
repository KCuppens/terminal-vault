/** Seconds left before the idle lock fires, or null when auto-lock is off. */
export function remainingSeconds(lastActivityMs: number, nowMs: number, minutes: number): number | null {
  if (minutes <= 0) return null;
  return Math.max(0, Math.ceil((lastActivityMs + minutes * 60_000 - nowMs) / 1000));
}

export const COUNTDOWN_THRESHOLD_SECONDS = 60;

export function showCountdown(remaining: number | null): remaining is number {
  return remaining !== null && remaining < COUNTDOWN_THRESHOLD_SECONDS;
}
