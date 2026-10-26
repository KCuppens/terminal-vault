import { useState } from "react";

import { getIpc, type Host, type Layout } from "../ipc";
import { errorText } from "../lib/errors";
import { describeLayout, layoutHosts } from "../lib/layoutThumb";
import { LayoutNameDialog } from "./LayoutDialogs";
import { HostChip, LayoutThumb } from "./LayoutThumb";
import { Menu } from "./Menu";
import { useServices } from "./services";
import { Icon } from "./ui";

interface Props {
  layouts: Layout[];
  hosts: Host[];
  loaded: boolean;
  canSave: boolean;
  onSaveCurrent(): void;
  onOpen(layout: Layout): void;
  onChanged(): Promise<void>;
}

type Dialog = { kind: "rename"; layout: Layout } | { kind: "copy"; layout: Layout };

const MAX_CHIPS = 3;

export function LayoutsPanel({ layouts, hosts, loaded, canSave, onSaveCurrent, onOpen, onChanged }: Props) {
  const { toast } = useServices();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const hostById = new Map(hosts.map((h) => [h.id, h]));
  const names = layouts.map((l) => l.name);

  async function remove(layout: Layout) {
    try {
      await getIpc().layoutRemove(layout.id);
      await onChanged();
    } catch (err) {
      toast({ message: `Could not delete ${layout.name}.`, detail: errorText(err), tone: "error" });
      return;
    }
    toast({
      message: `Layout "${layout.name}" deleted`,
      actions: [
        {
          label: "Undo",
          run: async () => {
            try {
              await getIpc().layoutSave(layout);
              await onChanged();
            } catch (err) {
              toast({ message: `Could not restore ${layout.name}.`, detail: errorText(err), tone: "error" });
            }
          },
        },
      ],
    });
  }

  return (
    <section className="panel lpanel" aria-label="Layouts">
      <header className="panel-head lhead">
        <h2>Layouts</h2>
        <button
          type="button"
          className="obtn pbtn"
          disabled={!canSave}
          title={canSave ? undefined : "Open a host in a pane first"}
          onClick={onSaveCurrent}
        >
          <Icon name="plus" size={18} />
          Save current
        </button>
      </header>
      <div className="panel-body">
        {!loaded ? (
          <ul className="rows" aria-busy="true" aria-label="Loading layouts">
            {[0, 1].map((i) => (
              <li key={i} className="row skeleton tall">
                <span className="sk sk-thumb" />
                <div className="row-main">
                  <span className="sk sk-line" />
                  <span className="sk sk-line short" />
                </div>
              </li>
            ))}
          </ul>
        ) : layouts.length === 0 ? (
          <div className="empty">
            <Icon name="layout" size={28} />
            <p className="empty-title">No saved layouts.</p>
            <p className="muted">Arrange your tabs and panes, then save them to reopen later.</p>
            <div className="empty-actions">
              <button type="button" className="btn primary" disabled={!canSave} onClick={onSaveCurrent}>
                Save current
              </button>
            </div>
          </div>
        ) : (
          <ul className="lcards">
            {layouts.map((layout) => {
              const ids = layoutHosts(layout);
              return (
                <li key={layout.id} className="lcard">
                  <LayoutThumb layout={layout} />
                  <div className="lcard-main">
                    <span className="lcard-title">{layout.name}</span>
                    <span className="lcard-sub">{describeLayout(layout)}</span>
                    <span className="hchips">
                      {ids.slice(0, MAX_CHIPS).map((id) => (
                        <HostChip key={id} host={hostById.get(id)} />
                      ))}
                      {ids.length > MAX_CHIPS && <span className="hchip">+{ids.length - MAX_CHIPS}</span>}
                    </span>
                  </div>
                  <button type="button" className="obtn" onClick={() => onOpen(layout)}>
                    Open
                  </button>
                  <Menu
                    className="ebtn"
                    label={`Actions for ${layout.name}`}
                    items={[
                      { label: "Rename", icon: "edit", onSelect: () => setDialog({ kind: "rename", layout }) },
                      { label: "Open a copy", icon: "copy", onSelect: () => setDialog({ kind: "copy", layout }) },
                      { label: "Delete", icon: "trash", danger: true, onSelect: () => void remove(layout) },
                    ]}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <footer className="panel-foot lfoot">
        <Icon name="info" size={18} />
        <p>Saved layouts reopen with each host's default tmux session.</p>
      </footer>
      {dialog?.kind === "rename" && (
        <LayoutNameDialog
          title="Rename layout"
          confirmLabel="Rename"
          initial={dialog.layout.name}
          existingNames={names}
          hosts={hosts}
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            await getIpc().layoutSave({ ...dialog.layout, name });
            await onChanged();
          }}
        />
      )}
      {dialog?.kind === "copy" && (
        <LayoutNameDialog
          title="Open a copy"
          confirmLabel="Save copy"
          initial={`${dialog.layout.name} copy`}
          existingNames={names}
          preview={dialog.layout}
          hosts={hosts}
          onClose={() => setDialog(null)}
          onSubmit={async (name) => {
            const copy = { ...dialog.layout, id: crypto.randomUUID(), name };
            await getIpc().layoutSave(copy);
            await onChanged();
            onOpen(copy);
          }}
        />
      )}
    </section>
  );
}
