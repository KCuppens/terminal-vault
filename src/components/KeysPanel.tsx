import { useState } from "react";

import { getIpc, type Host, type KeyInfo } from "../ipc";
import { shortFingerprint } from "../lib/hostKeyChanged";
import { hostsUsingKey } from "../lib/hostMeta";
import { ConfirmDialog } from "./ConfirmDialog";
import {
  GenerateKeyDialog,
  ImportKeyDialog,
  KeyBlockedDialog,
  KeyCreatedDialog,
  KeyDetailsDialog,
} from "./KeyDialogs";
import { Menu, type MenuItem } from "./Menu";
import { useServices } from "./services";
import { Icon } from "./ui";

interface Props {
  keys: KeyInfo[];
  hosts: Host[];
  loaded: boolean;
  onChanged(): Promise<void>;
  onShowHosts(key: KeyInfo): void;
}

type Dialog =
  | { kind: "generate" }
  | { kind: "import" }
  | { kind: "created"; key: KeyInfo }
  | { kind: "details"; key: KeyInfo }
  | { kind: "blocked"; key: KeyInfo }
  | { kind: "delete"; key: KeyInfo };

export function KeysPanel({ keys, hosts, loaded, onChanged, onShowHosts }: Props) {
  const { copy, toast } = useServices();
  const [dialog, setDialog] = useState<Dialog | null>(null);

  function menuFor(key: KeyInfo): MenuItem[] {
    const used = hostsUsingKey(key.id, hosts).length;
    return [
      { label: "Key details", icon: "info", onSelect: () => setDialog({ kind: "details", key }) },
      { label: `Show hosts (${used})`, icon: "server", disabled: used === 0, onSelect: () => onShowHosts(key) },
      {
        label: "Delete key",
        icon: "trash",
        danger: true,
        separatorBefore: true,
        onSelect: () => setDialog({ kind: used > 0 ? "blocked" : "delete", key }),
      },
    ];
  }

  return (
    <section className="panel kpanel" aria-label="Keys">
      <header className="panel-head lhead">
        <h2>Keys</h2>
        <div className="panel-actions">
          <button type="button" className="obtn-o pbtn" onClick={() => setDialog({ kind: "import" })}>
            <Icon name="upload" size={16} />
            Import
          </button>
          <button type="button" className="obtn pbtn" onClick={() => setDialog({ kind: "generate" })}>
            <Icon name="plus" size={16} />
            Generate
          </button>
        </div>
      </header>
      <div className="panel-body">
        {!loaded ? (
          <ul className="rows" aria-busy="true" aria-label="Loading keys">
            {[0, 1, 2].map((i) => (
              <li key={i} className="row skeleton tall">
                <span className="sk sk-dot" />
                <div className="row-main">
                  <span className="sk sk-line" />
                  <span className="sk sk-line short" />
                </div>
              </li>
            ))}
          </ul>
        ) : keys.length === 0 ? (
          <div className="empty">
            <Icon name="key" size={28} />
            <p className="empty-title">No keys</p>
            <p className="muted">Generate one in two clicks.</p>
            <div className="empty-actions">
              <button type="button" className="btn primary" onClick={() => setDialog({ kind: "generate" })}>
                <Icon name="plus" size={14} />
                Generate key
              </button>
            </div>
          </div>
        ) : (
          <ul className="kcards">
            {keys.map((key) => {
              const used = hostsUsingKey(key.id, hosts).length;
              return (
                <li key={key.id} className="kcard">
                  <span className="ktile">
                    <Icon name="key" size={26} />
                  </span>
                  <div className="row-main">
                    <span className="ktitle">
                      {key.name}
                      <span className="kpill">{key.key_type}</span>
                      <span className={used > 0 ? "kbadge used" : "kbadge"}>{used > 0 ? `Used by ${used}` : "Unused"}</span>
                    </span>
                    <code className="row-sub" title={key.fingerprint}>
                      {shortFingerprint(key.fingerprint)}
                    </code>
                  </div>
                  <button
                    type="button"
                    className="obtn-o kcopy"
                    onClick={() => void copy(key.public, { sensitive: true, label: "Public key copied." })}
                  >
                    <Icon name="copy" size={14} />
                    Copy public key
                  </button>
                  <Menu label={`Actions for ${key.name}`} items={menuFor(key)} className="ebtn kebtn" />
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <footer className="panel-foot lfoot">
        <Icon name="info" size={18} />
        <p>Private key material is encrypted and never displayed in this panel.</p>
      </footer>
      {dialog?.kind === "generate" && (
        <GenerateKeyDialog
          onClose={() => setDialog(null)}
          onCreated={(key) => {
            setDialog({ kind: "created", key });
            void onChanged();
          }}
        />
      )}
      {dialog?.kind === "import" && (
        <ImportKeyDialog
          onClose={() => setDialog(null)}
          onImported={(key) => {
            setDialog(null);
            void onChanged();
            toast({ message: `Imported ${key.name}.`, tone: "success" });
          }}
        />
      )}
      {dialog?.kind === "created" && <KeyCreatedDialog keyInfo={dialog.key} onClose={() => setDialog(null)} />}
      {dialog?.kind === "details" && (
        <KeyDetailsDialog keyInfo={dialog.key} hosts={hostsUsingKey(dialog.key.id, hosts)} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === "blocked" && (
        <KeyBlockedDialog
          keyInfo={dialog.key}
          hosts={hostsUsingKey(dialog.key.id, hosts)}
          onClose={() => setDialog(null)}
          onShowHosts={() => {
            onShowHosts(dialog.key);
            setDialog(null);
          }}
        />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title={`Delete ${dialog.key.name}?`}
          danger
          confirmLabel="Delete key"
          message={<p>The private key is removed from your vault. This cannot be undone.</p>}
          onClose={() => setDialog(null)}
          onConfirm={async () => {
            await getIpc().keysRemove(dialog.key.id);
            await onChanged();
            toast({ message: `Deleted ${dialog.key.name}.`, tone: "success" });
          }}
        />
      )}
    </section>
  );
}
