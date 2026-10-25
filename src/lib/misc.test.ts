import { describe, expect, it } from "vitest";

import { matchShortcut } from "./shortcuts";
import { passphraseStrength } from "./strength";

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
    expect(matchShortcut(key("d", { altKey: true }))).toBe("splitDown");
    expect(matchShortcut(key("W"))).toBe("closePane");
  });

  it("ignores everything else", () => {
    expect(matchShortcut(key("t", { shiftKey: false }))).toBeNull();
    expect(matchShortcut(key("t", { ctrlKey: false }))).toBeNull();
    expect(matchShortcut(key("t", { metaKey: true }))).toBeNull();
    expect(matchShortcut(key("x"))).toBeNull();
  });
});

describe("passphraseStrength", () => {
  it("scores weak, mid and strong passphrases in order", () => {
    const weak = passphraseStrength("password");
    const mid = passphraseStrength("Tr0ub4dor&3");
    const strong = passphraseStrength("correct horse battery staple 42!");
    expect(weak.score).toBeLessThan(mid.score);
    expect(mid.score).toBeLessThan(strong.score);
    expect(strong.score).toBeGreaterThanOrEqual(3);
  });

  it("handles empty input and penalises repetition", () => {
    expect(passphraseStrength("").score).toBe(0);
    expect(passphraseStrength("aaaaaaaaaaaaaaaaaaaa").score).toBeLessThan(2);
  });
});
