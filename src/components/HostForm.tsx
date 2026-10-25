import { useState, type FormEvent } from "react";

import { getIpc, type Host, type KeyInfo } from "../ipc";

interface Props {
  host: Host | null;
  keys: KeyInfo[];
  onDone(): void;
}

export function HostForm({ host, keys, onDone }: Props) {
  const [name, setName] = useState(host?.name ?? "");
  const [addr, setAddr] = useState(host?.addr ?? "");
  const [port, setPort] = useState(String(host?.port ?? 22));
  const [user, setUser] = useState(host?.user ?? "");
  const [keyId, setKeyId] = useState(host?.key_id ?? keys[0]?.id ?? "");
  const [tags, setTags] = useState(host?.tags.join(", ") ?? "");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const portNum = Number(port);
    if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
      setError("Port must be between 1 and 65535");
      return;
    }
    const fields = {
      name: name.trim(),
      addr: addr.trim(),
      port: portNum,
      user: user.trim(),
      key_id: keyId === "" ? null : keyId,
      tags: [...new Set(tags.split(",").map((t) => t.trim()).filter((t) => t !== ""))],
    };
    try {
      const ipc = getIpc();
      if (host) await ipc.hostsUpdate({ ...fields, id: host.id });
      else await ipc.hostsAdd(fields);
      onDone();
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <form className="host-form" onSubmit={submit}>
      <label>
        Name
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="row">
        <label className="grow">
          Address
          <input value={addr} onChange={(e) => setAddr(e.target.value)} />
        </label>
        <label className="port">
          Port
          <input inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} />
        </label>
      </div>
      <label>
        User
        <input value={user} onChange={(e) => setUser(e.target.value)} />
      </label>
      <label>
        Key
        <select value={keyId} onChange={(e) => setKeyId(e.target.value)}>
          <option value="">No key (cannot connect)</option>
          {keys.map((k) => (
            <option key={k.id} value={k.id}>
              {k.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Tags (comma separated)
        <input value={tags} onChange={(e) => setTags(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <div className="row end">
        <button type="button" onClick={onDone}>
          Cancel
        </button>
        <button className="primary" type="submit">
          {host ? "Save" : "Add host"}
        </button>
      </div>
    </form>
  );
}
