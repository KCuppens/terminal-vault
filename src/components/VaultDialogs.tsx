import { useState, type FormEvent } from "react";

import { getIpc } from "../ipc";
import { errorText } from "../lib/errors";
import { classifyUnlockError } from "../lib/unlockError";
import { acceptablePassphrase, MIN_PASSPHRASE_LENGTH } from "../lib/strength";
import { Modal } from "./Modal";
import { useServices } from "./services";
import { Icon, PasswordField, Spinner } from "./ui";

export function ChangePassphraseDialog({ onClose }: { onClose(): void }) {
  const { toast } = useServices();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const tooShort = !acceptablePassphrase(next);
  const mismatch = confirm !== next;
  const sameAsCurrent = next !== "" && next === current;
  const invalid = current === "" || tooShort || mismatch || sameAsCurrent;
  const toggle = () => setShown((s) => !s);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setAttempted(true);
    if (invalid || busy) return;
    setBusy(true);
    setCurrentError(null);
    setError(null);
    try {
      await getIpc().vaultChangePassphrase(current, next);
      toast({ message: "Passphrase changed.", tone: "success" });
      onClose();
    } catch (err) {
      const message = errorText(err);
      if (classifyUnlockError(message).kind === "wrong") setCurrentError("Current passphrase is wrong.");
      else setError(message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Change passphrase"
      subtitle={busy ? undefined : "Re-encrypts your vault with a new passphrase."}
      size="sm"
      className="kdlg ksplit"
      onClose={busy ? () => undefined : onClose}
      hideClose={busy}
      footer={
        busy ? undefined : (
          <>
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" form="change-pass" className="btn primary">
              Change passphrase
            </button>
          </>
        )
      }
    >
      <form id="change-pass" className="form" noValidate onSubmit={(e) => void submit(e)} aria-busy={busy}>
        {busy ? (
          <div className="reenc" role="status">
            <span className="reenc-ring" />
            <p className="reenc-title">Re-encrypting vault...</p>
            <p className="reenc-sub">This may take a few seconds.</p>
            <div className="reenc-bar"><span /></div>
          </div>
        ) : (
          <>
            <div>
              <PasswordField
                id="cp-current"
                label="Current passphrase"
                value={current}
                onChange={setCurrent}
                shown={shown}
                onToggleShown={toggle}
                autoComplete="current-password"
                autoFocus
                invalid={currentError !== null || (attempted && current === "")}
              />
              {currentError && (
                <p className="error-text" role="alert">
                  {currentError}
                </p>
              )}
            </div>
            <div>
              <PasswordField
                id="cp-new"
                label="New passphrase"
                value={next}
                onChange={setNext}
                shown={shown}
                onToggleShown={toggle}
                autoComplete="new-password"
                invalid={attempted && (tooShort || sameAsCurrent)}
              />
              <p className="hint">Use at least {MIN_PASSPHRASE_LENGTH} characters.</p>
              {attempted && sameAsCurrent && <p className="error-text">The new passphrase matches the current one.</p>}
            </div>
            <div>
              <PasswordField
                id="cp-confirm"
                label="Confirm new passphrase"
                value={confirm}
                onChange={setConfirm}
                shown={shown}
                onToggleShown={toggle}
                autoComplete="new-password"
                invalid={confirm !== "" && mismatch}
              />
              {confirm !== "" && mismatch && <p className="error-text">Passphrases do not match.</p>}
            </div>
            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}
          </>
        )}
      </form>
    </Modal>
  );
}

export const VAULT_NAME = "terminal-vault";

export function DeleteVaultDialog({ onDeleted, onClose }: { onDeleted(): void; onClose(): void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim() === VAULT_NAME;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      await getIpc().vaultDelete();
      onDeleted();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Delete vault"
      size="sm"
      className="kdlg ksplit"
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="delete-vault" className="btn danger" disabled={!matches || busy}>
            {busy && <Spinner />}
            Delete vault
          </button>
        </>
      }
    >
      <form id="delete-vault" className="form" onSubmit={(e) => void submit(e)}>
        <div className="vd-warn" role="note">
          <Icon name="trash" size={24} />
          <div>
            <p>This will permanently delete your vault and all data (hosts, keys, layouts, settings).</p>
            <p className="vd-sub">This action cannot be undone.</p>
          </div>
        </div>
        <div className="field">
          <label htmlFor="delete-confirm">
            Type <code>{VAULT_NAME}</code> to confirm:
          </label>
          <input
            id="delete-confirm"
            data-autofocus
            className="input"
            value={typed}
            autoComplete="off"
            spellCheck={false}
            disabled={busy}
            onChange={(e) => setTyped(e.target.value)}
          />
        </div>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
