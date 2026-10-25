import { useState, type FormEvent } from "react";

import { getIpc, type KeyInfo } from "../ipc";

interface Props {
  keys: KeyInfo[];
  onChanged(): void;
}

export function KeyManager({ keys, onChanged }: Props) {
  const [mode, setMode] = useState<"generate" | "import" | null>(null);
  const [name, setName] = useState("");
  const [pem, setPem] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  function reset() {
    setMode(null);
    setName("");
    setPem("");
    setPass("");
    setError(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const ipc = getIpc();
      if (mode === "import") await ipc.keysImport(name.trim(), pem, pass === "" ? null : pass);
      else await ipc.keysGenerate(name.trim());
      reset();
      onChanged();
    } catch (err) {
      setError(String(err));
    }
  }

  async function copy(key: KeyInfo) {
    await navigator.clipboard.writeText(key.public);
    setCopied(key.id);
    setTimeout(() => setCopied((c) => (c === key.id ? null : c)), 1500);
  }

  return (
    <section className="keys">
      <div className="row between">
        <h2>Keys</h2>
        <span className="row">
          <button onClick={() => setMode("generate")}>Generate</button>
          <button onClick={() => setMode("import")}>Import</button>
        </span>
      </div>
      {mode !== null && (
        <form onSubmit={submit} className="host-form">
          <label>
            Name
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          {mode === "import" && (
            <>
              <label>
                OpenSSH private key
                <textarea rows={5} value={pem} onChange={(e) => setPem(e.target.value)} spellCheck={false} />
              </label>
              <label>
                Key passphrase (if encrypted)
                <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} />
              </label>
              <small className="muted">The key is decrypted and stored inside the encrypted vault only.</small>
            </>
          )}
          {error && <p className="error">{error}</p>}
          <div className="row end">
            <button type="button" onClick={reset}>
              Cancel
            </button>
            <button className="primary" type="submit">
              {mode === "import" ? "Import" : "Generate ed25519"}
            </button>
          </div>
        </form>
      )}
      <ul>
        {keys.map((k) => (
          <li key={k.id}>
            <span className="host-main">
              <strong>{k.name}</strong>
              <small title={k.fingerprint}>{k.fingerprint}</small>
            </span>
            <button onClick={() => copy(k)} title="Copy public key">
              {copied === k.id ? "Copied" : "Copy pub"}
            </button>
          </li>
        ))}
        {keys.length === 0 && <li className="muted empty">No keys yet</li>}
      </ul>
    </section>
  );
}
