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
    setTouched(true);
    if (freshValid) onChoose(freshName);
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
  function pick(value: string) {
    setSelected(value);
    onChoose(value);
  }
  return (
    <Modal title={title} size="sm" className="tmux-modal" onClose={onClose}>
      <fieldset className="radio-list">
        <legend className="visually-hidden">Session</legend>
        <label className="radio-row">
          <input type="radio" name="tmux" checked={selected === PLAIN} onChange={() => pick(PLAIN)} data-autofocus />
          <span>Plain shell</span>
        </label>
        {sessions.map((s) => (
          <label key={s} className="radio-row">
            <input type="radio" name="tmux" checked={selected === s} onChange={() => pick(s)} />
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
            onChange={(e) => setFresh(e.target.value)}
          />
          <button type="submit" className="btn primary">
            Go
          </button>
        </div>
        <p className={touched && !freshValid ? "error-text" : "hint"}>Use letters, digits, _ or -</p>
      </form>
    </Modal>
  );
}
