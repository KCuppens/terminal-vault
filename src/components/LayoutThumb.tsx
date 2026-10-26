import type { Host, Layout, PaneNode } from "../ipc";
import { countPanes, thumbRects } from "../lib/layoutThumb";
import { plural } from "../lib/format";
import { layoutHostIds } from "../lib/layoutPlan";
import { Icon } from "./ui";

const WIDTH = 60;
const HEIGHT = 60;

export function PaneThumb({ root }: { root: PaneNode }) {
  return (
    <svg className="lthumb" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={plural(countPanes(root), "pane")}>
      {thumbRects(root, 0.07).map((r, i) => (
        <rect key={i} x={r.x * WIDTH} y={r.y * HEIGHT} width={r.w * WIDTH} height={r.h * HEIGHT} rx={1.5} />
      ))}
    </svg>
  );
}

export function LayoutThumb({ layout }: { layout: Layout }) {
  const first = layout.tabs[0];
  if (!first) return <span className="lthumb empty-thumb" />;
  return <PaneThumb root={first.root} />;
}

export function HostChip({ host }: { host: Host | undefined }) {
  return (
    <span className="hchip">
      <span className={host?.key_id ? "hdot on" : "hdot"} />
      {host?.name ?? "missing host"}
    </span>
  );
}

function tabLabel(tab: Layout["tabs"][number], names: Map<string, Host>): string {
  const id = layoutHostIds(tab.root)[0];
  return (id && names.get(id)?.name) || tab.title;
}

function sessionText(host: Host | undefined): string {
  if (!host) return "host not found";
  return host.tmux_session ? `tmux: ${host.tmux_session}` : "plain shell";
}

function prune(node: PaneNode, known: Map<string, Host>): PaneNode | null {
  if (node.type === "terminal") return known.has(node.host_id) ? node : null;
  const a = prune(node.a, known);
  const b = prune(node.b, known);
  if (a && b) return { ...node, a, b };
  return a ?? b;
}

export function LayoutPreview({ layout, hosts, height = 210 }: { layout: Layout; hosts: Host[]; height?: number }) {
  const byId = new Map(hosts.map((h) => [h.id, h]));
  const tabs = layout.tabs.flatMap((tab) => {
    const root = prune(tab.root, byId);
    return root ? [{ ...tab, root }] : [];
  });
  const first = tabs[0];
  const leaves: string[] = first ? layoutHostIds(first.root) : [];
  const rects = first ? thumbRects(first.root, 0.03) : [];
  return (
    <div className="lpreview" role="img" aria-label="Preview">
      <div className="lpv-tabs">
        {tabs.map((tab, i) => {
          const host = byId.get(layoutHostIds(tab.root)[0] ?? "");
          return (
            <span key={i} className={i === 0 ? "lpv-tab active" : "lpv-tab"}>
              <span className={host?.key_id ? "hdot on" : "hdot"} />
              {tabLabel(tab, byId)}
              <Icon name="close" size={14} />
            </span>
          );
        })}
        <span className="lpv-plus">
          <Icon name="plus" size={18} />
        </span>
      </div>
      <div className="lpv-panes" style={{ height }}>
        {rects.map((r, i) => {
          const host = byId.get(leaves[i] ?? "");
          return (
            <div
              key={i}
              className="lpv-pane"
              style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}
            >
              <span className="lpv-host">
                <span className={host?.key_id ? "hdot on" : "hdot"} />
                {host?.name ?? "missing host"}
              </span>
              <span className="lpv-sess">{sessionText(host)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
