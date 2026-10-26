import { useMemo, useRef, useState, type Dispatch, type KeyboardEvent, type PointerEvent } from "react";

import type { Host, Settings, SplitDir } from "../ipc";
import { computeGeometry, type Action, type Divider, type Rect, type TabState } from "../lib/panes";
import type { ResolvedTheme } from "../lib/theme";
import type { ChangedKey } from "./HostKeyDialogs";
import { TerminalView, type PaneStatus } from "./TerminalView";
import { Icon } from "./ui";

interface Props {
  tab: TabState;
  visible: boolean;
  hosts: Host[];
  settings: Settings;
  theme: ResolvedTheme;
  findToken: number;
  dispatch: Dispatch<Action>;
  onAssign(paneId: string, host: Host): void;
  onStatus(paneId: string, status: PaneStatus | null): void;
  onHostKeyChanged(info: ChangedKey): void;
}

const pct = (n: number) => `${n * 100}%`;

const rectStyle = (r: Rect) => ({ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) });

const KEY_STEP = 0.02;

export function PaneTree({ tab, visible, hosts, settings, theme, findToken, dispatch, onAssign, onStatus, onHostKeyChanged }: Props) {
  const geometry = useMemo(() => computeGeometry(tab.root), [tab.root]);
  const containerRef = useRef<HTMLDivElement>(null);
  const hostById = useMemo(() => new Map(hosts.map((h) => [h.id, h])), [hosts]);

  const split = (dir: SplitDir) =>
    dispatch({ type: "split", dir, splitId: crypto.randomUUID(), paneId: crypto.randomUUID() });

  function drag(d: Divider, e: PointerEvent<HTMLDivElement>) {
    const box = containerRef.current?.getBoundingClientRect();
    if (!box || e.buttons === 0) return;
    const ratio =
      d.dir === "H"
        ? (e.clientX - (box.left + d.rect.x * box.width)) / (d.rect.w * box.width)
        : (e.clientY - (box.top + d.rect.y * box.height)) / (d.rect.h * box.height);
    dispatch({ type: "setRatio", splitId: d.splitId, ratio });
  }

  function nudge(d: Divider, e: KeyboardEvent<HTMLDivElement>) {
    const back = d.dir === "H" ? "ArrowLeft" : "ArrowUp";
    const forward = d.dir === "H" ? "ArrowRight" : "ArrowDown";
    if (e.key !== back && e.key !== forward) return;
    e.preventDefault();
    dispatch({ type: "setRatio", splitId: d.splitId, ratio: d.ratio + (e.key === forward ? KEY_STEP : -KEY_STEP) });
  }

  const closePane = (paneId: string) => dispatch({ type: "closePane", paneId });
  const [zoomId, setZoomId] = useState<string | null>(null);
  const zoomedLeaf = geometry.leaves.some((l) => l.id === zoomId) ? zoomId : null;

  return (
    <div className="pane-area" ref={containerRef} hidden={!visible}>
      {geometry.leaves.map((leaf) => {
        const focused = tab.focus === leaf.id;
        return (
          <div
            key={leaf.id}
            className={[focused ? "pane focused" : "pane", zoomedLeaf === leaf.id ? "zoomed" : "", zoomedLeaf && zoomedLeaf !== leaf.id ? "zoom-hidden" : ""].filter(Boolean).join(" ")}
            style={zoomedLeaf === leaf.id ? rectStyle({ x: 0, y: 0, w: 1, h: 1 }) : rectStyle(leaf.rect)}
            onMouseDown={() => dispatch({ type: "focusPane", paneId: leaf.id })}
          >
            {leaf.hostId === null ? (
              <EmptyPane hosts={hosts} onPick={(h) => onAssign(leaf.id, h)} onClose={() => closePane(leaf.id)} />
            ) : (
              <TerminalView
                paneId={leaf.id}
                hostId={leaf.hostId}
                host={hostById.get(leaf.hostId)}
                tmux={leaf.tmux}
                visible={visible}
                focused={focused}
                settings={settings}
                theme={theme}
                findToken={findToken}
                onStatus={onStatus}
                onSplit={(dir) => {
                  dispatch({ type: "focusPane", paneId: leaf.id });
                  split(dir);
                }}
                onClose={() => closePane(leaf.id)}
                zoomed={zoomedLeaf === leaf.id}
                onZoom={() => setZoomId(zoomedLeaf === leaf.id ? null : leaf.id)}
                onHostKeyChanged={onHostKeyChanged}
              />
            )}
          </div>
        );
      })}
      {!zoomedLeaf && geometry.dividers.map((d) => (
        <div
          key={d.splitId}
          className={`divider ${d.dir === "H" ? "vertical" : "horizontal"}`}
          role="separator"
          aria-orientation={d.dir === "H" ? "vertical" : "horizontal"}
          aria-label="Resize panes"
          tabIndex={0}
          style={
            d.dir === "H"
              ? { left: pct(d.rect.x + d.rect.w * d.ratio), top: pct(d.rect.y), height: pct(d.rect.h) }
              : { top: pct(d.rect.y + d.rect.h * d.ratio), left: pct(d.rect.x), width: pct(d.rect.w) }
          }
          onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
          onPointerMove={(e) => drag(d, e)}
          onKeyDown={(e) => nudge(d, e)}
        />
      ))}
    </div>
  );
}

function EmptyPane({ hosts, onPick, onClose }: { hosts: Host[]; onPick(host: Host): void; onClose(): void }) {
  return (
    <div className="terminal-pane">
      <div className="pane-head">
        <span className="dot dot-none" aria-hidden="true" />
        <span className="pane-title">
          <strong>Empty pane</strong>
        </span>
        <button type="button" className="icon-btn" aria-label="Close pane" onClick={onClose}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="pane-picker">
        {hosts.length === 0 ? (
          <p className="muted">Add a host in the Hosts panel first.</p>
        ) : (
          <>
            <p className="muted">Choose a host</p>
            <ul className="picker-list">
              {hosts.map((h) => (
                <li key={h.id}>
                  <button type="button" className="btn" onClick={() => onPick(h)}>
                    {h.name}
                    <span className="muted">
                      {h.user}@{h.addr}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
