import { useEffect, useState, type FormEvent } from "react";

import { getIpc, type Host } from "../ipc";
import { errorText } from "../lib/errors";
import { TMUX_NAME } from "../lib/tmuxName";
import { Modal } from "./Modal";
import { Spinner } from "./ui";
import { AlertBadge } from "./badgeIcons";

interface Props {
  host: Host;
  /** `""` opens a plain shell, otherwise the session name. */
  onChoose(tmux: string): void;
  onClose(): void;
}

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; sessions: string[] };

const PLAIN = "";

export function TmuxPicker({ host, onChoose, onClose }: Props) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [selected, setSelected] = useState(PLAIN);
  const [fresh, setFresh] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    let live = true;
    getIpc()
      .tmuxSessions(host.id)
      .then((sessions) => {
        if (!live) return;
        setLoad({ state: "ready", sessions });
        const preferred = host.tmux_session !== null && sessions.includes(host.tmux_session) ? host.tmux_session : sessions[0];
        setSelected(preferred ?? PLAIN);
      })
      .catch((err) => live && setLoad({ state: "error", message: errorText(err) }));
    return () => {
      live = false;
    };
  }, [host.id, host.tmux_session]);

  const freshName = fresh.trim();
  const freshValid = TMUX_NAME.test(freshName);

  function create(e: FormEvent) {
    e.preventDefault();
    if (freshName === "") {
      // If fresh name is empty, connect with selected session
      onChoose(selected);
      return;
    }
    setTouched(true);
    if (freshValid) onChoose(freshName);
  }

  function handleConfirm() {
    if (freshName !== "") {
      setTouched(true);
      if (freshValid) onChoose(freshName);
    } else {
      onChoose(selected);
    }
  }

  const title = `tmux on ${host.name}`;

  if (load.state === "loading") {
    return (
      <Modal title={title} size="sm" className="tmux-modal" onClose={onClose}>
        <div className="tmux-state" role="status">
          <Spinner />
          <p className="tmux-state-title">Looking for sessions...</p>
          <p className="tmux-state-sub">Connecting to {host.addr}...</p>
        </div>
      </Modal>
    );
  }

  if (load.state === "error") {
    return (
      <Modal title={title} size="sm" className="tmux-modal" onClose={onClose}>
        <div className="tmux-state">
          <AlertBadge size={28} className="tmux-alert" />
          <p className="tmux-state-title">Can't reach the server</p>
          <p className="tmux-state-sub">{load.message}</p>
          <button type="button" className="btn primary tmux-wide" data-autofocus onClick={() => onChoose(PLAIN)}>
            Open plain shell
          </button>
          <button type="button" className="btn tmux-wide" onClick={onClose}>
            Cancel
          </button>
        </div>
      </Modal>
    );
  }

  const { sessions } = load;
  return (
    <Modal
      title={title}
      size="sm"
      className="tmux-modal"
      onClose={onClose}
      footer={
        <div className="modal-actions" style={{ display: "flex", justifyContent: "flex-end", gap: "8px", width: "100%" }}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={handleConfirm}>
            Connect
          </button>
        </div>
      }
    >
      <fieldset className="radio-list">
        <legend className="visually-hidden">Session</legend>
        <label
          className="radio-row"
          style={{ cursor: "pointer" }}
          onClick={() => setSelected(PLAIN)}
          onDoubleClick={() => onChoose(PLAIN)}
        >
          <input
            type="radio"
            name="tmux"
            checked={selected === PLAIN}
            onChange={() => setSelected(PLAIN)}
            data-autofocus
          />
          <span>Plain shell</span>
        </label>
        {sessions.map((s) => (
          <label
            key={s}
            className="radio-row"
            style={{ cursor: "pointer" }}
            onClick={() => setSelected(s)}
            onDoubleClick={() => onChoose(s)}
          >
            <input
              type="radio"
              name="tmux"
              checked={selected === s}
              onChange={() => setSelected(s)}
            />
            <span>{s}</span>
            {s === host.tmux_session && <span className="chip">Default</span>}
          </label>
        ))}
      </fieldset>
      {sessions.length === 0 && <p className="muted">No tmux sessions are running on this server.</p>}
      <form className="tmux-new" onSubmit={create}>
        <label htmlFor="tmux-new">New session</label>
        <div className="inline">
          <input
            id="tmux-new"
            className="input"
            placeholder="Session name"
            value={fresh}
            spellCheck={false}
            aria-invalid={touched && !freshValid ? true : undefined}
            onChange={(e) => {
              setFresh(e.target.value);
              if (touched) setTouched(false);
            }}
          />
          <button type="submit" className="btn primary">
            {freshName === "" ? "Connect" : "Create"}
          </button>
        </div>
        <p className={touched && !freshValid ? "error-text" : "hint"}>Use letters, digits, ., _ or -</p>
      </form>
    </Modal>
  );
}
