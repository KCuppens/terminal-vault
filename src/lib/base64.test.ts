import { describe, expect, it } from "vitest";

import { decodeBase64, encodeBase64, encodeBinaryString, encodeText } from "./base64";

describe("base64", () => {
  it("decodes event chunks to raw bytes", () => {
    expect(decodeBase64("aGVsbG8=")).toEqual(new TextEncoder().encode("hello"));
    expect(decodeBase64("")).toEqual(new Uint8Array());
  });

  it("roundtrips every byte value and chunks larger than the encode step", () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect(decodeBase64(encodeBase64(all))).toEqual(all);
    const big = new Uint8Array(70_000).map((_, i) => i % 251);
    expect(decodeBase64(encodeBase64(big))).toEqual(big);
  });

  it("keeps utf-8 text and raw binary input intact", () => {
    expect(new TextDecoder().decode(decodeBase64(encodeText("ключ 🔑")))).toBe("ключ 🔑");
    expect(decodeBase64(encodeBinaryString("\x00\x9b\xff"))).toEqual(Uint8Array.from([0, 0x9b, 0xff]));
  });
});
