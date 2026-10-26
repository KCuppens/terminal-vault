import { afterEach, describe, expect, it } from "vitest";

import { encodeText } from "../lib/base64";
import { createMockIpc, getIpc, hasTauri, setIpc, type HostKeyPromptInfo, type Ipc } from "./index";

afterEach(() => setIpc(null));

async function unlocked(): Promise<Ipc> {
  const ipc = createMockIpc();
  await ipc.vaultCreate("correct horse battery");
  return ipc;
}

const hostInput = { name: "web", addr: "10.0.0.1", port: 22, user: "root", key_id: null, tags: ["prod"], tmux_session: null };

describe("ipc selection", () => {
  it("uses the mock outside Tauri and honours setIpc", async () => {
    expect(hasTauri()).toBe(false);
    const first = getIpc();
    expect(getIpc()).toBe(first);
    expect(await first.vaultExists()).toBe(false);
    const other = createMockIpc();
    setIpc(other);
    expect(getIpc()).toBe(other);
  });
});

describe("mock vault", () => {
  it("creates, locks and unlocks", async () => {
    const ipc = createMockIpc();
    await expect(ipc.hostsList()).rejects.toThrow("locked");
    await ipc.vaultCreate("pw");
    await expect(ipc.vaultCreate("pw")).rejects.toThrow("already exists");
    await ipc.vaultLock();
    await expect(ipc.hostsList()).rejects.toThrow("locked");
    await expect(ipc.vaultUnlock("nope")).rejects.toThrow("wrong passphrase");
    await ipc.vaultUnlock("pw");
    expect(await ipc.hostsList()).toEqual([]);
  });

  it("validates host CRUD like the core does", async () => {
    const ipc = await unlocked();
    const host = await ipc.hostsAdd(hostInput);
    expect(host.id).toBeTruthy();
    await expect(ipc.hostsAdd({ ...hostInput, name: " WEB " })).rejects.toThrow("already exists");
    await expect(ipc.hostsAdd({ ...hostInput, name: "x", port: 0 })).rejects.toThrow("port");
    await expect(ipc.hostsAdd({ ...hostInput, name: "y", key_id: "missing" })).rejects.toThrow("unknown key");
    const updated = await ipc.hostsUpdate({ ...host, addr: "10.0.0.2" });
    expect(updated.addr).toBe("10.0.0.2");
    expect((await ipc.hostsList())[0]?.addr).toBe("10.0.0.2");
    await ipc.hostsRemove(host.id);
    expect(await ipc.hostsList()).toEqual([]);
  });

  it("never exposes private key material", async () => {
    const ipc = await unlocked();
    const key = await ipc.keysGenerate("laptop");
    expect(Object.keys(key).sort()).toEqual(["fingerprint", "id", "key_type", "name", "public"]);
    await expect(ipc.keysImport("bad", "garbage", null)).rejects.toThrow("valid");
    await expect(
      ipc.keysImport("enc", "-----BEGIN ENCRYPTED PRIVATE KEY-----", null),
    ).rejects.toThrow("passphrase required");
    const imported = await ipc.keysImport("ok", "-----BEGIN OPENSSH PRIVATE KEY-----", null);
    expect(await ipc.keysList()).toHaveLength(2);
    expect(JSON.stringify(imported)).not.toContain("BEGIN");
  });

  it("stores layouts and refuses to orphan them", async () => {
    const ipc = await unlocked();
    const host = await ipc.hostsAdd(hostInput);
    const layout = { id: crypto.randomUUID(), name: "prod", tabs: [{ title: "t", root: { type: "terminal" as const, host_id: host.id } }] };
    await ipc.layoutSave(layout);
    await expect(ipc.hostsRemove(host.id)).rejects.toThrow("used by layout");
    await expect(
      ipc.layoutSave({ ...layout, id: crypto.randomUUID(), tabs: [{ title: "t", root: { type: "terminal", host_id: "nope" } }] }),
    ).rejects.toThrow("unknown host");
    await ipc.layoutRemove(layout.id);
    expect(await ipc.layoutList()).toEqual([]);
    await ipc.hostsRemove(host.id);
  });
});

describe("mock sessions", () => {
  async function connect(ipc: Ipc, accept = true) {
    const key = await ipc.keysGenerate("k");
    const host = await ipc.hostsAdd({ ...hostInput, key_id: key.id });
    let prompt: HostKeyPromptInfo | undefined;
    await ipc.onHostKeyPrompt((p) => {
      prompt = p;
      void ipc.hostKeyConfirm(p.prompt_id, accept);
    });
    return { host, opened: ipc.sessionOpen(host.id, 80, 24), getPrompt: () => prompt };
  }

  it("asks for the host key once, then trusts it", async () => {
    const ipc = await unlocked();
    const { host, opened, getPrompt } = await connect(ipc);
    await opened;
    expect(getPrompt()).toMatchObject({ host_name: "web" });
    await ipc.sessionOpen(host.id, 80, 24);
    expect(getPrompt()?.fingerprint).toBeTruthy();
  });

  it("rejects when the host key is declined", async () => {
    const ipc = await unlocked();
    const { opened } = await connect(ipc, false);
    await expect(opened).rejects.toThrow("not accepted");
  });

  it("buffers output until attach, then streams, echoes, resizes and exits", async () => {
    const ipc = await unlocked();
    const { opened } = await connect(ipc);
    const id = await opened;
    const chunks: Uint8Array[] = [];
    let exit: number | undefined;
    await ipc.onSession(id, {
      data: (b) => chunks.push(b),
      exit: (c) => (exit = c),
      error: () => {},
    });
    expect(chunks).toHaveLength(0);
    await ipc.sessionAttach(id);
    const text = () => new TextDecoder().decode(Uint8Array.from(chunks.flatMap((c) => [...c])));
    expect(text()).toContain("Connected to root@10.0.0.1");

    await ipc.sessionWrite(id, encodeText("echo hi\r"));
    expect(text()).toContain("\r\nhi\r\n$ ");
    await ipc.sessionResize(id, 100, 30);
    await ipc.sessionWrite(id, encodeText("stty size\r"));
    expect(text()).toContain("30 100");

    await ipc.sessionWrite(id, encodeText("exit\r"));
    expect(exit).toBe(0);
    await expect(ipc.sessionWrite(id, encodeText("x"))).rejects.toThrow("unknown session");
  });

  it("rejects hosts without a key and unknown sessions", async () => {
    const ipc = await unlocked();
    const host = await ipc.hostsAdd(hostInput);
    await expect(ipc.sessionOpen(host.id, 80, 24)).rejects.toThrow("no key");
    await expect(ipc.sessionAttach("nope")).rejects.toThrow("unknown session");
  });

  it("asks again after the host key is forgotten", async () => {
    const ipc = await unlocked();
    const key = await ipc.keysGenerate("k");
    const host = await ipc.hostsAdd({ ...hostInput, key_id: key.id });
    let asked = 0;
    await ipc.onHostKeyPrompt((p) => {
      asked += 1;
      void ipc.hostKeyConfirm(p.prompt_id, true);
    });
    await ipc.sessionOpen(host.id, 80, 24);
    await ipc.sessionOpen(host.id, 80, 24);
    expect(asked).toBe(1);
    await ipc.hostKeyForget(host.id);
    await ipc.sessionOpen(host.id, 80, 24);
    expect(asked).toBe(2);
  });

  it("tells listeners when a declined prompt is closed", async () => {
    const ipc = await unlocked();
    const key = await ipc.keysGenerate("k");
    const host = await ipc.hostsAdd({ ...hostInput, key_id: key.id });
    const closed: string[] = [];
    let shown: string | undefined;
    await ipc.onHostKeyPromptClosed((id) => closed.push(id));
    await ipc.onHostKeyPrompt((p) => {
      shown = p.prompt_id;
      void ipc.hostKeyConfirm(p.prompt_id, false);
    });
    await expect(ipc.sessionOpen(host.id, 80, 24)).rejects.toThrow("not accepted");
    expect(closed).toEqual([shown]);
  });

  it("applies a tmux override: empty is a plain shell, a name is listed for the host", async () => {
    const ipc = await unlocked();
    const key = await ipc.keysGenerate("k");
    const host = await ipc.hostsAdd({ ...hostInput, key_id: key.id, tmux_session: "main" });
    await ipc.onHostKeyPrompt((p) => void ipc.hostKeyConfirm(p.prompt_id, true));
    const text = async (id: string) => {
      const chunks: Uint8Array[] = [];
      await ipc.onSession(id, { data: (b) => chunks.push(b), exit: () => {}, error: () => {} });
      await ipc.sessionAttach(id);
      return new TextDecoder().decode(Uint8Array.from(chunks.flatMap((c) => [...c])));
    };
    expect(await text(await ipc.sessionOpen(host.id, 80, 24))).toContain("tmux main");
    expect(await text(await ipc.sessionOpen(host.id, 80, 24, ""))).not.toContain("tmux");
    await ipc.sessionOpen(host.id, 80, 24, "work");
    expect(await ipc.tmuxSessions(host.id)).toEqual(["main", "work"]);
    await expect(ipc.sessionOpen(host.id, 80, 24, "bad name")).rejects.toThrow("invalid tmux");
  });

  it("refuses an invalid default tmux name on save", async () => {
    const ipc = await unlocked();
    await expect(ipc.hostsAdd({ ...hostInput, tmux_session: "a b" })).rejects.toThrow("tmux");
  });
});

describe("mock settings", () => {
  it("returns defaults and rejects out-of-range values", async () => {
    const ipc = createMockIpc();
    const s = await ipc.settingsGet();
    expect(s.auto_lock_minutes).toBe(15);
    expect(await ipc.settingsSave({ ...s, font_size: 18 })).toMatchObject({ font_size: 18 });
    expect((await ipc.settingsGet()).font_size).toBe(18);
    await expect(ipc.settingsSave({ ...s, font_size: 7 })).rejects.toThrow("font size");
    await expect(ipc.settingsSave({ ...s, auto_lock_minutes: 241 })).rejects.toThrow("auto-lock");
    await expect(ipc.settingsSave({ ...s, scrollback: 99 })).rejects.toThrow("scrollback");
    await expect(ipc.settingsSave({ ...s, ui_scale: 200 })).rejects.toThrow("ui scale");
    await expect(ipc.settingsSave({ ...s, font_family: " " })).rejects.toThrow("font family");
    expect((await ipc.settingsGet()).font_size).toBe(18);
  });
});

describe("mock keys and hosts extras", () => {
  it("refuses to remove a key that hosts use", async () => {
    const ipc = await unlocked();
    const key = await ipc.keysGenerate("k", "me@laptop");
    expect(key.key_type).toBe("ed25519");
    expect(key.public).toContain("me@laptop");
    await ipc.hostsAdd({ ...hostInput, name: "a", key_id: key.id });
    await ipc.hostsAdd({ ...hostInput, name: "b", key_id: key.id });
    await expect(ipc.keysRemove(key.id)).rejects.toThrow("key is used by 2 hosts");
    const lone = await ipc.keysGenerate("lone");
    await ipc.keysRemove(lone.id);
    await expect(ipc.keysRemove(lone.id)).rejects.toThrow("unknown key");
  });

  it("exports hosts and offers ssh config candidates", async () => {
    const ipc = await unlocked();
    expect(await ipc.hostsExport()).toMatch(/exports\/hosts-\d{8}-\d{6}\.json$/);
    expect(await ipc.hostsImportSshConfig()).toHaveLength(2);
  });
});

describe("mock vault management", () => {
  it("throttles unlock after three wrong passphrases", async () => {
    const ipc = await unlocked();
    await ipc.vaultLock();
    for (let i = 0; i < 3; i += 1) {
      await expect(ipc.vaultUnlock("nope")).rejects.toThrow("wrong passphrase");
    }
    await expect(ipc.vaultUnlock("correct horse battery")).rejects.toThrow(/^too many attempts: retry in [1-5]s$/);
  });

  it("backs up, changes the passphrase and restores", async () => {
    const ipc = await unlocked();
    await ipc.hostsAdd(hostInput);
    const backup = await ipc.vaultBackup();
    expect(backup.name).toMatch(/^vault-.*\.bak$/);
    expect(backup.path).toContain("/backups/");
    await ipc.hostsRemove((await ipc.hostsList())[0]!.id);
    await ipc.vaultChangePassphrase("correct horse battery", "second");
    await expect(ipc.vaultChangePassphrase("bad", "x")).rejects.toThrow("wrong passphrase");
    expect((await ipc.vaultBackups()).length).toBeGreaterThanOrEqual(2);
    await ipc.vaultRestore(backup.name);
    await expect(ipc.hostsList()).rejects.toThrow("locked");
    await ipc.vaultUnlock("correct horse battery");
    expect(await ipc.hostsList()).toHaveLength(1);
    await expect(ipc.vaultRestore("vault-missing.bak")).rejects.toThrow("does not exist");
  });

  it("deletes the vault and reports its location while locked", async () => {
    const ipc = await unlocked();
    const info = await ipc.vaultInfo();
    expect(info.path.startsWith(info.dir)).toBe(true);
    await ipc.vaultDelete();
    expect(await ipc.vaultExists()).toBe(false);
    expect(await ipc.vaultBackups()).toEqual([]);
    await ipc.vaultCreate("fresh");
    expect(await ipc.hostsList()).toEqual([]);
  });
});
