import type { Host, Layout } from "../ipc/types";
import { hostAddress } from "./hostMeta";
import { describeLayout } from "./layoutThumb";
import { shortcutKeys, type ShortcutAction } from "./shortcuts";

export type PaletteSection = "Recent" | "Hosts" | "Layouts" | "General" | "Settings";

export type PaletteIconName = "host" | "tmux" | "pane" | "layout" | "lock" | "tab" | "split" | "search" | "gear" | "key" | "plus";

export type ConnectMode = "default" | "tmux" | "newPane";

export type PaletteAction =
  | { type: "connect"; hostId: string; mode: ConnectMode }
  | { type: "openLayout"; layoutId: string }
  | { type: "shortcut"; action: ShortcutAction }
  | { type: "addHost" };

export interface PaletteItem {
  id: string;
  section: PaletteSection;
  title: string;
  subtitle?: string;
  icon: PaletteIconName;
  shortcut?: string[];
  keywords?: string;
  action: PaletteAction;
}

export interface PaletteGroup {
  section: PaletteSection;
  items: PaletteItem[];
}

export const SECTION_ORDER: PaletteSection[] = ["Recent", "Hosts", "Layouts", "General", "Settings"];

const MAX_RECENT = 3;

function isWordStart(text: string, i: number): boolean {
  return i === 0 || /[\s\-_:./@]/.test(text[i - 1]!);
}

/** Higher is better; null when `query` does not match `text`. Substring matches always beat scattered ones. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (q === "") return 0;
  const at = t.indexOf(q);
  if (at >= 0) {
    const start = at === 0 ? 50 : isWordStart(t, at) ? 25 : 0;
    return 100 + start - at * 0.5 - (t.length - q.length) * 0.1;
  }
  let score = 0;
  let from = 0;
  let previous = -2;
  let first = -1;
  for (const ch of q) {
    const found = t.indexOf(ch, from);
    if (found < 0) return null;
    if (first < 0) first = found;
    score += 1 + (found === previous + 1 ? 2 : 0) + (isWordStart(t, found) ? 3 : 0);
    previous = found;
    from = found + 1;
  }
  if (previous - first + 1 > q.length * 2) return null;
  return Math.min(score, 99);
}

export function scoreItem(item: PaletteItem, query: string): number | null {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  let total = 0;
  for (const token of tokens) {
    const title = fuzzyScore(token, item.title);
    const best = Math.max(
      title === null ? -Infinity : title * 2,
      fuzzyScore(token, item.subtitle ?? "") ?? -Infinity,
      fuzzyScore(token, item.keywords ?? "") ?? -Infinity,
    );
    if (best === -Infinity) return null;
    total += best;
  }
  return total;
}

export interface PaletteInput {
  hosts: Host[];
  layouts: Layout[];
}

export function buildPaletteItems({ hosts, layouts }: PaletteInput): PaletteItem[] {
  const items: PaletteItem[] = [];
  for (const h of hosts) {
    const subtitle = hostAddress(h);
    const keywords = h.tags.join(" ");
    items.push(
      { id: `connect:${h.id}`, section: "Hosts", title: `Connect: ${h.name}`, subtitle, icon: "host", keywords, action: { type: "connect", hostId: h.id, mode: "default" } },
      { id: `tmux:${h.id}`, section: "Hosts", title: `Connect: ${h.name} in tmux session...`, subtitle, icon: "tmux", keywords, action: { type: "connect", hostId: h.id, mode: "tmux" } },
      { id: `pane:${h.id}`, section: "Hosts", title: `Connect: ${h.name} in new pane`, subtitle, icon: "host", keywords, action: { type: "connect", hostId: h.id, mode: "newPane" } },
    );
  }
  for (const l of layouts) {
    items.push({ id: `layout:${l.id}`, section: "Layouts", title: `Open layout: ${l.name}`, subtitle: describeLayout(l), icon: "layout", action: { type: "openLayout", layoutId: l.id } });
  }
  const general = (
    action: ShortcutAction,
    title: string,
    icon: PaletteIconName,
    keywords = "",
  ): PaletteItem => ({
    id: `cmd:${action}`,
    section: "General",
    title,
    icon,
    keywords,
    shortcut: shortcutKeys(action),
    action: { type: "shortcut", action },
  });
  items.push(
    general("lock", "Lock vault", "lock", "secure"),
    general("newTab", "New terminal tab", "tab"),
    general("splitRight", "Split pane (horizontal)", "split", "side by side"),
    general("splitDown", "Split pane (vertical)", "split", "stack"),
    general("closePane", "Close pane", "pane"),
    general("find", "Search in terminal", "search", "scrollback find"),
    general("openHosts", "Show hosts", "host"),
    general("openKeys", "Show keys", "key", "ssh"),
    general("openLayouts", "Show layouts", "layout"),
    general("saveLayout", "Save current layout", "layout"),
    { id: "cmd:addHost", section: "General", title: "Add host", icon: "plus", keywords: "new server", action: { type: "addHost" } },
    { ...general("settings", "Open settings", "gear", "preferences options"), section: "Settings" },
  );
  return items;
}

export interface PaletteResult {
  groups: PaletteGroup[];
  /** Flat order the keyboard walks through. */
  flat: PaletteItem[];
}

/** Filter, rank and group. `recentIds` are item ids, newest first, and appear again under Recent. */
export function queryPalette(items: PaletteItem[], query: string, recentIds: string[]): PaletteResult {
  const q = query.trim();
  const ranked: { item: PaletteItem; score: number; order: number }[] = [];
  items.forEach((item, order) => {
    const score = scoreItem(item, q);
    if (score !== null) ranked.push({ item, score, order });
  });
  ranked.sort((a, b) => b.score - a.score || a.order - b.order);

  const bySection = new Map<PaletteSection, PaletteItem[]>();
  for (const { item } of ranked) {
    const list = bySection.get(item.section) ?? [];
    list.push(item);
    bySection.set(item.section, list);
  }
  const matched = new Set(ranked.map((r) => r.item.id));
  const recent: PaletteItem[] = [];
  for (const id of recentIds) {
    if (recent.length >= MAX_RECENT) break;
    const item = items.find((i) => i.id === id);
    if (item && matched.has(id)) recent.push({ ...item, id: `recent:${id}`, section: "Recent" });
  }
  if (recent.length > 0) bySection.set("Recent", recent);

  const groups: PaletteGroup[] = [];
  for (const section of SECTION_ORDER) {
    const list = bySection.get(section);
    if (list && list.length > 0) groups.push({ section, items: list });
  }
  return { groups, flat: groups.flatMap((g) => g.items) };
}
