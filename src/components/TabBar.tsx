import type { Dispatch } from "react";

import type { Action, Workspace } from "../lib/panes";

interface Props {
  workspace: Workspace;
  dispatch: Dispatch<Action>;
  onNewTab(): void;
}

export function TabBar({ workspace, dispatch, onNewTab }: Props) {
  return (
    <div className="tabbar" role="tablist">
      {workspace.tabs.map((t) => (
        <div key={t.id} className={t.id === workspace.active ? "tab active" : "tab"}>
          <button
            role="tab"
            aria-selected={t.id === workspace.active}
            className="tab-title"
            onClick={() => dispatch({ type: "selectTab", tabId: t.id })}
          >
            {t.title}
          </button>
          <button title="Close tab" onClick={() => dispatch({ type: "closeTab", tabId: t.id })}>
            ✕
          </button>
        </div>
      ))}
      <button className="tab-new" title="New tab (Ctrl+Shift+T)" onClick={onNewTab}>
        +
      </button>
    </div>
  );
}
