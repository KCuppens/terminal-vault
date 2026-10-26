import { useState, type FormEvent } from "react";

import type { Host, Layout } from "../ipc";
import { plural } from "../lib/format";
import { describeLayout, layoutHosts } from "../lib/layoutThumb";
import { missingHostIds } from "../lib/layoutPlan";
import { LayoutPreview, LayoutThumb } from "./LayoutThumb";
import { Modal } from "./Modal";
import { Icon } from "./ui";

interface NameDialogProps {
  title: string;
  confirmLabel: string;
  initial: string;
  existingNames: string[];
  preview?: Layout;
  hosts: Host[];
  onSubmit(name: string): Promise<void>;
  onClose(): void;
}

export function LayoutNameDialog({ title, confirmLabel, initial, existingNames, preview, hosts, onSubmit, onClose }: NameDialogProps) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();
  const replaces = trimmed !== "" && trimmed !== initial && existingNames.some((n) => n.toLowerCase() === trimmed.toLowerCase());

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (trimmed === "" || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(trimmed);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={title}
      size="sm"
      className="kdlg"
      onClose={busy ? () => undefined : onClose}
      footer={
        <>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="layout-name" className="btn primary" disabled={busy || trimmed === ""}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <form id="layout-name" className="form" onSubmit={(e) => void submit(e)}>
        <div className="field">
          <label htmlFor="layout-name-input">Name</label>
          <input
            id="layout-name-input"
            className="input"
            value={name}
            data-autofocus
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
          />
          <p className="hint">{replaces ? "A layout with this name exists. Saving replaces it." : "A short name to identify this layout."}</p>
        </div>
        {preview && (
          <div className="field">
            <span className="label">Preview</span>
            <LayoutPreview layout={preview} hosts={hosts} />
          </div>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

export function OpenLayoutDialog({
  layout,
  hosts,
  onOpen,
  onClose,
}: {
  layout: Layout;
  hosts: Host[];
  onOpen(): void;
  onClose(): void;
}) {
  const missing = missingHostIds(layout, hosts);
  const total = layoutHosts(layout).length;
  const remaining = total - missing.length;
  return (
    <Modal
      title="Open layout"
      size="md"
      className="kdlg ldlg-open"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" data-autofocus disabled={remaining === 0} onClick={onOpen}>
            Open anyway
          </button>
        </>
      }
    >
      <div className="lopen-head">
        <LayoutThumb layout={layout} />
        <div>
          <p className="lopen-name">{layout.name}</p>
          <p className="lopen-sub">{describeLayout(layout)}</p>
        </div>
      </div>
      <div className="lwarn" role="alert">
        <Icon name="warning" size={26} />
        <div>
          <p className="lwarn-title">{`${plural(missing.length, "host")} no longer ${missing.length === 1 ? "exists" : "exist"}`}</p>
          <p>{missing.length === 1 ? "The following host was" : "The following hosts were"} not found and will be skipped:</p>
          <ul>
            {missing.map((id) => (
              <li key={id}>{`Unknown host (${id.slice(0, 8)})`}</li>
            ))}
          </ul>
        </div>
      </div>
      <p className="lopen-note">
        {remaining === 0 ? "No hosts are left to open." : `The remaining ${plural(remaining, "host")} will be opened.`}
      </p>
      <LayoutPreview layout={layout} hosts={hosts} height={165} />
    </Modal>
  );
}
