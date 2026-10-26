import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { decodeBase64 } from "../lib/base64";
import type { HostKeyPromptInfo, Ipc, SessionHandlers, Unlisten } from "./types";

async function joinUnlisten(pending: Promise<UnlistenFn>[]): Promise<Unlisten> {
  const fns = await Promise.all(pending);
  return () => fns.forEach((fn) => fn());
}

export const tauriIpc: Ipc = {
  vaultExists: () => invoke("vault_exists"),
  vaultInfo: () => invoke("vault_info"),
  vaultCreate: (passphrase) => invoke("vault_create", { passphrase }),
  vaultUnlock: (passphrase) => invoke("vault_unlock", { passphrase }),
  vaultLock: () => invoke("vault_lock"),
  vaultChangePassphrase: (current, next) => invoke("vault_change_passphrase", { current, next }),
  vaultBackup: () => invoke("vault_backup"),
  vaultBackups: () => invoke("vault_backups"),
  vaultRestore: (name) => invoke("vault_restore", { name }),
  vaultDelete: () => invoke("vault_delete"),

  settingsGet: () => invoke("settings_get"),
  settingsSave: (settings) => invoke("settings_save", { settings }),

  windowMinimize: () => getCurrentWindow().minimize(),
  windowToggleMaximize: () => getCurrentWindow().toggleMaximize(),
  windowClose: () => getCurrentWindow().close(),

  hostsList: () => invoke("hosts_list"),
  hostsAdd: (host) => invoke("hosts_add", { host }),
  hostsUpdate: (host) => invoke("hosts_update", { host }),
  hostsRemove: (id) => invoke("hosts_remove", { id }),

  hostsExport: () => invoke("hosts_export"),
  hostsImportSshConfig: () => invoke("hosts_import_ssh_config"),

  keysList: () => invoke("keys_list"),
  keysGenerate: (name, comment) => invoke("keys_generate", { name, comment: comment ?? null }),
  keysRemove: (id) => invoke("keys_remove", { id }),
  keysImport: (name, privateKey, passphrase) =>
    invoke("keys_import", { name, privateKey, passphrase }),

  layoutList: () => invoke("layout_list"),
  layoutSave: (layout) => invoke("layout_save", { layout }),
  layoutRemove: (id) => invoke("layout_remove", { id }),

  sessionOpen: (hostId, cols, rows, tmux) => invoke("session_open", { hostId, cols, rows, tmux: tmux ?? null }),
  tmuxSessions: (hostId) => invoke("tmux_sessions", { hostId }),
  sessionAttach: (id) => invoke("session_attach", { id }),
  sessionWrite: (id, dataB64) => invoke("session_write", { id, dataB64 }),
  sessionResize: (id, cols, rows) => invoke("session_resize", { id, cols, rows }),
  sessionClose: (id) => invoke("session_close", { id }),
  hostKeyConfirm: (promptId, accept) => invoke("host_key_confirm", { promptId, accept }),
  hostKeyForget: (hostId) => invoke("host_key_forget", { hostId }),

  onSession(id: string, h: SessionHandlers) {
    return joinUnlisten([
      listen<string>(`session://${id}/data`, (e) => h.data(decodeBase64(e.payload))),
      listen<number>(`session://${id}/exit`, (e) => h.exit(e.payload)),
      listen<string>(`session://${id}/error`, (e) => h.error(e.payload)),
    ]);
  },

  async onWindowMinimized(cb) {
    const win = getCurrentWindow();
    let minimized = await win.isMinimized();
    return win.onResized(async () => {
      const now = await win.isMinimized();
      if (now && !minimized) cb();
      minimized = now;
    });
  },

  onHostKeyPrompt(cb) {
    return joinUnlisten([listen<HostKeyPromptInfo>("hostkey://prompt", (e) => cb(e.payload))]);
  },

  onHostKeyPromptClosed(cb) {
    return joinUnlisten([listen<string>("hostkey://closed", (e) => cb(e.payload))]);
  },
};
