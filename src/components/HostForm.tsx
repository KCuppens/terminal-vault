import { cloneElement, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";

import { getIpc, type Host, type HostInput, type KeyInfo } from "../ipc";
import { errorText } from "../lib/errors";
import { TMUX_NAME } from "../lib/tmuxName";
import { Modal } from "./Modal";
import { Icon, Spinner } from "./ui";
import { InfoBadge, WarnBadge } from "./badgeIcons";

interface Props {
  host: Host | null;
  keys: KeyInfo[];
  onSaved(): Promise<void>;
  onClose(): void;
}

interface Errors {
  name?: string;
  addr?: string;
  port?: string;
  user?: string;
  tmux?: string;
}

function parseTags(text: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of text.split(",")) {
    const tag = raw.trim();
    const key = tag.toLowerCase();
    if (tag !== "" && !seen.has(key)) {
      seen.add(key);
      tags.push(tag);
    }
  }
  return tags;
}

export function HostForm({ host, keys, onSaved, onClose }: Props) {
  const [name, setName] = useState(host?.name ?? "");
  const [addr, setAddr] = useState(host?.addr ?? "");
  const [port, setPort] = useState(String(host?.port ?? 22));
  const [user, setUser] = useState(host?.user ?? "");
  const [keyId, setKeyId] = useState(host?.key_id ?? "");
  const [tmux, setTmux] = useState(host?.tmux_session ?? "");
  const tags = host?.tags.join(", ") ?? "";
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const portNumber = Number(port);
  const errors: Errors = {};
  if (name.trim() === "") errors.name = "Enter a name.";
  if (addr.trim() === "") errors.addr = "Enter a hostname or IP address.";
  if (!/^\d+$/.test(port.trim()) || portNumber < 1 || portNumber > 65535) errors.port = "Use a port from 1 to 65535.";
  if (user.trim() === "") errors.user = "Enter a user name.";
  if (tmux.trim() !== "" && !TMUX_NAME.test(tmux.trim())) errors.tmux = "Use letters, digits, ., _ or -.";
  const valid = Object.keys(errors).length === 0;
  const show = (field: keyof Errors) => (attempted ? errors[field] : undefined);

  const selectedKey = keys.find((k) => k.id === keyId);
  const addressChanged = host !== null && (host.addr !== addr.trim() || host.port !== portNumber);
  const tmuxName = tmux.trim();

  async function save() {
    setAttempted(true);
    if (!valid || busy) return;
    const input: HostInput = {
      name: name.trim(),
      addr: addr.trim(),
      port: portNumber,
      user: user.trim(),
      key_id: keyId === "" ? null : keyId,
      tags: parseTags(tags),
      tmux_session: tmuxName === "" ? null : tmuxName,
    };
    setBusy(true);
    setSaveError(null);
    try {
      if (host) await getIpc().hostsUpdate({ ...input, id: host.id });
      else await getIpc().hostsAdd(input);
      await onSaved();
      onClose();
    } catch (err) {
      setSaveError(errorText(err));
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void save();
    }
  }

  function stepPort(delta: number) {
    const current = /^\d+$/.test(port.trim()) ? portNumber : 22;
    setPort(String(Math.min(65535, Math.max(1, current + delta))));
  }

  const saveLabel = host ? "Save changes" : "Save host";

  return (
    <Modal
      title={host ? "Edit host" : "Add host"}
      className="host-form-modal"
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="host-form" className="btn primary" disabled={busy}>
            {busy && <Spinner />}
            <span>{saveLabel}</span>
            <span className="btn-hint">Ctrl + Enter</span>
          </button>
        </>
      }
    >
      <form
        id="host-form"
        className="form host-form"
        noValidate
        onKeyDown={onKeyDown}
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field id="host-name" label="Name" hint={host ? undefined : "A short name to identify this host."} error={show("name")}>
          <input id="host-name" className="input" value={name} data-autofocus onChange={(e) => setName(e.target.value)} disabled={busy} />
        </Field>
        <Field id="host-addr" label="Address" hint={host ? undefined : "Hostname or IP address."} error={show("addr")}>
          <input id="host-addr" className="input" value={addr} spellCheck={false} onChange={(e) => setAddr(e.target.value)} disabled={busy} />
        </Field>
        {addressChanged && (
          <div className="host-form-extra">
            <div className="host-callout warn">
              <WarnBadge size={18} />
              <div>
                <strong>The pinned host key stays.</strong>
                <p>If this is a different server you will be asked to forget it.</p>
              </div>
            </div>
          </div>
        )}
        <Field
          id="host-port"
          label="Port"
          error={show("port")}
          narrow
          trailing={
            <span className="stepper-btns">
              <button type="button" tabIndex={-1} aria-label="Increase port" disabled={busy} onClick={() => stepPort(1)}>
                <Icon name="chevronUp" size={12} />
              </button>
              <button type="button" tabIndex={-1} aria-label="Decrease port" disabled={busy} onClick={() => stepPort(-1)}>
                <Icon name="chevronDown" size={12} />
              </button>
            </span>
          }
        >
          <input id="host-port" className="input" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} disabled={busy} />
        </Field>
        <Field id="host-user" label="User" error={show("user")}>
          <input id="host-user" className="input" value={user} spellCheck={false} autoCapitalize="off" onChange={(e) => setUser(e.target.value)} disabled={busy} />
        </Field>
        <Field
          id="host-key"
          label="Key"
          hint={
            selectedKey && !host ? (
              <>
                SSH key to use for this host. You can also add keys in <span className="hint-link">Keys</span>.
              </>
            ) : undefined
          }
        >
          <select id="host-key" className="input" value={keyId} onChange={(e) => setKeyId(e.target.value)} disabled={busy}>
            <option value="">None (no key)</option>
            {keys.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
          </select>
        </Field>
        {!selectedKey && (
          <div className="host-form-extra">
            <div className="host-callout warn">
              <WarnBadge size={18} />
              <div>
                <strong>No key assigned</strong>
                <p>You can still save this host, but you'll need to assign a key before connecting.</p>
              </div>
            </div>
          </div>
        )}
        <Field
          id="host-tmux"
          label="tmux session (optional)"
          hint={
            <>
              Leave blank for a plain shell.
              <br />
              Use letters, digits, ., _ or -.
            </>
          }
          error={show("tmux")}
        >
          <input id="host-tmux" className="input" value={tmux} spellCheck={false} onChange={(e) => setTmux(e.target.value)} disabled={busy} />
        </Field>
        {selectedKey && !host && (
          <div className="host-callout info">
            <InfoBadge size={22} />
            <p>
              This host will use key "{selectedKey.name}" and {tmuxName === "" ? "open a plain shell" : `open tmux session "${tmuxName}"`}.
            </p>
          </div>
        )}
        {saveError && (
          <p className="error-text" role="alert">
            <Icon name="warning" size={14} /> {saveError}
          </p>
        )}
      </form>
    </Modal>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  narrow,
  trailing,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  narrow?: boolean;
  trailing?: ReactNode;
  children: ReactElement<Record<string, unknown>>;
}) {
  const noteId = `${id}-note`;
  return (
    <div className={`field${narrow ? " narrow" : ""}`}>
      <label htmlFor={id}>{label}</label>
      <div className="control">
        {cloneElement(children, {
          "aria-describedby": error || hint ? noteId : undefined,
          "aria-invalid": error ? true : undefined,
        })}
        {trailing}
      </div>
      {(error || hint) && (
        <p id={noteId} className={error ? "error-text" : "hint"}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
