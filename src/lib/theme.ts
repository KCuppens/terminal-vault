import type { Settings } from "../ipc/types";

export type ResolvedTheme = "dark" | "light";

export function resolveTheme(setting: Settings["theme"], prefersDark: boolean): ResolvedTheme {
  if (setting === "system") return prefersDark ? "dark" : "light";
  return setting;
}

export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
}

export const TERMINAL_THEMES: Record<ResolvedTheme, TerminalTheme> = {
  dark: {
    background: "#0a1016",
    foreground: "#d7dae0",
    cursor: "#e6e9ef",
    cursorAccent: "#0a1016",
    selectionBackground: "#2b4a7a",
  },
  light: {
    background: "#fbfbfd",
    foreground: "#23262f",
    cursor: "#23262f",
    cursorAccent: "#fbfbfd",
    selectionBackground: "#b9d2f7",
  },
};

export const SEARCH_DECORATIONS = {
  matchBackground: "#7a5d12",
  matchOverviewRuler: "#d9a520",
  activeMatchBackground: "#d9a520",
  activeMatchColorOverviewRuler: "#ffc83d",
};

export function terminalFontStack(family: string): string {
  const trimmed = family.trim();
  const fallback = '"Cascadia Mono", "DejaVu Mono", "DejaVu Sans Mono", Consolas, monospace';
  return trimmed === "" ? fallback : `"${trimmed.replace(/"/g, "")}", ${fallback}`;
}
