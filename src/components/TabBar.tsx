import type { KeyboardEvent } from "react";

import type { Layout, SplitDir } from "../ipc";
import { arrangement, gridSize, type ArrangeMode, type Pane, type TabState } from "../lib/panes";
import { shortcutKeys } from "../lib/shortcuts";
import { Menu, type MenuItem } from "./Menu";
import { Icon, StatusDot, type DotState, type IconName } from "./ui";

interface Props {
  tabs: TabState[];
  active: string | null;
  tabStates: Record<string, DotState>;
  layouts: Layout[];
  root: Pane | null;
  onArrange(mode: ArrangeMode): void;
  onSelect(tabId: string): void;
  onClose(tabId: string): void;
  onNew(): void;
  onSplit(dir: SplitDir): void;
  onSaveLayout(): void;
  onOpenLayout(layout: Layout): void;
}

const tabDomId = (id: string) => `tab-${id}`;

const ARRANGE: { mode: ArrangeMode; label: string; icon: IconName }[] = [
  { mode: "columns", label: "Side by side", icon: "tileColumns" },
  { mode: "grid", label: "Grid", icon: "grid" },
  { mode: "rows", label: "Stacked", icon: "tileRows" },
];

export function TabBar({
  tabs,
  active,
  tabStates,
  layouts,
  root,
  onArrange,
  onSelect,
  onClose,
  onNew,
  onSplit,
  onSaveLayout,
  onOpenLayout,
}: Props) {
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const index = tabs.findIndex((t) => t.id === active);
    if (index < 0) return;
    let next = index;
    if (e.key === "ArrowRight") next = (index + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    const target = tabs[next];
    if (!target) return;
    onSelect(target.id);
    document.getElementById(tabDomId(target.id))?.focus();
  }

  const hasTab = tabs.length > 0;
  const mode = root ? arrangement(root) : null;
  const size = root ? gridSize(root) : null;
  const items: MenuItem[] = [
    { label: "Split right", icon: "splitH", disabled: !hasTab, onSelect: () => onSplit("H") },
    { label: "Split down", icon: "splitV", disabled: !hasTab, onSelect: () => onSplit("V") },
    { label: "Save layout...", icon: "layout", disabled: !hasTab, onSelect: onSaveLayout },
    ...layouts.map((l, i) => ({
      label: `Open layout: ${l.name}`,
      icon: "layout" as const,
      separatorBefore: i === 0,
      onSelect: () => onOpenLayout(l),
    })),
  ];

  return (
    <div className="tabbar">
      <div className="tabs" role="tablist" aria-label="Terminals" onKeyDown={onKeyDown}>
        {tabs.map((tab) => {
          const selected = tab.id === active;
          return (
            <div key={tab.id} className={selected ? "tab active" : "tab"}>
              <button
                type="button"
                role="tab"
                id={tabDomId(tab.id)}
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                className="tab-label"
                onClick={() => onSelect(tab.id)}
                onAuxClick={(e) => {
                  if (e.button === 1) onClose(tab.id);
                }}
              >
                <StatusDot state={tabStates[tab.id] ?? "none"} />
                <span className="tab-title">{tab.title}</span>
              </button>
              <button
                type="button"
                className="icon-btn tab-close"
                aria-label={`Close tab ${tab.title}`}
                onClick={() => onClose(tab.id)}
              >
                <Icon name="close" size={15} />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="icon-btn tab-new"
          aria-label="New tab"
          title={`New tab (${shortcutKeys("newTab").join("+")})`}
          onClick={onNew}
        >
          <Icon name="plus" size={22} />
        </button>
      </div>
      <div className="arrange" role="group" aria-label="Arrange panes">
        {ARRANGE.map((a) => (
          <button
            key={a.mode}
            type="button"
            className={mode === a.mode ? "arrange-btn active" : "arrange-btn"}
            aria-label={a.label}
            aria-pressed={mode === a.mode}
            disabled={!root}
            onClick={() => onArrange(a.mode)}
          >
            <Icon name={a.icon} size={20} />
          </button>
        ))}
      </div>
      <Menu label="Layout" items={items} className="layout-switch">
        {size ? `${size.cols} × ${size.rows}` : "1 × 1"}
        <Icon name="chevronsUpDown" size={14} />
      </Menu>
    </div>
  );
}
