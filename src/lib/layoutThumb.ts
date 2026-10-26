import type { Layout, PaneNode } from "../ipc/types";
import { layoutHostIds } from "./layoutPlan";
import { plural } from "./format";

export interface ThumbRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Leaf rectangles of a pane tree inside the unit square, with `gap` between neighbours. */
export function thumbRects(node: PaneNode, gap = 0.05, area: ThumbRect = { x: 0, y: 0, w: 1, h: 1 }): ThumbRect[] {
  if (node.type === "terminal") return [area];
  if (node.dir === "H") {
    const usable = Math.max(0, area.w - gap);
    const wa = usable * node.ratio;
    return [
      ...thumbRects(node.a, gap, { ...area, w: wa }),
      ...thumbRects(node.b, gap, { ...area, x: area.x + wa + gap, w: usable - wa }),
    ];
  }
  const usable = Math.max(0, area.h - gap);
  const ha = usable * node.ratio;
  return [
    ...thumbRects(node.a, gap, { ...area, h: ha }),
    ...thumbRects(node.b, gap, { ...area, y: area.y + ha + gap, h: usable - ha }),
  ];
}

export function countPanes(node: PaneNode): number {
  return layoutHostIds(node).length;
}

export function layoutStats(layout: Layout): { tabs: number; panes: number } {
  return { tabs: layout.tabs.length, panes: layout.tabs.reduce((n, t) => n + countPanes(t.root), 0) };
}

export function describeLayout(layout: Layout): string {
  const { tabs, panes } = layoutStats(layout);
  return `${plural(tabs, "tab")} · ${plural(panes, "pane")}`;
}

/** Distinct host ids across all tabs, first-seen order. */
export function layoutHosts(layout: Layout): string[] {
  return [...new Set(layout.tabs.flatMap((t) => layoutHostIds(t.root)))];
}
