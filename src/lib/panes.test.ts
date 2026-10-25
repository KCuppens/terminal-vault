import { describe, expect, it } from "vitest";

import {
  computeGeometry,
  emptyWorkspace,
  leaves,
  workspaceReducer,
  type Action,
  type Workspace,
} from "./panes";

function run(actions: Action[], from: Workspace = emptyWorkspace): Workspace {
  return actions.reduce(workspaceReducer, from);
}

const oneTab = run([{ type: "newTab", tabId: "t1", paneId: "p1" }]);

describe("workspaceReducer", () => {
  it("creates and activates tabs", () => {
    const ws = run([{ type: "newTab", tabId: "t2", paneId: "p2" }], oneTab);
    expect(ws.tabs.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(ws.active).toBe("t2");
    expect(ws.tabs[1]?.focus).toBe("p2");
  });

  it("splits the focused pane and focuses the new one", () => {
    const ws = run([{ type: "split", dir: "H", splitId: "s1", paneId: "p2" }], oneTab);
    const root = ws.tabs[0]!.root;
    expect(root).toMatchObject({ kind: "split", id: "s1", dir: "H", ratio: 0.5 });
    expect(leaves(root).map((l) => l.id)).toEqual(["p1", "p2"]);
    expect(ws.tabs[0]!.focus).toBe("p2");
  });

  it("splits nested panes in the focused position", () => {
    const ws = run([
      { type: "split", dir: "H", splitId: "s1", paneId: "p2" },
      { type: "split", dir: "V", splitId: "s2", paneId: "p3" },
    ], oneTab);
    const root = ws.tabs[0]!.root;
    if (root.kind !== "split") throw new Error("expected split");
    expect(root.b).toMatchObject({ kind: "split", id: "s2", dir: "V" });
    expect(leaves(root).map((l) => l.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("closing a pane promotes its sibling and refocuses", () => {
    const ws = run([
      { type: "split", dir: "H", splitId: "s1", paneId: "p2" },
      { type: "closePane" },
    ], oneTab);
    expect(ws.tabs[0]!.root).toMatchObject({ kind: "leaf", id: "p1" });
    expect(ws.tabs[0]!.focus).toBe("p1");
  });

  it("closing a non-focused pane keeps focus", () => {
    const ws = run([
      { type: "split", dir: "H", splitId: "s1", paneId: "p2" },
      { type: "closePane", paneId: "p1" },
    ], oneTab);
    expect(ws.tabs[0]!.root).toMatchObject({ kind: "leaf", id: "p2" });
    expect(ws.tabs[0]!.focus).toBe("p2");
  });

  it("closing the last pane closes the tab and activates a neighbour", () => {
    const two = run([{ type: "newTab", tabId: "t2", paneId: "p2" }], oneTab);
    const ws = run([{ type: "closePane" }], two);
    expect(ws.tabs.map((t) => t.id)).toEqual(["t1"]);
    expect(ws.active).toBe("t1");
    expect(run([{ type: "closePane" }], ws)).toEqual(emptyWorkspace);
  });

  it("clamps ratios and ignores non-finite ones", () => {
    const split = run([{ type: "split", dir: "V", splitId: "s1", paneId: "p2" }], oneTab);
    const ratioOf = (ws: Workspace) => {
      const root = ws.tabs[0]!.root;
      return root.kind === "split" ? root.ratio : NaN;
    };
    expect(ratioOf(run([{ type: "setRatio", splitId: "s1", ratio: 0.3 }], split))).toBe(0.3);
    expect(ratioOf(run([{ type: "setRatio", splitId: "s1", ratio: 0 }], split))).toBe(0.1);
    expect(ratioOf(run([{ type: "setRatio", splitId: "s1", ratio: 5 }], split))).toBe(0.9);
    expect(ratioOf(run([{ type: "setRatio", splitId: "s1", ratio: NaN }], split))).toBe(0.5);
  });

  it("assignHost titles only a tab that has no host yet", () => {
    const ws = run([
      { type: "assignHost", paneId: "p1", hostId: "h1", title: "alpha" },
      { type: "split", dir: "H", splitId: "s1", paneId: "p2" },
      { type: "assignHost", paneId: "p2", hostId: "h2", title: "beta" },
    ], oneTab);
    expect(ws.tabs[0]!.title).toBe("alpha");
    expect(leaves(ws.tabs[0]!.root).map((l) => l.hostId)).toEqual(["h1", "h2"]);
  });

  it("focusPane switches tab and focus; unknown ids are no-ops", () => {
    const two = run([{ type: "newTab", tabId: "t2", paneId: "p2" }], oneTab);
    const ws = run([{ type: "focusPane", paneId: "p1" }], two);
    expect(ws.active).toBe("t1");
    expect(run([{ type: "focusPane", paneId: "nope" }], ws)).toBe(ws);
    expect(run([{ type: "selectTab", tabId: "nope" }], ws)).toBe(ws);
  });

  it("reset drops every tab", () => {
    expect(run([{ type: "reset" }], oneTab)).toEqual(emptyWorkspace);
  });

  it("openTabs appends and activates the first new tab", () => {
    const tabs = run([{ type: "newTab", tabId: "t9", paneId: "p9" }]).tabs;
    const ws = run([{ type: "openTabs", tabs }], oneTab);
    expect(ws.tabs.map((t) => t.id)).toEqual(["t1", "t9"]);
    expect(ws.active).toBe("t9");
    expect(run([{ type: "openTabs", tabs: [] }], oneTab)).toBe(oneTab);
  });
});

describe("computeGeometry", () => {
  it("lays out nested splits as fractions and keeps leaf order", () => {
    const ws = run([
      { type: "split", dir: "H", splitId: "s1", paneId: "p2" },
      { type: "split", dir: "V", splitId: "s2", paneId: "p3" },
      { type: "setRatio", splitId: "s1", ratio: 0.25 },
    ], oneTab);
    const g = computeGeometry(ws.tabs[0]!.root);
    expect(g.leaves.map((l) => l.id)).toEqual(["p1", "p2", "p3"]);
    expect(g.leaves[0]!.rect).toEqual({ x: 0, y: 0, w: 0.25, h: 1 });
    expect(g.leaves[1]!.rect).toEqual({ x: 0.25, y: 0, w: 0.75, h: 0.5 });
    expect(g.leaves[2]!.rect).toEqual({ x: 0.25, y: 0.5, w: 0.75, h: 0.5 });
    expect(g.dividers.map((d) => d.splitId)).toEqual(["s1", "s2"]);
    expect(g.dividers[1]!.rect).toEqual({ x: 0.25, y: 0, w: 0.75, h: 1 });
  });
});
