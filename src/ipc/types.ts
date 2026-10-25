export interface Host {
  id: string;
  name: string;
  addr: string;
  port: number;
  user: string;
  key_id: string | null;
  tags: string[];
}

export type HostInput = Omit<Host, "id">;

export interface KeyInfo {
  id: string;
  name: string;
  public: string;
  fingerprint: string;
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
  /** Present when the server presented a different key than the one on record. */
  expected_fingerprint: string | null;
}

export interface SessionHandlers {
  data(bytes: Uint8Array): void;
  exit(code: number): void;
  error(message: string): void;
}

export type Unlisten = () => void;

export interface Ipc {
  vaultExists(): Promise<boolean>;
  vaultCreate(passphrase: string): Promise<void>;
  vaultUnlock(passphrase: string): Promise<void>;
  vaultLock(): Promise<void>;

  hostsList(): Promise<Host[]>;
  hostsAdd(host: HostInput): Promise<Host>;
  hostsUpdate(host: Host): Promise<Host>;
  hostsRemove(id: string): Promise<void>;

  keysList(): Promise<KeyInfo[]>;
  keysGenerate(name: string): Promise<KeyInfo>;
  keysImport(name: string, privateKey: string, passphrase: string | null): Promise<KeyInfo>;

  layoutList(): Promise<Layout[]>;
  layoutSave(layout: Layout): Promise<Layout>;
  layoutRemove(id: string): Promise<void>;

  /** Resolves once connected and authenticated; may wait on a host key prompt. */
  sessionOpen(hostId: string, cols: number, rows: number): Promise<string>;
  /** Starts event delivery. Register handlers with `onSession` first. */
  sessionAttach(id: string): Promise<void>;
  /** `dataB64` is base64 of the raw bytes to send. */
  sessionWrite(id: string, dataB64: string): Promise<void>;
  sessionResize(id: string, cols: number, rows: number): Promise<void>;
  sessionClose(id: string): Promise<void>;
  hostKeyConfirm(promptId: string, accept: boolean): Promise<void>;

  onSession(id: string, handlers: SessionHandlers): Promise<Unlisten>;
  onHostKeyPrompt(cb: (prompt: HostKeyPromptInfo) => void): Promise<Unlisten>;
}
