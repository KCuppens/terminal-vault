import { useEffect, useMemo, useState } from "react";

import { getIpc, type Host, type KeyInfo } from "../ipc";
import { errorText } from "../lib/errors";
import { plural } from "../lib/format";
import { hostAddress } from "../lib/hostMeta";
import { defaultSelection, markCandidates, toggleSelection, type ImportCandidate } from "../lib/sshConfig";
import { Modal } from "./Modal";
import { Callout, Spinner } from "./ui";

interface Props {
  hosts: Host[];
  keys: KeyInfo[];
  onImported(count: number): Promise<void>;
  onClose(): void;
}

export function ImportSshConfig({ hosts, keys, onImported, onClose }: Props) {
  const [candidates, setCandidates] = useState<ImportCandidate[] | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [keyId, setKeyId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getIpc()
      .hostsImportSshConfig()
      .then((found) => {
        if (!live) return;
        const marked = markCandidates(found, hosts);
        setCandidates(marked);
        setSelected(defaultSelection(marked));
      })
      .catch((err) => {
        if (!live) return;
        setCandidates([]);
        setError(errorText(err));
      });
    return () => {
      live = false;
    };
  }, []);

  const duplicates = useMemo(() => candidates?.filter((c) => c.duplicate).length ?? 0, [candidates]);

  async function run() {
    if (!candidates || busy || selected.size === 0) return;
    setBusy(true);
    setError(null);
    let added = 0;
    try {
      for (const [i, c] of candidates.entries()) {
        if (!selected.has(i)) continue;
        await getIpc().hostsAdd({ ...c.input, key_id: keyId === "" ? c.input.key_id : keyId });
        added += 1;
      }
      await onImported(added);
      onClose();
    } catch (err) {
      await onImported(added);
      setError(`${errorText(err)} (${plural(added, "host")} imported before the error.)`);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Import from ~/.ssh/config"
      size="lg"
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={busy || selected.size === 0}
            onClick={() => void run()}
          >
            {busy && <Spinner />}
            {selected.size === 0 ? "Import" : `Import ${plural(selected.size, "host")}`}
          </button>
        </>
      }
    >
      {candidates === null ? (
        <div className="loading-block" role="status">
          <Spinner />
          <p>Reading ~/.ssh/config...</p>
        </div>
      ) : candidates.length === 0 ? (
        <p className="muted">No hosts found in ~/.ssh/config.</p>
      ) : (
        <>
          {duplicates > 0 && (
            <Callout tone="info">
              {plural(duplicates, "host")} already in your vault{duplicates === 1 ? " is" : " are"} unchecked.
            </Callout>
          )}
          <ul className="import-list">
            {candidates.map((c, i) => (
              <li key={`${c.input.name}-${i}`}>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={selected.has(i)}
                    disabled={busy}
                    onChange={() => setSelected((s) => toggleSelection(s, i))}
                  />
                  <span className="import-name">{c.input.name}</span>
                  <span className="muted">{hostAddress(c.input)}</span>
                  {c.duplicate && <span className="chip">Already added</span>}
                </label>
              </li>
            ))}
          </ul>
          <div className="field">
            <label htmlFor="import-key">Assign key</label>
            <select id="import-key" className="input" value={keyId} disabled={busy} onChange={(e) => setKeyId(e.target.value)}>
              <option value="">Keep as imported (no key)</option>
              {keys.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
            <p className="hint">Applied to every imported host. You can change it later.</p>
          </div>
        </>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
