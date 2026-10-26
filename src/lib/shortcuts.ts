export type ShortcutAction =
  | "palette"
  | "settings"
  | "lock"
  | "newTab"
  | "splitRight"
  | "splitDown"
  | "closePane"
  | "find"
  | "openHosts"
  | "openKeys"
  | "openLayouts"
  | "saveLayout";

interface KeyLike {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export interface ShortcutDef {
  action: ShortcutAction;
  label: string;
  /** Key caps in display order, e.g. ["Ctrl", "Shift", "T"]. */
  keys: string[];
}

/**
 * Every global shortcut. Plain Ctrl+letter is left to the shell (readline) except Ctrl+K and
 * Ctrl+comma, which are the only exceptions; everything else needs Ctrl+Shift.
 */
export const SHORTCUTS: ShortcutDef[] = [
  { action: "palette", label: "Command palette", keys: ["Ctrl", "K"] },
  { action: "settings", label: "Open settings", keys: ["Ctrl", ","] },
  { action: "newTab", label: "New terminal tab", keys: ["Ctrl", "Shift", "T"] },
  { action: "splitRight", label: "Split pane horizontally", keys: ["Ctrl", "Shift", "D"] },
  { action: "splitDown", label: "Split pane vertically", keys: ["Ctrl", "Shift", "R"] },
  { action: "closePane", label: "Close pane", keys: ["Ctrl", "Shift", "W"] },
  { action: "find", label: "Search in terminal", keys: ["Ctrl", "Shift", "F"] },
  { action: "lock", label: "Lock vault", keys: ["Ctrl", "Shift", "L"] },
  { action: "openHosts", label: "Show hosts", keys: ["Ctrl", "Shift", "H"] },
  { action: "openKeys", label: "Show keys", keys: ["Ctrl", "Shift", "K"] },
  { action: "openLayouts", label: "Show layouts", keys: ["Ctrl", "Shift", "Y"] },
  { action: "saveLayout", label: "Save current layout", keys: ["Ctrl", "Shift", "S"] },
];

const BY_KEY: Record<string, ShortcutAction> = {};
for (const def of SHORTCUTS) {
  if (def.keys.length === 3) BY_KEY[def.keys[2]!.toLowerCase()] = def.action;
}

export function shortcutKeys(action: ShortcutAction): string[] {
  return SHORTCUTS.find((s) => s.action === action)?.keys ?? [];
}

export function matchShortcut(e: KeyLike): ShortcutAction | null {
  if (!e.ctrlKey || e.altKey || e.metaKey) return null;
  const key = e.key.toLowerCase();
  if (!e.shiftKey) {
    if (key === "k") return "palette";
    if (key === ",") return "settings";
    return null;
  }
  return BY_KEY[key] ?? null;
}
