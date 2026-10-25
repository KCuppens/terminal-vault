import { afterEach, describe, expect, it } from "vitest";

import { encodeText } from "../lib/base64";
import { createMockIpc, getIpc, hasTauri, setIpc, type HostKeyPromptInfo, type Ipc } from "./index";

afterEach(() => setIpc(null));

async function unlocked(): Promise<Ipc> {
  const ipc = createMockIpc();
  await ipc.vaultCreate("correct horse battery");
  return ipc;
}

const hostInput = { name: "web", addr: "10.0.0.1", port: 22, user: "root", key_id: null, tags: ["prod"] };

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
    expect(Object.keys(key).sort()).toEqual(["fingerprint", "id", "name", "public"]);
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
    expect(getPrompt()).toMatchObject({ host_name: "web", expected_fingerprint: null });
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
});
