import type { SplitDir } from "../ipc/types";

export type Pane =
  | { kind: "leaf"; id: string; hostId: string | null }
  | { kind: "split"; id: string; dir: SplitDir; ratio: number; a: Pane; b: Pane };

export interface TabState {
  id: string;
  title: string;
  root: Pane;
  focus: string;
}

export interface Workspace {
  tabs: TabState[];
  active: string | null;
}

export const MIN_RATIO = 0.1;
export const MAX_RATIO = 1 - MIN_RATIO;
export const DEFAULT_TAB_TITLE = "New tab";

export const emptyWorkspace: Workspace = { tabs: [], active: null };

export type Action =
  | { type: "reset" }
  | { type: "newTab"; tabId: string; paneId: string }
  | { type: "openTabs"; tabs: TabState[] }
  | { type: "closeTab"; tabId: string }
  | { type: "selectTab"; tabId: string }
  | { type: "split"; dir: SplitDir; splitId: string; paneId: string }
  | { type: "closePane"; paneId?: string }
  | { type: "focusPane"; paneId: string }
  | { type: "setRatio"; splitId: string; ratio: number }
  | { type: "assignHost"; paneId: string; hostId: string; title: string };

export function leaves(pane: Pane): Extract<Pane, { kind: "leaf" }>[] {
  return pane.kind === "leaf" ? [pane] : [...leaves(pane.a), ...leaves(pane.b)];
}

function mapPane(pane: Pane, fn: (p: Pane) => Pane): Pane {
  const mapped: Pane =
    pane.kind === "split" ? { ...pane, a: mapPane(pane.a, fn), b: mapPane(pane.b, fn) } : pane;
  return fn(mapped);
}

function removeLeaf(pane: Pane, id: string): Pane | null {
  if (pane.kind === "leaf") return pane.id === id ? null : pane;
  const a = removeLeaf(pane.a, id);
  const b = removeLeaf(pane.b, id);
  if (a === null) return b;
  if (b === null) return a;
  return a === pane.a && b === pane.b ? pane : { ...pane, a, b };
}

export function clampRatio(ratio: number): number {
  return Number.isFinite(ratio) ? Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio)) : 0.5;
}

function updateTab(ws: Workspace, tabId: string, fn: (t: TabState) => TabState): Workspace {
  return { ...ws, tabs: ws.tabs.map((t) => (t.id === tabId ? fn(t) : t)) };
}

function dropTab(ws: Workspace, tabId: string): Workspace {
  const idx = ws.tabs.findIndex((t) => t.id === tabId);
  if (idx < 0) return ws;
  const tabs = ws.tabs.filter((t) => t.id !== tabId);
  const active = ws.active === tabId ? (tabs[Math.min(idx, tabs.length - 1)]?.id ?? null) : ws.active;
  return { tabs, active };
}

function tabOfPane(ws: Workspace, paneId: string): TabState | undefined {
  return ws.tabs.find((t) => leaves(t.root).some((l) => l.id === paneId));
}

export function workspaceReducer(ws: Workspace, action: Action): Workspace {
  switch (action.type) {
    case "reset":
      return emptyWorkspace;
    case "newTab": {
      const tab: TabState = {
        id: action.tabId,
        title: DEFAULT_TAB_TITLE,
        root: { kind: "leaf", id: action.paneId, hostId: null },
        focus: action.paneId,
      };
      return { tabs: [...ws.tabs, tab], active: tab.id };
    }
    case "openTabs": {
      const first = action.tabs[0];
      if (!first) return ws;
      return { tabs: [...ws.tabs, ...action.tabs], active: first.id };
    }
    case "closeTab":
      return dropTab(ws, action.tabId);
    case "selectTab":
      return ws.tabs.some((t) => t.id === action.tabId) ? { ...ws, active: action.tabId } : ws;
    case "split": {
      const tab = ws.tabs.find((t) => t.id === ws.active);
      if (!tab) return ws;
      return updateTab(ws, tab.id, (t) => ({
        ...t,
        focus: action.paneId,
        root: mapPane(t.root, (p) =>
          p.kind === "leaf" && p.id === t.focus
            ? {
                kind: "split",
                id: action.splitId,
                dir: action.dir,
                ratio: 0.5,
                a: p,
                b: { kind: "leaf", id: action.paneId, hostId: null },
              }
            : p,
        ),
      }));
    }
    case "closePane": {
      const tab = action.paneId
        ? tabOfPane(ws, action.paneId)
        : ws.tabs.find((t) => t.id === ws.active);
      if (!tab) return ws;
      const target = action.paneId ?? tab.focus;
      const root = removeLeaf(tab.root, target);
      if (root === null) return dropTab(ws, tab.id);
      const remaining = leaves(root);
      const focus = remaining.some((l) => l.id === tab.focus) ? tab.focus : remaining[0]!.id;
      return updateTab(ws, tab.id, (t) => ({ ...t, root, focus }));
    }
    case "focusPane": {
      const tab = tabOfPane(ws, action.paneId);
      if (!tab) return ws;
      return { ...updateTab(ws, tab.id, (t) => ({ ...t, focus: action.paneId })), active: tab.id };
    }
    case "setRatio":
      return {
        ...ws,
        tabs: ws.tabs.map((t) => ({
          ...t,
          root: mapPane(t.root, (p) =>
            p.kind === "split" && p.id === action.splitId
              ? { ...p, ratio: clampRatio(action.ratio) }
              : p,
          ),
        })),
      };
    case "assignHost": {
      const tab = tabOfPane(ws, action.paneId);
      if (!tab) return ws;
      const hadHosts = leaves(tab.root).some((l) => l.hostId !== null);
      return updateTab(ws, tab.id, (t) => ({
        ...t,
        title: hadHosts ? t.title : action.title,
        root: mapPane(t.root, (p) =>
          p.kind === "leaf" && p.id === action.paneId ? { ...p, hostId: action.hostId } : p,
        ),
      }));
    }
  }
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Divider {
  splitId: string;
  dir: SplitDir;
  ratio: number;
  /** Rectangle of the whole split the divider belongs to. */
  rect: Rect;
}

export interface PaneGeometry {
  leaves: { id: string; hostId: string | null; rect: Rect }[];
  dividers: Divider[];
}

/**
 * Geometry as fractions of the tab area. Leaves are rendered flat (keyed by id) so a
 * running terminal is never remounted when a split reshapes the tree around it.
 * `H` places children side by side, `V` stacks them.
 */
export function computeGeometry(root: Pane, rect: Rect = { x: 0, y: 0, w: 1, h: 1 }): PaneGeometry {
  if (root.kind === "leaf") return { leaves: [{ id: root.id, hostId: root.hostId, rect }], dividers: [] };
  const [ra, rb] =
    root.dir === "H"
      ? [
          { ...rect, w: rect.w * root.ratio },
          { ...rect, x: rect.x + rect.w * root.ratio, w: rect.w * (1 - root.ratio) },
        ]
      : [
          { ...rect, h: rect.h * root.ratio },
          { ...rect, y: rect.y + rect.h * root.ratio, h: rect.h * (1 - root.ratio) },
        ];
  const a = computeGeometry(root.a, ra);
  const b = computeGeometry(root.b, rb);
  return {
    leaves: [...a.leaves, ...b.leaves],
    dividers: [{ splitId: root.id, dir: root.dir, ratio: root.ratio, rect }, ...a.dividers, ...b.dividers],
  };
}
