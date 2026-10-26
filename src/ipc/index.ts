import { demoScene, sceneOptions, seedDemo } from "./demo";
import { createMockIpc } from "./mock";
import { tauriIpc } from "./tauri";
import type { Ipc } from "./types";

export type * from "./types";
export { createMockIpc, demoScene };

export function hasTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

let current: Ipc | null = null;

/** The real backend inside Tauri, an in-memory mock in a plain browser. */
export function getIpc(): Ipc {
  if (current === null) {
    if (hasTauri()) current = tauriIpc;
    else {
      const demo = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("demo");
      const scene = demo ? demoScene() : null;
      const mock = createMockIpc(sceneOptions(scene));
      current = mock;
      if (demo) {
        const ready = seedDemo(mock, scene);
        const exists = mock.vaultExists.bind(mock);
        mock.vaultExists = async () => {
          await ready;
          return exists();
        };
        mock.vaultInfo = async () => {
          await ready;
          return mock.vaultInfo();
        };
      }
    }
  }
  return current;
}

export function setIpc(impl: Ipc | null): void {
  current = impl;
}
