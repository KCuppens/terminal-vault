export interface Host {
  id: string;
  name: string;
  addr: string;
  port: number;
  user: string;
  key_id: string | null;
  tags: string[];
  /** tmux session every terminal on this host attaches to; null opens a plain shell. */
  tmux_session: string | null;
}

export type HostInput = Omit<Host, "id">;

export interface KeyInfo {
  id: string;
  name: string;
  public: string;
  fingerprint: string;
  /** "ed25519", "rsa-4096", ... */
  key_type: string;
}

export interface VaultInfo {
  path: string;
  /** Folder holding backups and exports. */
  dir: string;
}

export interface BackupInfo {
  /** File name inside the backups folder; pass to `vaultRestore`. */
  name: string;
  path: string;
  /** Unix milliseconds. */
  modified: number;
  bytes: number;
}

export interface Settings {
  /** Minutes idle before locking. 0 = never. 1..=240. Default 15. */
  auto_lock_minutes: number;
  /** Default true. */
  lock_on_minimize: boolean;
  /** Seconds before a copied public key is cleared from the clipboard. 0 = off. Default 30. */
  clipboard_clear_seconds: number;
  font_family: string;
  /** 8..=32. Default 14. */
  font_size: number;
  /** 100..=100000. Default 10000. */
  scrollback: number;
  cursor_style: "block" | "bar" | "underline";
  bell: "visual" | "sound" | "none";
  theme: "system" | "dark" | "light";
  /** Percent: 80..=150. Default 100. */
  ui_scale: number;
}

export type SplitDir = "H" | "V";

export type PaneNode =
  | { type: "terminal"; host_id: string }
  | { type: "split"; dir: SplitDir; ratio: number; a: PaneNode; b: PaneNode };

export interface Tab {
  title: string;
  root: PaneNode;
}

export interface Layout {
  id: string;
  name: string;
  tabs: Tab[];
}

export interface HostKeyPromptInfo {
  prompt_id: string;
  host_name: string;
  addr_port: string;
  key_type: string;
  fingerprint: string;
}

export interface SessionHandlers {
  data(bytes: Uint8Array): void;
  exit(code: number): void;
  error(message: string): void;
}

export type Unlisten = () => void;

export interface Ipc {
  vaultExists(): Promise<boolean>;
  /** Where the vault lives. Works while locked. */
  vaultInfo(): Promise<VaultInfo>;
  vaultCreate(passphrase: string): Promise<void>;
  /**
   * Rejects with "wrong passphrase", "vault file is corrupt: ...", or
   * "too many attempts: retry in <N>s" (N whole seconds) after repeated failures.
   */
  vaultUnlock(passphrase: string): Promise<void>;
  vaultLock(): Promise<void>;
  /** Verifies `current`, then re-encrypts under `next`. Takes a backup first. */
  vaultChangePassphrase(current: string, next: string): Promise<void>;
  /** Copies the vault file into the backups folder next to it. Returns the new backup. */
  vaultBackup(): Promise<BackupInfo>;
  /** Newest first. Works while locked. */
  vaultBackups(): Promise<BackupInfo[]>;
  /** Replaces the vault file with a backup (the current file is kept as its own backup). Locks. */
  vaultRestore(name: string): Promise<void>;
  /** Deletes the vault file and its backups, closes all sessions, locks. */
  vaultDelete(): Promise<void>;

  settingsGet(): Promise<Settings>;
  /** Rejects values outside the documented ranges. Works while locked. */
  settingsSave(settings: Settings): Promise<Settings>;

  /** Window chrome: the app draws its own title bar. */
  windowMinimize(): Promise<void>;
  windowToggleMaximize(): Promise<void>;
  windowClose(): Promise<void>;
  onWindowMinimized(cb: () => void): Promise<Unlisten>;

  hostsList(): Promise<Host[]>;
  hostsAdd(host: HostInput): Promise<Host>;
  hostsUpdate(host: Host): Promise<Host>;
  hostsRemove(id: string): Promise<void>;
  /** Writes hosts (no keys, no host-key pins) as JSON into the exports folder. Returns the file path. */
  hostsExport(): Promise<string>;
  /** Parses ~/.ssh/config. Returns candidates only; nothing is saved. Empty when the file is missing. */
  hostsImportSshConfig(): Promise<HostInput[]>;

  keysList(): Promise<KeyInfo[]>;
  /** `comment` defaults to the name. */
  keysGenerate(name: string, comment?: string): Promise<KeyInfo>;
  keysImport(name: string, privateKey: string, passphrase: string | null): Promise<KeyInfo>;
  /** Rejects with "key is used by N host(s)" while any host references it. */
  keysRemove(id: string): Promise<void>;

  layoutList(): Promise<Layout[]>;
  layoutSave(layout: Layout): Promise<Layout>;
  layoutRemove(id: string): Promise<void>;

  /**
   * Resolves once connected and authenticated; may wait on a host key prompt. `tmux`: omitted
   * uses the host's default session, "" opens a plain shell, otherwise that session name.
   */
  sessionOpen(hostId: string, cols: number, rows: number, tmux?: string): Promise<string>;
  /** Names of the tmux sessions running on the server (empty when none or tmux is missing). */
  tmuxSessions(hostId: string): Promise<string[]>;
  /** Starts event delivery. Register handlers with `onSession` first. */
  sessionAttach(id: string): Promise<void>;
  /** `dataB64` is base64 of the raw bytes to send. */
  sessionWrite(id: string, dataB64: string): Promise<void>;
  sessionResize(id: string, cols: number, rows: number): Promise<void>;
  sessionClose(id: string): Promise<void>;
  hostKeyConfirm(promptId: string, accept: boolean): Promise<void>;
  /** Drops the pinned key so the next connect asks again. A changed key is never accepted from a prompt. */
  hostKeyForget(hostId: string): Promise<void>;

  onSession(id: string, handlers: SessionHandlers): Promise<Unlisten>;
  onHostKeyPrompt(cb: (prompt: HostKeyPromptInfo) => void): Promise<Unlisten>;
  /** A prompt ended without an answer from the user (timed out or the vault was locked). */
  onHostKeyPromptClosed(cb: (promptId: string) => void): Promise<Unlisten>;
}
