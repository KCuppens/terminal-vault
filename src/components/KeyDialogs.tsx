import { useState, type FormEvent } from "react";

import { getIpc, type Host, type KeyInfo } from "../ipc";
import { errorText } from "../lib/errors";
import { plural } from "../lib/format";
import { Modal } from "./Modal";
import { useServices } from "./services";
import { Callout, Icon, PasswordField, Segmented, Spinner } from "./ui";

export function GenerateKeyDialog({ onCreated, onClose }: { onCreated(key: KeyInfo): void; onClose(): void }) {
  const [name, setName] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setAttempted(true);
    if (name.trim() === "" || busy) return;
    setBusy(true);
    setError(null);
    try {
      const key = await getIpc().keysGenerate(name.trim(), comment.trim() === "" ? undefined : comment.trim());
      onCreated(key);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Generate SSH key"
      size="sm"
      className="kdlg"
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="generate-key" className="btn primary" disabled={busy}>
            {busy && <Spinner />}
            Generate key
          </button>
        </>
      }
    >
      <form id="generate-key" className="form" noValidate onSubmit={(e) => void submit(e)}>
        <div className="field">
          <label htmlFor="key-name">Name</label>
          <input
            id="key-name"
            className="input"
            placeholder="work-laptop"
            value={name}
            data-autofocus
            disabled={busy}
            aria-invalid={attempted && name.trim() === "" ? true : undefined}
            onChange={(e) => setName(e.target.value)}
          />
          <p className={attempted && name.trim() === "" ? "error-text" : "hint"}>
            {attempted && name.trim() === "" ? "Enter a name." : "A short name to identify this key."}
          </p>
        </div>
        <div className="field">
          <label htmlFor="key-type">Key type</label>
          <div className="kselect">
            <input id="key-type" className="input" value="Ed25519 — recommended" readOnly />
            <Icon name="chevronDown" size={16} />
          </div>
          <p className="hint">Fast, secure, and widely supported.</p>
        </div>
        <details className="kadv">
          <summary>Advanced options</summary>
          <p className="hint">Ed25519 is the only key type this app generates.</p>
        </details>
        <div className="field">
          <label htmlFor="key-comment">Comment (optional)</label>
          <input
            id="key-comment"
            className="input"
            value={comment}
            disabled={busy}
            onChange={(e) => setComment(e.target.value)}
          />
          <p className="hint">Shown in the public key.</p>
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

export function KeyCreatedDialog({ keyInfo, onClose }: { keyInfo: KeyInfo; onClose(): void }) {
  const { copy } = useServices();
  return (
    <Modal
      title="Key created"
      subtitle="Your SSH key has been generated."
      size="sm"
      className="kdlg kcreated"
      onClose={onClose}
      footer={
        <button type="button" className="btn primary wide" data-autofocus onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="field">
        <span className="label">Public key</span>
        <div className="code-box">
          <code>{keyInfo.public}</code>
          <button
            type="button"
            className="icon-btn"
            aria-label="Copy public key"
            onClick={() => void copy(keyInfo.public, { sensitive: true, label: "Public key copied." })}
          >
            <Icon name="copy" />
          </button>
        </div>
        <p className="hint">Add this to ~/.ssh/authorized_keys on your server.</p>
      </div>
      <Callout tone="info">
        Keep your private key safe. It is stored securely encrypted in this app and never shown here.
      </Callout>
    </Modal>
  );
}

type ImportSource = "paste" | "file";

export function ImportKeyDialog({ onImported, onClose }: { onImported(key: KeyInfo): void; onClose(): void }) {
  const [source, setSource] = useState<ImportSource>("paste");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [customName, setCustomName] = useState("");
  const [encrypted, setEncrypted] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  const needsPassphrase = encrypted && passphrase === "";
  const effectiveName = customName.trim() || (fileName ? fileName.replace(/\.[^.]*$/, "") : "");
  const missingName = effectiveName === "";
  const missingKey = text.trim() === "";
  async function loadFile(file: File | undefined) {
    if (!file) return;
    try {
      setText(await file.text());
      setFileName(file.name);
      setCustomName((curr) => curr || file.name.replace(/\.[^.]*$/, ""));
      setError(null);
    } catch (err) {
      setError(errorText(err));
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setAttempted(true);
    if (busy || missingKey || missingName || needsPassphrase) return;
    setBusy(true);
    setError(null);
    try {
      const key = await getIpc().keysImport(effectiveName, text, encrypted ? passphrase : null);
      onImported(key);
    } catch (err) {
      const message = errorText(err);
      if (/passphrase/i.test(message)) setEncrypted(true);
      setError(/needs a passphrase|encrypted/i.test(message) ? "This key needs a passphrase." : message);
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Import SSH key"
      size="sm"
      className="kdlg"
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="import-key" className="btn primary" disabled={busy || needsPassphrase || (attempted && missingName)}>
            {busy && <Spinner />}
            Import key
          </button>
        </>
      }
    >
      <form id="import-key" className="form" noValidate onSubmit={(e) => void submit(e)}>
        <div className="field">
          <label htmlFor="import-name" className="label">
            Key name
          </label>
          <input
            id="import-name"
            className="input"
            type="text"
            placeholder="e.g. production-bastion"
            value={customName}
            disabled={busy}
            aria-invalid={attempted && missingName ? true : undefined}
            onChange={(e) => setCustomName(e.target.value)}
          />
          {attempted && missingName && <p className="error-text">Add a key name.</p>}
        </div>
        <Segmented<ImportSource>
          label="Key source"
          value={source}
          onChange={setSource}
          options={[
            { value: "paste", label: "Paste key" },
            { value: "file", label: "Choose file" },
          ]}
        />
        {source === "paste" ? (
          <textarea
            id="import-text"
            className="input mono"
            rows={6}
            spellCheck={false}
            value={text}
            disabled={busy}
            aria-label="Private key"
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            aria-invalid={attempted && missingKey ? true : undefined}
            onChange={(e) => setText(e.target.value)}
          />
        ) : (
          <div className="field">
            <input id="import-file" className="input" type="file" aria-label="Private key file" disabled={busy} onChange={(e) => void loadFile(e.target.files?.[0])} />
            {fileName && <p className="hint">Loaded {fileName}.</p>}
          </div>
        )}
        {attempted && missingKey && <p className="error-text">Add the private key.</p>}
        <label className="check">
          <input type="checkbox" checked={encrypted} disabled={busy} onChange={(e) => setEncrypted(e.target.checked)} />
          This key is encrypted
        </label>
        {encrypted && (
          <PasswordField
            id="import-passphrase"
            label="Key passphrase"
            value={passphrase}
            onChange={setPassphrase}
            shown={shown}
            onToggleShown={() => setShown((s) => !s)}
            autoComplete="new-password"
            disabled={busy}
            invalid={needsPassphrase}
          />
        )}
        {needsPassphrase && (
          <p className="error-text kerr">
            <Icon name="warning" size={14} />
            This key needs a passphrase.
          </p>
        )}
        {error && !needsPassphrase && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

export function KeyBlockedDialog({
  hosts,
  onShowHosts,
  onClose,
}: {
  keyInfo: KeyInfo;
  hosts: Host[];
  onShowHosts(): void;
  onClose(): void;
}) {
  return (
    <Modal
      title="Delete key"
      size="sm"
      className="kdlg kblocked"
      icon={<span className="kb-icon"><Icon name="trash" size={22} /></span>}
      onClose={onClose}
      footer={
        <button type="button" className="btn wide" data-autofocus onClick={onClose}>
          Close
        </button>
      }
    >
      <p className="kb-lead">
        This key cannot be deleted because it is currently used by <strong>{plural(hosts.length, "host")}</strong>.
      </p>
      <div className="kb-box">
        <p className="kb-label">Used by these hosts:</p>
        <ul className="kb-list">
          {hosts.map((h) => (
            <li key={h.id}>
              <span className="hdot on" />
              <strong>{h.name}</strong>
              <span className="kb-addr">{`${h.user}@${h.addr}:${h.port}`}</span>
            </li>
          ))}
        </ul>
        <button type="button" className="obtn-o" onClick={onShowHosts}>
          Show hosts
        </button>
      </div>
    </Modal>
  );
}

export function KeyDetailsDialog({ keyInfo, hosts, onClose }: { keyInfo: KeyInfo; hosts: Host[]; onClose(): void }) {
  const { copy } = useServices();
  return (
    <Modal
      title={keyInfo.name}
      subtitle="Key details"
      onClose={onClose}
      footer={
        <button type="button" className="btn primary" data-autofocus onClick={onClose}>
          Close
        </button>
      }
    >
      <dl className="facts">
        <dt>Key type</dt>
        <dd>
          <span className="chip">{keyInfo.key_type}</span>
        </dd>
        <dt>SHA256 fingerprint</dt>
        <dd className="fingerprint">
          <code>{keyInfo.fingerprint}</code>
          <button type="button" className="icon-btn" aria-label="Copy fingerprint" onClick={() => void copy(keyInfo.fingerprint, { label: "Fingerprint copied." })}>
            <Icon name="copy" />
          </button>
        </dd>
        <dt>Public key</dt>
        <dd className="code-box">
          <code>{keyInfo.public}</code>
          <button type="button" className="icon-btn" aria-label="Copy public key" onClick={() => void copy(keyInfo.public, { sensitive: true, label: "Public key copied." })}>
            <Icon name="copy" />
          </button>
        </dd>
        <dt>Used by</dt>
        <dd>{hosts.length === 0 ? "No hosts" : hosts.map((h) => h.name).join(", ")}</dd>
      </dl>
    </Modal>
  );
}
