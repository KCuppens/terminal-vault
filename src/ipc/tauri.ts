import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { decodeBase64 } from "../lib/base64";
import type { HostKeyPromptInfo, Ipc, SessionHandlers, Unlisten } from "./types";

async function joinUnlisten(pending: Promise<UnlistenFn>[]): Promise<Unlisten> {
  const fns = await Promise.all(pending);
  return () => fns.forEach((fn) => fn());
}

export const tauriIpc: Ipc = {
  vaultExists: () => invoke("vault_exists"),
  vaultCreate: (passphrase) => invoke("vault_create", { passphrase }),
  vaultUnlock: (passphrase) => invoke("vault_unlock", { passphrase }),
  vaultLock: () => invoke("vault_lock"),

  hostsList: () => invoke("hosts_list"),
  hostsAdd: (host) => invoke("hosts_add", { host }),
  hostsUpdate: (host) => invoke("hosts_update", { host }),
  hostsRemove: (id) => invoke("hosts_remove", { id }),

  keysList: () => invoke("keys_list"),
  keysGenerate: (name) => invoke("keys_generate", { name }),
  keysImport: (name, privateKey, passphrase) =>
    invoke("keys_import", { name, privateKey, passphrase }),

  layoutList: () => invoke("layout_list"),
  layoutSave: (layout) => invoke("layout_save", { layout }),
  layoutRemove: (id) => invoke("layout_remove", { id }),

  sessionOpen: (hostId, cols, rows) => invoke("session_open", { hostId, cols, rows }),
  sessionAttach: (id) => invoke("session_attach", { id }),
  sessionWrite: (id, dataB64) => invoke("session_write", { id, dataB64 }),
  sessionResize: (id, cols, rows) => invoke("session_resize", { id, cols, rows }),
  sessionClose: (id) => invoke("session_close", { id }),
  hostKeyConfirm: (promptId, accept) => invoke("host_key_confirm", { promptId, accept }),

  onSession(id: string, h: SessionHandlers) {
    return joinUnlisten([
      listen<string>(`session://${id}/data`, (e) => h.data(decodeBase64(e.payload))),
      listen<number>(`session://${id}/exit`, (e) => h.exit(e.payload)),
      listen<string>(`session://${id}/error`, (e) => h.error(e.payload)),
    ]);
  },

  onHostKeyPrompt(cb) {
    return joinUnlisten([listen<HostKeyPromptInfo>("hostkey://prompt", (e) => cb(e.payload))]);
  },
};
