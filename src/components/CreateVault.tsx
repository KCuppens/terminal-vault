import { useId, useState, type FormEvent } from "react";

import { getIpc, type VaultInfo } from "../ipc";
import { errorText } from "../lib/errors";
import { acceptablePassphrase, passphraseStrength } from "../lib/strength";
import { AuthIcon } from "./authIcons";
import { AuthPassword, AuthStrength, Brand } from "./authParts";
import { useServices } from "./services";

interface Props {
  info: VaultInfo | null;
  onCreated(): void | Promise<void>;
}

export function CreateVault({ info, onCreated }: Props) {
  const { copy } = useServices();
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [shown, setShown] = useState(false);
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mismatchId = useId();
  const errorId = useId();

  const strength = passphraseStrength(pass);
  const longEnough = acceptablePassphrase(pass);
  const mismatch = confirm !== "" && confirm !== pass;
  const ready = longEnough && pass === confirm && understood;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await getIpc().vaultCreate(pass);
      setPass("");
      setConfirm("");
      await onCreated();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen av-screen">
      <form className="av-card av-create" onSubmit={(e) => void submit(e)} aria-busy={busy}>
        <Brand variant="row" />
        <div className="av-block">
          <AuthPassword
            id="create-pass"
            label="Create a vault passphrase"
            value={pass}
            onChange={setPass}
            shown={shown}
            onToggleShown={() => setShown((s) => !s)}
            autoComplete="new-password"
            autoFocus
            disabled={busy}
          />
          <AuthStrength strength={strength} />
        </div>
        <div className="av-block">
          <AuthPassword
            id="create-confirm"
            label="Confirm passphrase"
            value={confirm}
            onChange={setConfirm}
            shown={shown}
            onToggleShown={() => setShown((s) => !s)}
            autoComplete="new-password"
            invalid={mismatch}
            disabled={busy}
            describedBy={mismatch ? mismatchId : undefined}
          />
          {mismatch && (
            <p className="av-msg error" id={mismatchId} role="alert">
              Passphrases do not match.
            </p>
          )}
        </div>
        <div className="av-warn">
          <AuthIcon name="alertTriangle" size={26} className="av-warn-icon" />
          <p>There is no recovery. If you lose this passphrase, the vault is gone.</p>
        </div>
        <label className="av-check">
          <input type="checkbox" checked={understood} disabled={busy} onChange={(e) => setUnderstood(e.target.checked)} />
          I understand
        </label>
        {error && (
          <p className="av-msg error" id={errorId} role="alert">
            {error}
          </p>
        )}
        <button type="submit" className={busy ? "av-submit busy" : "av-submit"} disabled={!ready || busy}>
          {busy ? (
            <>
              <span className="av-spin" aria-hidden="true" /> Creating vault...
            </>
          ) : (
            "Create vault"
          )}
        </button>
        {info && (
          <div className="av-where">
            <AuthIcon name="folder" size={30} />
            <div className="av-where-text">
              <span>Vault file will be saved to</span>
              <code>{info.path}</code>
            </div>
            <button type="button" className="av-small" onClick={() => void copy(info.path, { label: "Path copied." })}>
              Copy
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
