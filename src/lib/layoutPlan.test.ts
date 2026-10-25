import { describe, expect, it } from "vitest";

import type { Host, Layout } from "../ipc/types";
import { LayoutError, planLayout, workspaceToLayout } from "./layoutPlan";
import { computeGeometry, emptyWorkspace, workspaceReducer, type Action } from "./panes";

const host = (id: string): Host => ({
  id,
  name: id,
  addr: "10.0.0.1",
  port: 22,
  user: "root",
  key_id: null,
  tags: [],
});

function counter() {
  let n = 0;
  return () => `id${++n}`;
}

function build(actions: Action[]) {
  return actions.reduce(workspaceReducer, emptyWorkspace);
}

describe("workspaceToLayout", () => {
  const ws = build([
    { type: "newTab", tabId: "t1", paneId: "p1" },
    { type: "assignHost", paneId: "p1", hostId: "h1", title: "web" },
    { type: "split", dir: "H", splitId: "s1", paneId: "p2" },
    { type: "assignHost", paneId: "p2", hostId: "h2", title: "db" },
    { type: "split", dir: "V", splitId: "s2", paneId: "p3" },
    { type: "newTab", tabId: "t2", paneId: "p4" },
  ]);

  it("keeps the tree shape, drops empty panes and empty tabs", () => {
    const layout = workspaceToLayout(ws, "L1", "prod");
    expect(layout).toEqual({
      id: "L1",
      name: "prod",
      tabs: [
        {
          title: "web",
          root: {
            type: "split",
            dir: "H",
            ratio: 0.5,
            a: { type: "terminal", host_id: "h1" },
            b: { type: "terminal", host_id: "h2" },
          },
        },
      ],
    });
  });

  it("refuses to save when nothing is connected", () => {
    expect(() => workspaceToLayout(build([{ type: "newTab", tabId: "t", paneId: "p" }]), "L", "x")).toThrow(
      LayoutError,
    );
  });
});

describe("planLayout", () => {
  const layout: Layout = {
    id: "L1",
    name: "prod",
    tabs: [
      {
        title: "web",
        root: {
          type: "split",
          dir: "V",
          ratio: 0.3,
          a: { type: "terminal", host_id: "h1" },
          b: { type: "terminal", host_id: "h2" },
        },
      },
      { title: "solo", root: { type: "terminal", host_id: "h1" } },
    ],
  };

  it("produces tabs with fresh unique ids, ready to open in parallel", () => {
    const tabs = planLayout(layout, [host("h1"), host("h2")], counter());
    expect(tabs.map((t) => t.title)).toEqual(["web", "solo"]);
    const geometry = computeGeometry(tabs[0]!.root);
    expect(geometry.leaves.map((l) => l.hostId)).toEqual(["h1", "h2"]);
    expect(geometry.leaves[0]!.rect.h).toBeCloseTo(0.3);
    const ids = tabs.flatMap((t) => [t.id, ...computeGeometry(t.root).leaves.map((l) => l.id)]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(tabs[0]!.focus).toBe(geometry.leaves[0]!.id);
  });

  it("is all-or-nothing when a host is missing", () => {
    expect(() => planLayout(layout, [host("h1")], counter())).toThrow(/1 host/);
  });

  it("survives a save/plan roundtrip", () => {
    const ws = build([
      { type: "newTab", tabId: "t1", paneId: "p1" },
      { type: "assignHost", paneId: "p1", hostId: "h1", title: "web" },
      { type: "split", dir: "V", splitId: "s1", paneId: "p2" },
      { type: "assignHost", paneId: "p2", hostId: "h2", title: "x" },
      { type: "setRatio", splitId: "s1", ratio: 0.7 },
    ]);
    const saved = workspaceToLayout(ws, "L", "n");
    const tabs = planLayout(saved, [host("h1"), host("h2")], counter());
    expect(workspaceToLayout({ tabs, active: tabs[0]!.id }, "L", "n")).toEqual(saved);
  });
});
