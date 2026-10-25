import { createMockIpc } from "./mock";
import { tauriIpc } from "./tauri";
import type { Ipc } from "./types";

export type * from "./types";
export { createMockIpc };

export function hasTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

let current: Ipc | null = null;

/** The real backend inside Tauri, an in-memory mock in a plain browser. */
export function getIpc(): Ipc {
  current ??= hasTauri() ? tauriIpc : createMockIpc();
  return current;
}

export function setIpc(impl: Ipc | null): void {
  current = impl;
}
