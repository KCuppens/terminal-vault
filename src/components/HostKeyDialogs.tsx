import { useEffect, useRef, useState } from "react";

import { getIpc, type HostKeyPromptInfo } from "../ipc";
import { formatCountdown } from "../lib/format";
import { AuthIcon } from "./authIcons";
import { ConfirmDialog } from "./ConfirmDialog";
import { Modal } from "./Modal";
import { useServices } from "./services";
import { Spinner } from "./ui";

const PROMPT_SECONDS = 120;

interface TrustProps {
  prompt: HostKeyPromptInfo;
  position: number;
  total: number;
  onDecide(accept: boolean): Promise<void>;
}

export function HostKeyTrust({ prompt, position, total, onDecide }: TrustProps) {
  const { copy } = useServices();
  const [left, setLeft] = useState(PROMPT_SECONDS);
  const [busy, setBusy] = useState(false);
  const decideRef = useRef(onDecide);
  decideRef.current = onDecide;

  useEffect(() => {
    const end = Date.now() + PROMPT_SECONDS * 1000;
    const timer = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setLeft(remaining);
      if (remaining === 0) {
        clearInterval(timer);
        void decideRef.current(false);
      }
    }, 500);
    return () => clearInterval(timer);
  }, []);

  async function decide(accept: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await onDecide(accept);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      className="avd trust"
      title="Trust this server?"
      subtitle="Verify SSH host identity"
      icon={<AuthIcon name="shieldAlert" size={44} />}
      hideClose
      headRight={total > 1 ? <span className="avd-count">{position} of {total}</span> : undefined}
      onClose={() => void decide(false)}
      footer={
        <>
          <button type="button" className="avd-btn" data-autofocus disabled={busy} onClick={() => void decide(false)}>
            Cancel
          </button>
          <button type="button" className="avd-btn primary" disabled={busy} onClick={() => void decide(true)}>
            {busy ? <Spinner /> : <AuthIcon name="shieldGuard" size={26} />}
            Trust and connect
          </button>
        </>
      }
    >
      <p className="avd-lead">
        You are connecting to <strong>{prompt.host_name}</strong> ({prompt.addr_port}) for the first time.
      </p>
      <div className="avd-facts">
        <div className="avd-row">
          <span className="avd-label">Host key type</span>
          <span className="avd-chip">{prompt.key_type}</span>
        </div>
        <div className="avd-fp">
          <span className="avd-label">SHA256 fingerprint</span>
          <div className="avd-fp-row">
            <code>{prompt.fingerprint}</code>
            <button
              type="button"
              className="avd-btn small"
              onClick={() => void copy(prompt.fingerprint, { label: "Fingerprint copied." })}
            >
              <AuthIcon name="copy" size={24} />
              Copy
            </button>
          </div>
        </div>
      </div>
      <div className="avd-note">
        <AuthIcon name="infoCircle" size={28} className="avd-note-icon" />
        <p>Check this fingerprint against your server provider before trusting it.</p>
      </div>
      <div className="avd-expiry" role="timer">
        <AuthIcon name="clock" size={26} />
        <span>Prompt expires in {formatCountdown(left)}</span>
        <span className="avd-esc">Esc to cancel</span>
      </div>
    </Modal>
  );
}

export interface ChangedKey {
  hostId: string;
  hostName: string;
  addrPort: string;
  pinned: string;
  offered: string;
}

interface ChangedProps {
  info: ChangedKey;
  onClose(): void;
  onForgotten(): void;
}

export function HostKeyChanged({ info, onClose, onForgotten }: ChangedProps) {
  const { toast } = useServices();
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <Modal
        className="avd changed"
        title="Host key changed"
        subtitle="Security warning · Connection blocked"
        tone="danger"
        icon={<AuthIcon name="alertCircle" size={50} />}
        hideClose
        onClose={onClose}
        footer={
          <>
            <button type="button" className="avd-btn" data-autofocus onClick={onClose}>
              Close
            </button>
            <button type="button" className="avd-btn danger" onClick={() => setConfirming(true)}>
              Forget pinned key...
            </button>
          </>
        }
      >
        <p className="avd-lead">
          <strong>{info.hostName}</strong> now presents a different key than the one you trusted. Someone may be
          intercepting the connection, or the server was rebuilt.
        </p>
        <div className="avd-facts stacked">
          <div className="avd-fp-line">
            <div>
              <span className="avd-label">Pinned fingerprint</span>
              <code>{info.pinned}</code>
            </div>
            <AuthIcon name="shieldDot" size={38} className="avd-mark pinned" />
          </div>
          <div className="avd-fp-line offered">
            <div>
              <span className="avd-label">Offered fingerprint</span>
              <code>{info.offered}</code>
            </div>
            <AuthIcon name="alertTriangle" size={38} className="avd-mark offered" />
          </div>
        </div>
        <p className="avd-blocked">
          <AuthIcon name="ban" size={34} />
          Connection was not made.
        </p>
      </Modal>
      {confirming && (
        <ConfirmDialog
          title={`Forget the pinned key for ${info.hostName}?`}
          danger
          confirmLabel="Forget key"
          message={
            <p>
              Only do this if you know the server was rebuilt. The next connection will ask you to trust whatever key it
              presents.
            </p>
          }
          onClose={() => setConfirming(false)}
          onConfirm={async () => {
            await getIpc().hostKeyForget(info.hostId);
            toast({ message: `Forgot the pinned key for ${info.hostName}.`, detail: "Reconnect to trust the new key.", tone: "success" });
            onForgotten();
          }}
        />
      )}
    </>
  );
}
