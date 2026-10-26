import { decodeBase64 } from "../lib/base64";
import { TMUX_NAME } from "../lib/tmuxName";
import type {
  BackupInfo,
  Host,
  HostInput,
  HostKeyPromptInfo,
  Ipc,
  KeyInfo,
  Layout,
  PaneNode,
  SessionHandlers,
  Settings,
} from "./types";

interface MockSession {
  hostId: string;
  cols: number;
  rows: number;
  attached: boolean;
  line: string;
  handlers: Set<SessionHandlers>;
  pending: Uint8Array[];
  prompt: string;
  dropAfterMs?: number;
}

export interface MockConnect {
  output?: string;
  prompt?: string;
  stall?: boolean;
  dropAfterMs?: number;
}

export interface MockOptions {
  trustAll?: boolean;
  settings?: Partial<Settings>;
  connect?(host: Host, tmux: string | null, nth: number): MockConnect | undefined;
}

const enc = new TextEncoder();

function randomB64(bytes: number): string {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...buf)).replace(/=+$/, "");
}

function paneHostIds(node: PaneNode, out: string[] = []): string[] {
  if (node.type === "terminal") out.push(node.host_id);
  else {
    paneHostIds(node.a, out);
    paneHostIds(node.b, out);
  }
  return out;
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

const MOCK_DIR = "/mock/terminal-vault";

const DEFAULT_SETTINGS: Settings = {
  auto_lock_minutes: 15,
  lock_on_minimize: true,
  clipboard_clear_seconds: 30,
  font_family: "JetBrains Mono",
  font_size: 14,
  scrollback: 10000,
  cursor_style: "block",
  bell: "visual",
  theme: "dark",
  ui_scale: 100,
};

interface MockBackup {
  seq: number;
  passphrase: string;
  hosts: Host[];
  keys: KeyInfo[];
  layouts: Layout[];
  info: BackupInfo;
}

function stamp(d: Date): string {
  return d.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
}

function checkRange(label: string, value: number, min: number, max: number) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
}

/** Same rules and messages as the Rust `Settings::validate`. */
function validateSettings(s: Settings) {
  if (s.auto_lock_minutes !== 0) checkRange("auto-lock minutes", s.auto_lock_minutes, 1, 240);
  checkRange("clipboard clear seconds", s.clipboard_clear_seconds, 0, 3600);
  checkRange("font size", s.font_size, 8, 32);
  checkRange("scrollback", s.scrollback, 100, 100000);
  checkRange("ui scale", s.ui_scale, 80, 150);
  const family = s.font_family.trim();
  if (family === "") throw new Error("font family must not be empty");
  if (family.length > 200 || /[\u0000-\u001f\u007f]/.test(family)) {
    throw new Error("font family must be plain text of at most 200 characters");
  }
  if (!["block", "bar", "underline"].includes(s.cursor_style)) throw new Error("unknown cursor style");
  if (!["visual", "sound", "none"].includes(s.bell)) throw new Error("unknown bell");
  if (!["system", "dark", "light"].includes(s.theme)) throw new Error("unknown theme");
}

/** In-memory stand-in for the Rust backend; behaves like it, including validation errors. */
export function createMockIpc(options: MockOptions = {}): Ipc {
  const opened = new Map<string, number>();
  let passphrase: string | null = null;
  let unlocked = false;
  let hosts: Host[] = [];
  let keys: KeyInfo[] = [];
  let layouts: Layout[] = [];
  const trusted = new Set<string>();
  const tmuxSessions = new Map<string, Set<string>>();
  const sessions = new Map<string, MockSession>();
  const promptListeners = new Set<(p: HostKeyPromptInfo) => void>();
  const closedListeners = new Set<(promptId: string) => void>();
  const prompts = new Map<string, (accept: boolean) => void>();
  let settings: Settings = { ...DEFAULT_SETTINGS, ...options.settings };
  let failures = 0;
  let blockedUntil = 0;
  const backups = new Map<string, MockBackup>();
  let backupSeq = 0;

  const requireUnlocked = () => {
    if (!unlocked) throw new Error("vault is locked");
  };

  const validateHost = (h: HostInput, selfId?: string) => {
    if (h.name.trim() === "") throw new Error("name must not be empty");
    if (h.addr.trim() === "") throw new Error("address must not be empty");
    if (h.user.trim() === "") throw new Error("user must not be empty");
    if (h.port === 0) throw new Error("port must not be zero");
    if (hosts.some((x) => x.id !== selfId && sameName(x.name, h.name))) {
      throw new Error(`a host named "${h.name}" already exists`);
    }
    if (h.key_id !== null && !keys.some((k) => k.id === h.key_id)) throw new Error("unknown key");
    if (h.tmux_session !== null && !TMUX_NAME.test(h.tmux_session)) {
      throw new Error(`tmux session name "${h.tmux_session}" must be 1 to 64 letters, digits, '_' or '-'`);
    }
  };

  const emit = (s: MockSession, bytes: Uint8Array) => {
    if (!s.attached) s.pending.push(bytes);
    else s.handlers.forEach((h) => h.data(bytes));
  };
  const print = (s: MockSession, text: string) => emit(s, enc.encode(text));

  const runLine = (id: string, s: MockSession) => {
    const line = s.line.trim();
    s.line = "";
    if (line === "exit") {
      sessions.delete(id);
      s.handlers.forEach((h) => h.exit(0));
      return;
    }
    if (line.startsWith("echo ")) print(s, `\r\n${line.slice(5)}`);
    else if (line === "stty size") print(s, `\r\n${s.rows} ${s.cols}`);
    else if (line !== "") print(s, `\r\nmock: ${line}: command not found`);
    print(s, s.prompt);
  };

  const takeBackup = () => {
    const base = `vault-${stamp(new Date())}`;
    let name = `${base}.bak`;
    for (let n = 2; backups.has(name); n += 1) name = `${base}-${n}.bak`;
    backupSeq += 1;
    const entry: MockBackup = {
      seq: backupSeq,
      passphrase: passphrase ?? "",
      hosts: structuredClone(hosts),
      keys: structuredClone(keys),
      layouts: structuredClone(layouts),
      info: { name, path: `${MOCK_DIR}/backups/${name}`, modified: Date.now(), bytes: 4096 + hosts.length * 120 },
    };
    backups.set(name, entry);
    return entry;
  };

  return {
    async vaultExists() {
      return passphrase !== null;
    },
    async vaultInfo() {
      return { path: `${MOCK_DIR}/vault.tv`, dir: MOCK_DIR };
    },
    async vaultCreate(p) {
      if (passphrase !== null) throw new Error("a vault already exists");
      if (p === "") throw new Error("passphrase must not be empty");
      passphrase = p;
      unlocked = true;
    },
    async vaultUnlock(p) {
      if (passphrase === null) throw new Error("no vault found");
      const wait = Math.ceil((blockedUntil - Date.now()) / 1000);
      if (wait > 0) throw new Error(`too many attempts: retry in ${wait}s`);
      if (p !== passphrase) {
        failures += 1;
        if (failures >= 3) {
          blockedUntil = Date.now() + Math.min(5 * 2 ** (failures - 3), 60) * 1000;
        }
        throw new Error("wrong passphrase");
      }
      failures = 0;
      blockedUntil = 0;
      unlocked = true;
    },
    async vaultLock() {
      unlocked = false;
      for (const id of [...sessions.keys()]) await this.sessionClose(id);
    },
    async vaultChangePassphrase(current, next) {
      requireUnlocked();
      if (current !== passphrase) throw new Error("wrong passphrase");
      if (next === "") throw new Error("passphrase must not be empty");
      takeBackup();
      passphrase = next;
    },
    async vaultBackup() {
      if (passphrase === null) throw new Error("the vault file does not exist");
      return takeBackup().info;
    },
    async vaultBackups() {
      return [...backups.values()].sort((a, b) => b.seq - a.seq).map((b) => ({ ...b.info }));
    },
    async vaultRestore(name) {
      const chosen = backups.get(name);
      if (!/^vault-[^/\\]+\.bak$/.test(name)) throw new Error("invalid backup name");
      if (!chosen) throw new Error(`backup "${name}" does not exist`);
      if (passphrase !== null) takeBackup();
      passphrase = chosen.passphrase;
      hosts = structuredClone(chosen.hosts);
      keys = structuredClone(chosen.keys);
      layouts = structuredClone(chosen.layouts);
      failures = 0;
      blockedUntil = 0;
      await this.vaultLock();
    },
    async vaultDelete() {
      await this.vaultLock();
      passphrase = null;
      hosts = [];
      keys = [];
      layouts = [];
      backups.clear();
      failures = 0;
      blockedUntil = 0;
    },

    async settingsGet() {
      return { ...settings };
    },
    async settingsSave(next) {
      validateSettings(next);
      settings = { ...next };
      return { ...settings };
    },

    async windowMinimize() {},
    async windowToggleMaximize() {},
    async windowClose() {},

    async hostsList() {
      requireUnlocked();
      return structuredClone(hosts);
    },
    async hostsAdd(input) {
      requireUnlocked();
      validateHost(input);
      const host: Host = { ...input, id: crypto.randomUUID() };
      hosts.push(host);
      return structuredClone(host);
    },
    async hostsUpdate(host) {
      requireUnlocked();
      if (!hosts.some((h) => h.id === host.id)) throw new Error("unknown host");
      validateHost(host, host.id);
      hosts = hosts.map((h) => (h.id === host.id ? structuredClone(host) : h));
      return structuredClone(host);
    },
    async hostsRemove(id) {
      requireUnlocked();
      const layout = layouts.find((l) => l.tabs.some((t) => paneHostIds(t.root).includes(id)));
      if (layout) throw new Error(`host is used by layout "${layout.name}"`);
      if (!hosts.some((h) => h.id === id)) throw new Error("unknown host");
      hosts = hosts.filter((h) => h.id !== id);
    },

    async hostsExport() {
      requireUnlocked();
      return `${MOCK_DIR}/exports/hosts-${stamp(new Date())}.json`;
    },
    async hostsImportSshConfig() {
      requireUnlocked();
      return [
        { name: "staging", addr: "staging.example.com", port: 22, user: "deploy", key_id: null, tags: [], tmux_session: null },
        { name: "build", addr: "10.1.2.3", port: 2222, user: "ci", key_id: null, tags: [], tmux_session: null },
      ];
    },

    async keysList() {
      requireUnlocked();
      return structuredClone(keys);
    },
    async keysGenerate(name, comment) {
      requireUnlocked();
      if (name.trim() === "") throw new Error("name must not be empty");
      const info: KeyInfo = {
        id: crypto.randomUUID(),
        name,
        public: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI${randomB64(32)} ${comment ?? name}`,
        fingerprint: `SHA256:${randomB64(32)}`,
        key_type: "ed25519",
      };
      keys.push(info);
      return structuredClone(info);
    },
    async keysImport(name, privateKey, keyPassphrase) {
      requireUnlocked();
      if (!privateKey.includes("PRIVATE KEY")) throw new Error("not a valid OpenSSH private key");
      if (privateKey.includes("ENCRYPTED") && !keyPassphrase) throw new Error("passphrase required");
      return this.keysGenerate(name);
    },
    async keysRemove(id) {
      requireUnlocked();
      if (!keys.some((k) => k.id === id)) throw new Error("unknown key");
      const used = hosts.filter((h) => h.key_id === id).length;
      if (used > 0) throw new Error(`key is used by ${used} ${used === 1 ? "host" : "hosts"}`);
      keys = keys.filter((k) => k.id !== id);
    },

    async layoutList() {
      requireUnlocked();
      return structuredClone(layouts);
    },
    async layoutSave(layout) {
      requireUnlocked();
      if (layout.name.trim() === "") throw new Error("name must not be empty");
      for (const t of layout.tabs) {
        for (const hostId of paneHostIds(t.root)) {
          if (!hosts.some((h) => h.id === hostId)) throw new Error("layout references an unknown host");
        }
      }
      const copy = structuredClone(layout);
      layouts = layouts.some((l) => l.id === copy.id)
        ? layouts.map((l) => (l.id === copy.id ? copy : l))
        : [...layouts, copy];
      return structuredClone(copy);
    },
    async layoutRemove(id) {
      requireUnlocked();
      if (!layouts.some((l) => l.id === id)) throw new Error("unknown layout");
      layouts = layouts.filter((l) => l.id !== id);
    },

    async sessionOpen(hostId, cols, rows, tmux) {
      requireUnlocked();
      const host = hosts.find((h) => h.id === hostId);
      if (!host) throw new Error("unknown host");
      if (host.key_id === null) throw new Error(`host "${host.name}" has no key assigned`);
      if (!options.trustAll && !trusted.has(hostId)) {
        const prompt_id = crypto.randomUUID();
        const decision = new Promise<boolean>((resolve) => prompts.set(prompt_id, resolve));
        const info: HostKeyPromptInfo = {
          prompt_id,
          host_name: host.name,
          addr_port: `${host.addr}:${host.port}`,
          key_type: "ssh-ed25519",
          fingerprint: `SHA256:${randomB64(32)}`,
        };
        promptListeners.forEach((l) => l(info));
        const accepted = await decision;
        if (!accepted) {
          closedListeners.forEach((l) => l(prompt_id));
          throw new Error("host key was not accepted");
        }
        trusted.add(hostId);
      }
      const wanted = tmux === undefined ? host.tmux_session : tmux === "" ? null : tmux;
      if (wanted !== null) {
        if (!TMUX_NAME.test(wanted)) throw new Error(`invalid tmux session name "${wanted}"`);
        tmuxSessions.set(hostId, new Set([...(tmuxSessions.get(hostId) ?? []), wanted]));
      }
      const nth = opened.get(hostId) ?? 0;
      opened.set(hostId, nth + 1);
      const hook = options.connect?.(host, wanted, nth);
      if (hook?.stall) return new Promise<string>(() => {});
      const id = crypto.randomUUID();
      sessions.set(id, {
        hostId,
        cols,
        rows,
        attached: false,
        line: "",
        handlers: new Set(),
        prompt: hook?.prompt ?? "\r\n$ ",
        dropAfterMs: hook?.dropAfterMs,
        pending: [
          enc.encode(
            hook?.output ??
              `Connected to ${host.user}@${host.addr} (mock${wanted === null ? "" : `, tmux ${wanted}`})\r\n$ `,
          ),
        ],
      });
      return id;
    },
    async tmuxSessions(hostId) {
      requireUnlocked();
      if (!hosts.some((h) => h.id === hostId)) throw new Error("unknown host");
      return [...(tmuxSessions.get(hostId) ?? [])].sort();
    },
    async sessionAttach(id) {
      const s = sessions.get(id);
      if (!s) throw new Error("unknown session");
      s.attached = true;
      const pending = s.pending.splice(0);
      pending.forEach((bytes) => s.handlers.forEach((h) => h.data(bytes)));
      if (s.dropAfterMs !== undefined) {
        const after = s.dropAfterMs;
        s.dropAfterMs = undefined;
        setTimeout(() => {
          if (sessions.get(id) !== s) return;
          sessions.delete(id);
          s.handlers.forEach((h) => h.error(""));
        }, after);
      }
    },
    async sessionWrite(id, dataB64) {
      const s = sessions.get(id);
      if (!s) throw new Error("unknown session");
      for (const ch of new TextDecoder().decode(decodeBase64(dataB64))) {
        if (ch === "\r") runLine(id, s);
        else if (ch === "\x7f") {
          if (s.line.length > 0) {
            s.line = s.line.slice(0, -1);
            print(s, "\b \b");
          }
        } else if (ch >= " ") {
          s.line += ch;
          print(s, ch);
        }
        if (!sessions.has(id)) return;
      }
    },
    async sessionResize(id, cols, rows) {
      const s = sessions.get(id);
      if (!s) throw new Error("unknown session");
      s.cols = cols;
      s.rows = rows;
    },
    async sessionClose(id) {
      sessions.delete(id);
    },
    async hostKeyConfirm(promptId, accept) {
      const resolve = prompts.get(promptId);
      if (!resolve) throw new Error("unknown prompt");
      prompts.delete(promptId);
      resolve(accept);
    },
    async hostKeyForget(hostId) {
      requireUnlocked();
      if (!hosts.some((h) => h.id === hostId)) throw new Error("unknown host");
      trusted.delete(hostId);
    },

    async onSession(id, handlers) {
      const s = sessions.get(id);
      if (!s) throw new Error("unknown session");
      s.handlers.add(handlers);
      return () => s.handlers.delete(handlers);
    },
    async onHostKeyPrompt(cb) {
      promptListeners.add(cb);
      return () => promptListeners.delete(cb);
    },
    async onHostKeyPromptClosed(cb) {
      closedListeners.add(cb);
      return () => closedListeners.delete(cb);
    },
    async onWindowMinimized() {
      return () => {};
    },
  };
}
