import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Host, Layout } from "../ipc/types";
import { remainingSeconds, showCountdown } from "./autoLock";
import { ClipboardCleaner, type ClipboardLike } from "./clipboard";
import { formatClock, formatCountdown } from "./format";
import { effectiveTmux, hostDetail } from "./hostMeta";
import { parseHostKeyChange, shortFingerprint } from "./hostKeyChanged";
import { missingHostIds, pruneLayout } from "./layoutPlan";
import { describeLayout, layoutStats, thumbRects } from "./layoutThumb";
import { buildPaletteItems, fuzzyScore, queryPalette } from "./palette";
import { countLines, needsPasteConfirm } from "./paste";
import { defaultSelection, markCandidates, toggleSelection } from "./sshConfig";
import { resolveTheme } from "./theme";
import { classifyUnlockError, parseRetrySeconds } from "./unlockError";

const host = (id: string, extra: Partial<Host> = {}): Host => ({
  id,
  name: id,
  addr: `${id}.example.com`,
  port: 22,
  user: "root",
  key_id: null,
  tags: [],
  tmux_session: null,
  ...extra,
});

describe("classifyUnlockError", () => {
  it("recognises the backend messages", () => {
    expect(classifyUnlockError("wrong passphrase")).toEqual({ kind: "wrong" });
    expect(classifyUnlockError("Error: wrong passphrase")).toEqual({ kind: "wrong" });
    expect(classifyUnlockError("too many attempts: retry in 10s")).toEqual({ kind: "throttled", seconds: 10 });
    expect(classifyUnlockError("vault file is corrupt: truncated header")).toEqual({ kind: "corrupt" });
    expect(classifyUnlockError("unsupported vault format version 9")).toEqual({ kind: "corrupt" });
    expect(classifyUnlockError("io error: denied")).toEqual({ kind: "other", message: "io error: denied" });
  });

  it("reads the retry delay", () => {
    expect(parseRetrySeconds("retry in 125s")).toBe(125);
    expect(parseRetrySeconds("nothing")).toBeNull();
  });
});

describe("parseHostKeyChange", () => {
  it("parses the connect error from the shell", () => {
    const msg =
      "host key for 10.0.0.1:22 changed (on record SHA256:aaa, presented SHA256:bbb); if the server was reinstalled, forget its key in the host list";
    expect(parseHostKeyChange(msg)).toEqual({ addrPort: "10.0.0.1:22", pinned: "SHA256:aaa", offered: "SHA256:bbb" });
    expect(parseHostKeyChange("connection refused")).toBeNull();
  });

  it("shortens long fingerprints only", () => {
    expect(shortFingerprint("SHA256:abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG")).toBe("SHA256:abcdefg...DEFG");
    expect(shortFingerprint("SHA256:abc")).toBe("SHA256:abc");
  });
});

describe("formatting", () => {
  it("formats countdowns and clocks", () => {
    expect(formatCountdown(30)).toBe("00:30");
    expect(formatCountdown(125)).toBe("02:05");
    expect(formatCountdown(-4)).toBe("00:00");
    expect(formatClock(59)).toBe("0:59");
    expect(formatClock(3725)).toBe("1:02:05");
  });
});

describe("autoLock", () => {
  it("counts down from the last activity and shows the last minute", () => {
    expect(remainingSeconds(0, 0, 0)).toBeNull();
    expect(remainingSeconds(0, 60_000, 1)).toBe(0);
    expect(remainingSeconds(1000, 31_000, 1)).toBe(30);
    expect(showCountdown(null)).toBe(false);
    expect(showCountdown(61)).toBe(false);
    expect(showCountdown(59)).toBe(true);
  });
});

describe("paste", () => {
  it("counts lines, ignoring one trailing newline", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("ls")).toBe(1);
    expect(countLines("ls\n")).toBe(1);
    expect(countLines("a\nb\r\nc")).toBe(3);
    expect(needsPasteConfirm("ls\n")).toBe(false);
    expect(needsPasteConfirm("a\nb")).toBe(true);
  });
});

describe("theme", () => {
  it("follows the system only when asked", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("hostMeta", () => {
  it("resolves the tmux choice", () => {
    const h = host("a", { tmux_session: "main" });
    expect(effectiveTmux(h, undefined)).toBe("main");
    expect(effectiveTmux(h, "")).toBeNull();
    expect(effectiveTmux(h, "other")).toBe("other");
    expect(effectiveTmux(host("b"), undefined)).toBeNull();
  });

  it("describes key and tmux state", () => {
    const keys = [{ id: "k1", name: "laptop", public: "", fingerprint: "", key_type: "ed25519" }];
    expect(hostDetail(host("a", { key_id: "k1", tmux_session: "main" }), keys)).toBe("key: laptop · tmux: main");
    expect(hostDetail(host("a", { key_id: "k1" }), keys)).toBe("key: laptop · plain shell");
    expect(hostDetail(host("a"), keys)).toBe("no key assigned");
  });
});

describe("layout helpers", () => {
  const layout: Layout = {
    id: "L",
    name: "prod",
    tabs: [
      {
        title: "one",
        root: {
          type: "split",
          dir: "H",
          ratio: 0.5,
          a: { type: "terminal", host_id: "h1" },
          b: {
            type: "split",
            dir: "V",
            ratio: 0.5,
            a: { type: "terminal", host_id: "h2" },
            b: { type: "terminal", host_id: "gone" },
          },
        },
      },
      { title: "two", root: { type: "terminal", host_id: "gone" } },
    ],
  };

  it("counts tabs and panes", () => {
    expect(layoutStats(layout)).toEqual({ tabs: 2, panes: 4 });
    expect(describeLayout(layout)).toBe("2 tabs · 4 panes");
    expect(describeLayout({ ...layout, tabs: [layout.tabs[1]!] })).toBe("1 tab · 1 pane");
  });

  it("finds and prunes missing hosts", () => {
    const hosts = [host("h1"), host("h2")];
    expect(missingHostIds(layout, hosts)).toEqual(["gone"]);
    const pruned = pruneLayout(layout, hosts);
    expect(pruned.tabs).toHaveLength(1);
    expect(pruned.tabs[0]!.root).toEqual({
      type: "split",
      dir: "H",
      ratio: 0.5,
      a: { type: "terminal", host_id: "h1" },
      b: { type: "terminal", host_id: "h2" },
    });
  });

  it("draws one inside-bounds rectangle per pane without overlap", () => {
    const rects = thumbRects(layout.tabs[0]!.root);
    expect(rects).toHaveLength(3);
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-9);
      expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-9);
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]!;
        const b = rects[j]!;
        const apart = a.x + a.w <= b.x + 1e-9 || b.x + b.w <= a.x + 1e-9 || a.y + a.h <= b.y + 1e-9 || b.y + b.h <= a.y + 1e-9;
        expect(apart).toBe(true);
      }
    }
  });
});

describe("ssh config import", () => {
  it("flags duplicates by name or endpoint and selects the rest", () => {
    const existing = [host("web-1", { addr: "10.0.0.1" })];
    const found = [
      { ...host("web-1"), id: undefined },
      { ...host("alias", { addr: "10.0.0.1" }), id: undefined },
      { ...host("db"), id: undefined },
      { ...host("db"), id: undefined },
    ].map(({ id: _id, ...rest }) => rest);
    const cands = markCandidates(found, existing);
    expect(cands.map((c) => c.duplicate)).toEqual([true, true, false, true]);
    const selected = defaultSelection(cands);
    expect([...selected]).toEqual([2]);
    expect([...toggleSelection(selected, 2)]).toEqual([]);
    expect([...toggleSelection(selected, 0)].sort()).toEqual([0, 2]);
  });
});

describe("command palette", () => {
  const hosts = [host("web-1"), host("db-1", { tags: ["postgres"] })];
  const layouts: Layout[] = [{ id: "L1", name: "research", tabs: [{ title: "t", root: { type: "terminal", host_id: "web-1" } }] }];
  const items = buildPaletteItems({ hosts, layouts });

  it("ranks substrings above scattered letters and rejects non-matches", () => {
    const sub = fuzzyScore("web", "Connect: web-1")!;
    const scattered = fuzzyScore("web", "wxexb")!;
    expect(fuzzyScore("web", "Whole entire bug")).toBeNull();
    expect(sub).toBeGreaterThan(scattered);
    expect(fuzzyScore("zzz", "web-1")).toBeNull();
    expect(fuzzyScore("", "anything")).toBe(0);
  });

  it("groups in section order and filters by every word", () => {
    const all = queryPalette(items, "", []);
    expect(all.groups.map((g) => g.section)).toEqual(["Hosts", "Layouts", "General", "Settings"]);
    const hit = queryPalette(items, "connect web", []);
    expect(hit.flat.every((i) => /web/i.test(i.title))).toBe(true);
    expect(hit.flat[0]!.title).toBe("Connect: web-1");
  });

  it("finds hosts by tag and shows recents first", () => {
    expect(queryPalette(items, "postgres", []).flat.map((i) => i.id)).toContain("connect:db-1");
    const withRecent = queryPalette(items, "", ["cmd:lock", "layout:L1"]);
    expect(withRecent.groups[0]!.section).toBe("Recent");
    expect(withRecent.groups[0]!.items.map((i) => i.title)).toEqual(["Lock vault", "Open layout: research"]);
    const ids = withRecent.flat.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("carries shortcut hints on commands", () => {
    const lock = items.find((i) => i.id === "cmd:lock")!;
    expect(lock.shortcut).toEqual(["Ctrl", "Shift", "L"]);
  });
});

describe("ClipboardCleaner", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function fakeClipboard(): ClipboardLike & { value: string } {
    const c = {
      value: "",
      async writeText(t: string) {
        c.value = t;
      },
      async readText() {
        return c.value;
      },
    };
    return c;
  }

  it("clears the clipboard after the delay when it still holds our text", async () => {
    const clip = fakeClipboard();
    await new ClipboardCleaner(clip).copy("secret", 30);
    expect(clip.value).toBe("secret");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(clip.value).toBe("");
  });

  it("leaves something the user copied since", async () => {
    const clip = fakeClipboard();
    await new ClipboardCleaner(clip).copy("secret", 30);
    clip.value = "other";
    await vi.advanceTimersByTimeAsync(30_000);
    expect(clip.value).toBe("other");
  });

  it("does not clear when the delay is zero", async () => {
    const clip = fakeClipboard();
    await new ClipboardCleaner(clip).copy("secret", 0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(clip.value).toBe("secret");
  });
});
