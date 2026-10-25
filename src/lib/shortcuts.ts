export type ShortcutAction = "newTab" | "splitRight" | "splitDown" | "closePane";

interface KeyLike {
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

export function matchShortcut(e: KeyLike): ShortcutAction | null {
  if (!e.ctrlKey || !e.shiftKey || e.metaKey) return null;
  switch (e.key.toLowerCase()) {
    case "t":
      return e.altKey ? null : "newTab";
    case "d":
      return e.altKey ? "splitDown" : "splitRight";
    case "w":
      return e.altKey ? null : "closePane";
    default:
      return null;
  }
}
