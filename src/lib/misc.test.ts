import { describe, expect, it } from "vitest";

import { matchShortcut, SHORTCUTS } from "./shortcuts";
import { acceptablePassphrase, passphraseStrength, SEGMENT_COUNT } from "./strength";

const key = (k: string, mods: Partial<Record<"ctrlKey" | "shiftKey" | "altKey" | "metaKey", boolean>> = {}) => ({
  key: k,
  ctrlKey: true,
  shiftKey: true,
  altKey: false,
  metaKey: false,
  ...mods,
});

describe("matchShortcut", () => {
  it("maps ctrl+shift combos", () => {
    expect(matchShortcut(key("T"))).toBe("newTab");
    expect(matchShortcut(key("D"))).toBe("splitRight");
    expect(matchShortcut(key("R"))).toBe("splitDown");
    expect(matchShortcut(key("W"))).toBe("closePane");
    expect(matchShortcut(key("F"))).toBe("find");
    expect(matchShortcut(key("l"))).toBe("lock");
    expect(matchShortcut(key("H"))).toBe("openHosts");
    expect(matchShortcut(key("K"))).toBe("openKeys");
    expect(matchShortcut(key("Y"))).toBe("openLayouts");
    expect(matchShortcut(key("S"))).toBe("saveLayout");
  });

  it("keeps plain ctrl+letter for the shell except ctrl+k and ctrl+comma", () => {
    expect(matchShortcut(key("k", { shiftKey: false }))).toBe("palette");
    expect(matchShortcut(key(",", { shiftKey: false }))).toBe("settings");
    for (const letter of ["t", "l", "n", "i", "d", "w", "r"]) {
      expect(matchShortcut(key(letter, { shiftKey: false }))).toBeNull();
    }
  });

  it("ignores everything else", () => {
    expect(matchShortcut(key("t", { ctrlKey: false }))).toBeNull();
    expect(matchShortcut(key("t", { metaKey: true }))).toBeNull();
    expect(matchShortcut(key("d", { altKey: true }))).toBeNull();
    expect(matchShortcut(key("k", { shiftKey: false, altKey: true }))).toBeNull();
    expect(matchShortcut(key("x"))).toBeNull();
  });

  it("has no two actions on the same keys", () => {
    const combos = SHORTCUTS.map((s) => s.keys.join("+"));
    expect(new Set(combos).size).toBe(combos.length);
  });
});

describe("passphraseStrength", () => {
  it("scores weak, mid and strong passphrases in order", () => {
    const weak = passphraseStrength("password");
    const mid = passphraseStrength("Tr0ub4dor&3");
    const strong = passphraseStrength("correct horse battery staple 42!");
    expect(weak.bits).toBeLessThan(mid.bits);
    expect(mid.bits).toBeLessThan(strong.bits);
    expect(strong.segments).toBe(SEGMENT_COUNT);
    expect(strong.tone).toBe("strong");
  });

  it("is empty for no input and penalises repetition", () => {
    expect(passphraseStrength("")).toEqual({ bits: 0, segments: 0, tone: "none", label: "" });
    const repeated = passphraseStrength("aaaaaaaaaaaaaaaaaaaa");
    expect(repeated.tone).toBe("weak");
    expect(repeated.segments).toBe(1);
  });

  it("labels with a rounded bit estimate", () => {
    expect(passphraseStrength("Tr0ub4dor&3").label).toMatch(/^Strong \(about \d+ bits\)$/);
  });

  it("requires at least eight characters", () => {
    expect(acceptablePassphrase("1234567")).toBe(false);
    expect(acceptablePassphrase("12345678")).toBe(true);
  });
});
