import { decodeBase64 } from "../lib/base64";
import type {
  Host,
  HostInput,
  HostKeyPromptInfo,
  Ipc,
  KeyInfo,
  Layout,
  PaneNode,
  SessionHandlers,
} from "./types";

interface MockSession {
  hostId: string;
  cols: number;
  rows: number;
  attached: boolean;
  line: string;
  handlers: Set<SessionHandlers>;
  pending: Uint8Array[];
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

/** In-memory stand-in for the Rust backend; behaves like it, including validation errors. */
export function createMockIpc(): Ipc {
  let passphrase: string | null = null;
  let unlocked = false;
  let hosts: Host[] = [];
  let keys: KeyInfo[] = [];
  let layouts: Layout[] = [];
  const trusted = new Set<string>();
  const sessions = new Map<string, MockSession>();
  const promptListeners = new Set<(p: HostKeyPromptInfo) => void>();
  const prompts = new Map<string, (accept: boolean) => void>();

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
    print(s, "\r\n$ ");
  };

  return {
    async vaultExists() {
      return passphrase !== null;
    },
    async vaultCreate(p) {
      if (passphrase !== null) throw new Error("a vault already exists");
      if (p === "") throw new Error("passphrase must not be empty");
      passphrase = p;
      unlocked = true;
    },
    async vaultUnlock(p) {
      if (passphrase === null) throw new Error("no vault found");
      if (p !== passphrase) throw new Error("wrong passphrase");
      unlocked = true;
    },
    async vaultLock() {
      unlocked = false;
      for (const id of [...sessions.keys()]) await this.sessionClose(id);
    },

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

    async keysList() {
      requireUnlocked();
      return structuredClone(keys);
    },
    async keysGenerate(name) {
      requireUnlocked();
      if (name.trim() === "") throw new Error("name must not be empty");
      const info: KeyInfo = {
        id: crypto.randomUUID(),
        name,
        public: `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI${randomB64(32)} ${name}`,
        fingerprint: `SHA256:${randomB64(32)}`,
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

    async sessionOpen(hostId, cols, rows) {
      requireUnlocked();
      const host = hosts.find((h) => h.id === hostId);
      if (!host) throw new Error("unknown host");
      if (host.key_id === null) throw new Error(`host "${host.name}" has no key assigned`);
      if (!trusted.has(hostId)) {
        const prompt_id = crypto.randomUUID();
        const decision = new Promise<boolean>((resolve) => prompts.set(prompt_id, resolve));
        const info: HostKeyPromptInfo = {
          prompt_id,
          host_name: host.name,
          addr_port: `${host.addr}:${host.port}`,
          key_type: "ssh-ed25519",
          fingerprint: `SHA256:${randomB64(32)}`,
          expected_fingerprint: null,
        };
        promptListeners.forEach((l) => l(info));
        if (!(await decision)) throw new Error("host key was not accepted");
        trusted.add(hostId);
      }
      const id = crypto.randomUUID();
      sessions.set(id, {
        hostId,
        cols,
        rows,
        attached: false,
        line: "",
        handlers: new Set(),
        pending: [enc.encode(`Connected to ${host.user}@${host.addr} (mock)\r\n$ `)],
      });
      return id;
    },
    async sessionAttach(id) {
      const s = sessions.get(id);
      if (!s) throw new Error("unknown session");
      s.attached = true;
      const pending = s.pending.splice(0);
      pending.forEach((bytes) => s.handlers.forEach((h) => h.data(bytes)));
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
  };
}
