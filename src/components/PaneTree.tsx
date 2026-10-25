import { useMemo, useRef, type Dispatch, type KeyboardEvent, type PointerEvent } from "react";

import type { Host, SplitDir } from "../ipc";
import { computeGeometry, type Action, type Divider, type Rect, type TabState } from "../lib/panes";
import { TerminalView } from "./TerminalView";

interface Props {
  tab: TabState;
  visible: boolean;
  hosts: Host[];
  dispatch: Dispatch<Action>;
}

const pct = (n: number) => `${n * 100}%`;

const rectStyle = (r: Rect) => ({ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) });

const KEY_STEP = 0.02;

export function PaneTree({ tab, visible, hosts, dispatch }: Props) {
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

  return (
    <div className="pane-area" ref={containerRef} hidden={!visible}>
      {geometry.leaves.map((leaf) => {
        const host = leaf.hostId === null ? null : hostById.get(leaf.hostId);
        const focused = tab.focus === leaf.id;
        return (
          <div
            key={leaf.id}
            className={focused ? "pane focused" : "pane"}
            style={rectStyle(leaf.rect)}
            onMouseDown={() => dispatch({ type: "focusPane", paneId: leaf.id })}
          >
            <div className="pane-head">
              <span className="pane-title">{host ? `${host.user}@${host.name}` : "Empty pane"}</span>
              <button title="Split right (Ctrl+Shift+D)" onClick={() => split("H")}>
                ▥
              </button>
              <button title="Split down (Alt+Ctrl+Shift+D)" onClick={() => split("V")}>
                ▤
              </button>
              <button title="Close pane (Ctrl+Shift+W)" onClick={() => dispatch({ type: "closePane", paneId: leaf.id })}>
                ✕
              </button>
            </div>
            <div className="pane-body">
              {leaf.hostId === null ? (
                <HostPicker
                  hosts={hosts}
                  onPick={(h) => dispatch({ type: "assignHost", paneId: leaf.id, hostId: h.id, title: h.name })}
                />
              ) : (
                <TerminalView
                  hostId={leaf.hostId}
                  visible={visible}
                  focused={focused}
                  onFocus={() => dispatch({ type: "focusPane", paneId: leaf.id })}
                />
              )}
            </div>
          </div>
        );
      })}
      {geometry.dividers.map((d) => (
        <div
          key={d.splitId}
          className={`divider ${d.dir === "H" ? "vertical" : "horizontal"}`}
          role="separator"
          aria-orientation={d.dir === "H" ? "vertical" : "horizontal"}
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

function HostPicker({ hosts, onPick }: { hosts: Host[]; onPick(host: Host): void }) {
  if (hosts.length === 0) return <p className="muted picker">Add a host in the sidebar first.</p>;
  return (
    <div className="picker">
      <p className="muted">Choose a host</p>
      {hosts.map((h) => (
        <button key={h.id} onClick={() => onPick(h)}>
          {h.name} <small>{h.user}@{h.addr}</small>
        </button>
      ))}
    </div>
  );
}
