import { useMemo, useState } from "react";

import { getIpc, type Host, type KeyInfo } from "../ipc";
import { HostForm } from "./HostForm";

interface Props {
  hosts: Host[];
  keys: KeyInfo[];
  onChanged(): void;
  onConnect(host: Host): void;
}

export function HostList({ hosts, keys, onChanged, onConnect }: Props) {
  const [tag, setTag] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Host | "new" | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tags = useMemo(() => [...new Set(hosts.flatMap((h) => h.tags))].sort(), [hosts]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return hosts
      .filter((h) => tag === null || h.tags.includes(tag))
      .filter((h) => q === "" || `${h.name} ${h.addr} ${h.user}`.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [hosts, tag, query]);

  async function remove(host: Host) {
    try {
      await getIpc().hostsRemove(host.id);
      setConfirming(null);
      setError(null);
      onChanged();
    } catch (err) {
      setConfirming(null);
      setError(String(err));
    }
  }

  if (editing !== null) {
    return (
      <HostForm
        host={editing === "new" ? null : editing}
        keys={keys}
        onDone={() => {
          setEditing(null);
          onChanged();
        }}
      />
    );
  }

  return (
    <section className="host-list">
      <div className="row">
        <input
          className="grow"
          placeholder="Search hosts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="primary" onClick={() => setEditing("new")}>
          + Host
        </button>
      </div>
      {tags.length > 0 && (
        <div className="chips">
          <button className={tag === null ? "chip on" : "chip"} onClick={() => setTag(null)}>
            all
          </button>
          {tags.map((t) => (
            <button key={t} className={tag === t ? "chip on" : "chip"} onClick={() => setTag(t)}>
              {t}
            </button>
          ))}
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <ul>
        {visible.map((h) => (
          <li key={h.id}>
            <button className="host-main" onClick={() => onConnect(h)} title="Open in the focused pane">
              <strong>{h.name}</strong>
              <small>
                {h.user}@{h.addr}
                {h.port === 22 ? "" : `:${h.port}`}
              </small>
            </button>
            {confirming === h.id ? (
              <span className="row">
                <button className="danger" onClick={() => remove(h)}>
                  Delete
                </button>
                <button onClick={() => setConfirming(null)}>No</button>
              </span>
            ) : (
              <span className="row">
                <button title="Edit" onClick={() => setEditing(h)}>
                  ✎
                </button>
                <button title="Delete" onClick={() => setConfirming(h.id)}>
                  ✕
                </button>
              </span>
            )}
          </li>
        ))}
        {visible.length === 0 && <li className="muted empty">{hosts.length === 0 ? "No hosts yet" : "No matches"}</li>}
      </ul>
    </section>
  );
}
