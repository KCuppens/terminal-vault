import type { Settings } from "../ipc";

export const DEFAULT_SETTINGS: Settings = {
  auto_lock_minutes: 60,
  lock_on_minimize: false,
  clipboard_clear_seconds: 30,
  font_family: "JetBrains Mono",
  font_size: 14,
  scrollback: 10000,
  cursor_style: "block",
  bell: "visual",
  theme: "system",
  ui_scale: 100,
};

export interface Choice<V> {
  value: V;
  label: string;
}

export const AUTO_LOCK_MINUTES = [0, 1, 5, 10, 15, 30, 60, 120, 240];
export const CLIPBOARD_SECONDS = [0, 10, 30, 60, 120];
export const FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24];
export const SCROLLBACK_LINES = [1000, 5000, 10000, 25000, 50000, 100000];
export const UI_SCALES = [80, 90, 100, 110, 125, 150];
export const FONT_FAMILIES = [
  "JetBrains Mono",
  "Cascadia Mono",
  "Consolas",
  "Fira Code",
  "DejaVu Sans Mono",
  "Menlo",
  "monospace",
];

export const CURSOR_CHOICES: Choice<Settings["cursor_style"]>[] = [
  { value: "block", label: "Block" },
  { value: "bar", label: "Bar" },
  { value: "underline", label: "Underline" },
];

export const BELL_CHOICES: Choice<Settings["bell"]>[] = [
  { value: "visual", label: "Visual (no sound)" },
  { value: "sound", label: "Sound" },
  { value: "none", label: "Off" },
];

export const THEME_CHOICES: Choice<Settings["theme"]>[] = [
  { value: "system", label: "System" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

export function withCurrent<V>(values: V[], current: V): V[] {
  return values.includes(current) ? values : [...values, current].sort();
}

export function autoLockLabel(minutes: number): string {
  if (minutes === 0) return "Never";
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "1 hour" : `${hours} hours`;
  }
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

export function clipboardLabel(seconds: number): string {
  if (seconds === 0) return "Never";
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return minutes === 1 ? "1 minute" : `${minutes} minutes`;
  }
  return `${seconds} seconds`;
}

export function scaleLabel(percent: number): string {
  return percent === 100 ? "100% (Default)" : `${percent}%`;
}
