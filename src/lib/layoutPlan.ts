import type { Host, Layout, PaneNode, Tab } from "../ipc/types";
import { clampRatio, type Pane, type TabState, type Workspace } from "./panes";

export class LayoutError extends Error {}

function toNode(pane: Pane): PaneNode | null {
  if (pane.kind === "leaf") {
    return pane.hostId === null ? null : { type: "terminal", host_id: pane.hostId };
  }
  const a = toNode(pane.a);
  const b = toNode(pane.b);
  if (a === null || b === null) return a ?? b;
  return { type: "split", dir: pane.dir, ratio: pane.ratio, a, b };
}

/** Snapshot the current arrangement. Panes without a host are dropped; empty tabs are skipped. */
export function workspaceToLayout(ws: Workspace, id: string, name: string): Layout {
  const tabs: Tab[] = [];
  for (const t of ws.tabs) {
    const root = toNode(t.root);
    if (root !== null) tabs.push({ title: t.title, root });
  }
  if (tabs.length === 0) throw new LayoutError("Open at least one terminal before saving a layout");
  return { id, name, tabs };
}

export function layoutHostIds(node: PaneNode): string[] {
  return node.type === "terminal" ? [node.host_id] : [...layoutHostIds(node.a), ...layoutHostIds(node.b)];
}

/** Distinct host ids a layout refers to that are not in `hosts`, in first-seen order. */
export function missingHostIds(layout: Layout, hosts: Host[]): string[] {
  const known = new Set(hosts.map((h) => h.id));
  const missing = new Set<string>();
  for (const t of layout.tabs) {
    for (const id of layoutHostIds(t.root)) if (!known.has(id)) missing.add(id);
  }
  return [...missing];
}

function pruneNode(node: PaneNode, known: Set<string>): PaneNode | null {
  if (node.type === "terminal") return known.has(node.host_id) ? node : null;
  const a = pruneNode(node.a, known);
  const b = pruneNode(node.b, known);
  if (a === null || b === null) return a ?? b;
  return { ...node, a, b };
}

/** Drop panes whose host is gone, collapsing their splits and any tab left empty. */
export function pruneLayout(layout: Layout, hosts: Host[]): Layout {
  const known = new Set(hosts.map((h) => h.id));
  const tabs: Tab[] = [];
  for (const t of layout.tabs) {
    const root = pruneNode(t.root, known);
    if (root !== null) tabs.push({ title: t.title, root });
  }
  return { ...layout, tabs };
}

function toPane(node: PaneNode, newId: () => string): Pane {
  if (node.type === "terminal") return { kind: "leaf", id: newId(), hostId: node.host_id };
  return {
    kind: "split",
    id: newId(),
    dir: node.dir,
    ratio: clampRatio(node.ratio),
    a: toPane(node.a, newId),
    b: toPane(node.b, newId),
  };
}

/**
 * Resolve a saved layout against the current hosts. All host references are checked up
 * front so a layout either opens completely or not at all; every resulting leaf then
 * connects on its own, in parallel.
 */
export function planLayout(layout: Layout, hosts: Host[], newId: () => string): TabState[] {
  const known = new Set(hosts.map((h) => h.id));
  const missing = layout.tabs.flatMap((t) => layoutHostIds(t.root)).filter((id) => !known.has(id));
  if (missing.length > 0) {
    throw new LayoutError(`Layout "${layout.name}" references ${missing.length} host(s) that no longer exist`);
  }
  return layout.tabs.map((t) => {
    const root = toPane(t.root, newId);
    const first = firstLeafId(root);
    return { id: newId(), title: t.title, root, focus: first };
  });
}

function firstLeafId(pane: Pane): string {
  return pane.kind === "leaf" ? pane.id : firstLeafId(pane.a);
}
