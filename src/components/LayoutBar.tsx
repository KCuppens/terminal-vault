import { useState, type FormEvent } from "react";

import type { Layout } from "../ipc";

interface Props {
  layouts: Layout[];
  onSave(name: string): Promise<void>;
  onOpen(layout: Layout): void;
  onRemove(layout: Layout): Promise<void>;
  error: string | null;
}

export function LayoutBar({ layouts, onSave, onOpen, onRemove, error }: Props) {
  const [name, setName] = useState("");
  const [selected, setSelected] = useState("");
  const current = layouts.find((l) => l.id === selected) ?? null;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (name.trim() === "") return;
    await onSave(name.trim());
    setName("");
  }

  return (
    <div className="layoutbar">
      <select value={selected} onChange={(e) => setSelected(e.target.value)} aria-label="Saved layouts">
        <option value="">Saved layouts…</option>
        {layouts.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      <button disabled={!current} onClick={() => current && onOpen(current)}>
        Open
      </button>
      <button disabled={!current} onClick={() => current && onRemove(current).then(() => setSelected(""))}>
        Delete
      </button>
      <form onSubmit={save} className="row">
        <input placeholder="Save arrangement as…" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit" disabled={name.trim() === ""}>
          Save
        </button>
      </form>
      {error && <span className="error">{error}</span>}
    </div>
  );
}
