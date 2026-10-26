import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { getIpc, type BackupInfo, type VaultInfo } from "../ipc";
import { errorText } from "../lib/errors";
import { formatBytes, formatDateTime } from "../lib/format";
import { classifyUnlockError } from "../lib/unlockError";
import { AuthIcon } from "./authIcons";
import { AuthPassword, Brand } from "./authParts";
import { useServices } from "./services";

interface Props {
  info: VaultInfo | null;
  onUnlocked(): void | Promise<void>;
}

type Problem =
  | { kind: "wrong" }
  | { kind: "corrupt" }
  | { kind: "other"; message: string };

export function Unlock({ info, onUnlocked }: Props) {
  const { toast, copy } = useServices();
  const [pass, setPass] = useState("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [backups, setBackups] = useState<BackupInfo[] | null>(null);
  const [restoring, setRestoring] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();

  const waitSeconds = retryAt === null ? 0 : Math.max(0, Math.ceil((retryAt - now) / 1000));
  const throttled = waitSeconds > 0;
  const corrupt = problem?.kind === "corrupt";

  useEffect(() => {
    if (retryAt === null) return;
    const timer = setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= retryAt) setRetryAt(null);
    }, 500);
    return () => clearInterval(timer);
  }, [retryAt]);

  useEffect(() => {
    if (!corrupt) return;
    let live = true;
    getIpc()
      .vaultBackups()
      .then((list) => live && setBackups(list))
      .catch(() => live && setBackups([]));
    return () => {
      live = false;
    };
  }, [corrupt]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || throttled || pass === "") return;
    setBusy(true);
    setProblem(null);
    try {
      await getIpc().vaultUnlock(pass);
      setPass("");
      await onUnlocked();
    } catch (err) {
      const found = classifyUnlockError(errorText(err));
      if (found.kind === "throttled") {
        const t = Date.now();
        setNow(t);
        setRetryAt(t + found.seconds * 1000);
      } else {
        setProblem(found);
      }
      setBusy(false);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }

  async function restore(backup: BackupInfo) {
    setRestoring(true);
    try {
      await getIpc().vaultRestore(backup.name);
      setProblem(null);
      setBackups(null);
      toast({
        message: "Backup restored.",
        detail: "Unlock with the passphrase the backup was made with.",
        tone: "success",
        seconds: 8,
      });
    } catch (err) {
      toast({ message: errorText(err), tone: "error" });
    } finally {
      setRestoring(false);
    }
  }

  const wrong = problem?.kind === "wrong";
  const message = throttled ? null : wrong ? "Wrong passphrase" : problem?.kind === "other" ? problem.message : null;
  const newest = backups?.[0];

  return (
    <div className="auth-screen av-screen">
      <form
        className={corrupt ? "av-card av-unlock corrupt" : "av-card av-unlock"}
        onSubmit={(e) => void submit(e)}
        aria-busy={busy}
      >
        <Brand variant={corrupt ? "compact" : "stack"} />
        {corrupt ? (
          <>
            <div className="av-alert" role="alert">
              <AuthIcon name="alertCircle" size={29} className="av-alert-icon" />
              <div>
                <strong>This vault file can't be read.</strong>
                <span>It may be corrupted or from a newer version.</span>
              </div>
            </div>
            <div className="av-actions">
              {info && (
                <button
                  type="button"
                  className="av-action tint"
                  onClick={() => void copy(info.path, { label: "Path copied." })}
                >
                  <AuthIcon name="copy" size={20} />
                  Copy path
                </button>
              )}
              <button
                type="button"
                className="av-action"
                disabled={restoring || newest === undefined}
                title={
                  newest
                    ? `${formatDateTime(newest.modified)}, ${formatBytes(newest.bytes)}`
                    : backups === null
                      ? "Looking for backups..."
                      : "No backups found next to the vault."
                }
                onClick={() => newest && void restore(newest)}
              >
                <AuthIcon name="history" size={20} />
                {restoring ? "Restoring..." : "Restore from backup"}
              </button>
            </div>
          </>
        ) : (
          <>
            <AuthPassword
              inputRef={inputRef}
              id="unlock-pass"
              label="Passphrase"
              labelHidden
              placeholder="Passphrase"
              value={pass}
              onChange={(v) => {
                setPass(v);
                if (problem?.kind === "wrong" || problem?.kind === "other") setProblem(null);
              }}
              shown={shown}
              onToggleShown={() => setShown((s) => !s)}
              autoComplete="current-password"
              autoFocus
              invalid={wrong || problem?.kind === "other" || throttled}
              disabled={busy}
              describedBy={message ? errorId : undefined}
            />
            {message && (
              <p className="av-msg error" id={errorId} role="alert">
                {message}
              </p>
            )}
            {throttled && (
              <p className="av-msg throttle" role="status">
                <AuthIcon name="clock" size={22} />
                Try again in {waitSeconds} s
              </p>
            )}
            <button
              type="submit"
              className={busy ? "av-submit busy" : "av-submit"}
              disabled={busy || throttled}
            >
              {busy ? (
                <>
                  <span className="av-spin" aria-hidden="true" /> Unlocking...
                </>
              ) : (
                <>
                  Unlock
                  <AuthIcon name="arrowRight" size={24} className="av-submit-arrow" />
                </>
              )}
            </button>
          </>
        )}
        {info && (
          <div className="av-path">
            <AuthIcon name="folder" size={corrupt ? 24 : 26} />
            <span>vault: {info.path}</span>
          </div>
        )}
      </form>
    </div>
  );
}
