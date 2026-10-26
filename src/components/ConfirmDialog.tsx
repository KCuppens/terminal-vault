import { useState, type ReactNode } from "react";

import { errorText } from "../lib/errors";
import { Modal } from "./Modal";
import { Spinner } from "./ui";

interface Props {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm(): Promise<void> | void;
  onClose(): void;
}

export function ConfirmDialog({ title, message, confirmLabel, danger, onConfirm, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  return (
    <Modal
      title={title}
      size="sm"
      tone={danger ? "danger" : undefined}
      onClose={busy ? () => undefined : onClose}
      hideClose
      footer={
        <>
          <button type="button" className="btn" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={danger ? "btn danger" : "btn primary"}
            data-autofocus
            disabled={busy}
            onClick={() => void confirm()}
          >
            {busy && <Spinner />}
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="stack">{message}</div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
