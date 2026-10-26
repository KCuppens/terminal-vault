import { useMemo, useState } from "react";

import { getIpc, type Host, type KeyInfo } from "../ipc";
import { errorText } from "../lib/errors";
import { hostAddress, hostDetail } from "../lib/hostMeta";
import type { ConnectMode } from "../lib/palette";
import { ConfirmDialog } from "./ConfirmDialog";
import { Menu, type MenuItem } from "./Menu";
import { useServices } from "./services";
import { WarnBadge } from "./badgeIcons";
import { Icon, StatusDot, type DotState } from "./ui";

interface Props {
  hosts: Host[];
  keys: KeyInfo[];
  loaded: boolean;
  hostStates: Record<string, DotState>;
  keyFilter: KeyInfo | null;
  onClearKeyFilter(): void;
  onAdd(): void;
  onEdit(host: Host): void;
  onConnect(host: Host, mode: ConnectMode): void;
  onImport(): void;
  onChanged(): Promise<void>;
}

type Pending = { kind: "delete" | "forget"; host: Host };

function matches(host: Host, needle: string): boolean {
  const hay = [host.name, host.addr, host.user, ...host.tags].join(" ").toLowerCase();
  return needle
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => hay.includes(token));
}

export function HostsPanel(props: Props) {
  const { hosts, keys, loaded, hostStates, keyFilter } = props;
  const { toast } = useServices();
  const [filter, setFilter] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);

  const visible = useMemo(
    () =>
      hosts
        .filter((h) => keyFilter === null || h.key_id === keyFilter.id)
        .filter((h) => matches(h, filter)),
    [hosts, keyFilter, filter],
  );

  async function duplicate(host: Host) {
    const { id: _id, ...rest } = host;
    try {
      await getIpc().hostsAdd({ ...rest, name: `${host.name} copy` });
      await props.onChanged();
      toast({ message: `Duplicated ${host.name}.`, tone: "success" });
    } catch (err) {
      toast({ message: errorText(err), tone: "error" });
    }
  }

  function menuFor(host: Host): MenuItem[] {
    return [
      { label: "Connect with tmux session...", icon: "terminalBox", onSelect: () => props.onConnect(host, "tmux") },
      { label: "Edit", icon: "edit", onSelect: () => props.onEdit(host) },
      { label: "Duplicate", icon: "copy", onSelect: () => void duplicate(host) },
      { label: "Forget host key", icon: "key", separatorBefore: true, onSelect: () => setPending({ kind: "forget", host }) },
      { label: "Delete", icon: "trash", danger: true, onSelect: () => setPending({ kind: "delete", host }) },
    ];
  }

  return (
    <section className="panel hosts-panel" aria-label="Hosts">
      <header className="panel-head">
        <h2>Hosts</h2>
        <button type="button" className="btn small primary" onClick={props.onAdd}>
          <Icon name="plus" size={14} />
          Add host
        </button>
      </header>
      <div className="panel-tools">
        <div className="input-wrap search">
          <Icon name="search" size={14} />
          <input
            type="search"
            value={filter}
            placeholder="Filter hosts..."
            aria-label="Filter hosts"
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
        {keyFilter && (
          <button type="button" className="chip removable" onClick={props.onClearKeyFilter} aria-label={`Clear key filter ${keyFilter.name}`}>
            <Icon name="key" size={12} />
            Key: {keyFilter.name}
            <Icon name="close" size={12} />
          </button>
        )}
      </div>
      <div className="panel-body">
        {!loaded ? (
          <SkeletonRows />
        ) : hosts.length === 0 ? (
          <div className="empty hosts-empty">
            <Icon name="server" size={44} />
            <p className="empty-title">No hosts yet.</p>
            <p className="muted">Add your first server.</p>
            <div className="empty-actions">
              <button type="button" className="btn primary" onClick={props.onAdd}>
                <Icon name="plus" size={14} />
                Add host
              </button>
              <button type="button" className="btn" onClick={props.onImport}>
                <Icon name="upload" size={16} />
                Import from ~/.ssh/config
              </button>
            </div>
          </div>
        ) : visible.length === 0 ? (
          <div className="empty">
            <p className="empty-title">No hosts match.</p>
            <p className="muted">Try a different filter.</p>
          </div>
        ) : (
          <ul className="rows">
            {visible.map((host) => (
              <li key={host.id} className="row host-row">
                <StatusDot state={hostStates[host.id] ?? "none"} />
                <div className="row-main">
                  <span className="row-title">{host.name}</span>
                  {host.key_id !== null && <span className="row-sub">{hostAddress(host)}</span>}
                  <span className="row-sub">
                    {hostDetail(host, keys)}
                    {host.key_id === null && <WarnBadge size={20} className="row-warn" />}
                  </span>
                </div>
                {host.key_id === null ? (
                  <button type="button" className="btn small" onClick={() => props.onEdit(host)}>
                    Assign key
                  </button>
                ) : (
                  <button type="button" className="btn small btn-connect" onClick={() => props.onConnect(host, "default")}>
                    Connect
                  </button>
                )}
                <Menu label={`Actions for ${host.name}`} items={menuFor(host)} className="icon-btn host-more" menuClassName="host-menu" />
              </li>
            ))}
          </ul>
        )}
      </div>
      {hosts.length > 0 && (
        <footer className="panel-foot">
          <button type="button" className="btn ghost small" onClick={props.onImport}>
            <Icon name="file" size={14} />
            Import from ~/.ssh/config
          </button>
        </footer>
      )}
      {pending?.kind === "delete" && (
        <ConfirmDialog
          title={`Delete ${pending.host.name}?`}
          danger
          confirmLabel="Delete host"
          message={<p>This removes the host from your vault. Open terminals keep running until you close them.</p>}
          onClose={() => setPending(null)}
          onConfirm={async () => {
            await getIpc().hostsRemove(pending.host.id);
            await props.onChanged();
            toast({ message: `Deleted ${pending.host.name}.`, tone: "success" });
          }}
        />
      )}
      {pending?.kind === "forget" && (
        <ConfirmDialog
          title={`Forget the host key for ${pending.host.name}?`}
          confirmLabel="Forget host key"
          message={<p>You will be asked to trust this server again the next time you connect.</p>}
          onClose={() => setPending(null)}
          onConfirm={async () => {
            await getIpc().hostKeyForget(pending.host.id);
            toast({ message: `Forgot the host key for ${pending.host.name}.`, tone: "success" });
          }}
        />
      )}
    </section>
  );
}

function SkeletonRows() {
  return (
    <ul className="rows" aria-busy="true" aria-label="Loading hosts">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="row skeleton">
          <span className="sk sk-dot" />
          <div className="row-main">
            <span className="sk sk-line" />
            <span className="sk sk-line short" />
          </div>
          <span className="sk sk-btn" />
        </li>
      ))}
    </ul>
  );
}
