import { useState, type FormEvent } from "react";

import { getIpc } from "../ipc";
import { passphraseStrength } from "../lib/strength";

interface Props {
  exists: boolean;
  onUnlocked(): void;
}

export function Unlock({ exists, onUnlocked }: Props) {
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const strength = passphraseStrength(pass);
  const creating = !exists;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (creating && pass !== confirm) {
      setError("Passphrases do not match");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const ipc = getIpc();
      if (creating) await ipc.vaultCreate(pass);
      else await ipc.vaultUnlock(pass);
      setPass("");
      setConfirm("");
      onUnlocked();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <form className="card unlock" onSubmit={submit}>
        <h1>Terminal Vault</h1>
        <p className="muted">
          {creating
            ? "Choose a passphrase to create your local encrypted vault. It cannot be recovered."
            : "Enter your passphrase to unlock the vault."}
        </p>
        <label>
          Passphrase
          <input
            type="password"
            autoFocus
            autoComplete={creating ? "new-password" : "current-password"}
            value={pass}
            onChange={(e) => setPass(e.target.value)}
          />
        </label>
        {creating && (
          <>
            <div className="strength" data-score={strength.score}>
              <div className="strength-bar">
                <span style={{ width: `${(strength.score + 1) * 20}%` }} />
              </div>
              <small>
                {pass === "" ? strength.hint : `${strength.label}. ${strength.hint}`}
              </small>
            </div>
            <label>
              Confirm passphrase
              <input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </label>
          </>
        )}
        {error && <p className="error">{error}</p>}
        <button className="primary" type="submit" disabled={busy || pass === ""}>
          {busy ? "Deriving key…" : creating ? "Create vault" : "Unlock"}
        </button>
      </form>
    </div>
  );
}
