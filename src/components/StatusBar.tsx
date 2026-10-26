import { formatClock, plural } from "../lib/format";
import { autoLockLabel } from "../lib/settings";
import { Menu } from "./Menu";
import { Icon, StatusDot, type DotState } from "./ui";

export interface OpenTerminal {
  paneId: string;
  name: string;
  state: DotState;
}

interface Props {
  terminals: OpenTerminal[];
  unlockedAt: Date;
  lockSeconds: number | null;
  autoLockMinutes: number;
  onAutoLock(minutes: number): void;
  onLock(): void;
  onFocusPane(paneId: string): void;
  onSettings(): void;
}

export function StatusBar({ terminals, unlockedAt, lockSeconds, autoLockMinutes, onAutoLock, onLock, onFocusPane, onSettings }: Props) {
  const time = unlockedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return (
    <footer className="statusbar">
      <div className="status-left">
        <span className="status-count">
          <span className="dot dot-live" aria-hidden="true" />
          {plural(terminals.length, "terminal")}
        </span>
        <ul className="status-hosts">
          {terminals.map((t) => (
            <li key={t.paneId}>
              <button type="button" className="chip chip-button" onClick={() => onFocusPane(t.paneId)}>
                <StatusDot state={t.state} />
                {t.name}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="status-right">
        <Menu
          label="Lock options"
          className="lock-menu"
          items={[
            { label: "Lock now", icon: "lock", onSelect: onLock },
            ...[1, 5, 15, 30, 60, 0].map((m) => ({
              label: `${m === autoLockMinutes ? "✓ " : ""}Auto-lock: ${autoLockLabel(m)}`,
              icon: "clock" as const,
              separatorBefore: m === 1,
              onSelect: () => onAutoLock(m),
            })),
          ]}
        >
          <span className="lock-countdown" role="timer">
            <Icon name="clock" size={12} />{" "}
            {lockSeconds === null ? "Auto-lock off" : `Locks in ${formatClock(lockSeconds)}`}
          </span>
        </Menu>
        <span className="status-vault">
          <Icon name="lockSolid" size={16} />
          Vault unlocked<span className="status-time"> · {time}</span>
        </span>
        <button type="button" className="icon-btn" aria-label="Settings" onClick={onSettings}>
          <Icon name="gear" size={20} />
        </button>
      </div>
    </footer>
  );
}
