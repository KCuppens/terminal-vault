import { useCallback, useEffect, useReducer, useState } from "react";

import { HostKeyPrompt } from "./components/HostKeyPrompt";
import { HostList } from "./components/HostList";
import { KeyManager } from "./components/KeyManager";
import { LayoutBar } from "./components/LayoutBar";
import { PaneTree } from "./components/PaneTree";
import { TabBar } from "./components/TabBar";
import { Unlock } from "./components/Unlock";
import { getIpc, type Host, type HostKeyPromptInfo, type KeyInfo, type Layout } from "./ipc";
import { planLayout, workspaceToLayout } from "./lib/layoutPlan";
import { emptyWorkspace, leaves, workspaceReducer } from "./lib/panes";
import { matchShortcut } from "./lib/shortcuts";

type Phase = "loading" | "locked" | "unlocked";

export function App() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [vaultExists, setVaultExists] = useState(false);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [layouts, setLayouts] = useState<Layout[]>([]);
  const [workspace, dispatch] = useReducer(workspaceReducer, emptyWorkspace);
  const [prompts, setPrompts] = useState<HostKeyPromptInfo[]>([]);
  const [layoutError, setLayoutError] = useState<string | null>(null);

  useEffect(() => {
    getIpc()
      .vaultExists()
      .then((exists) => {
        setVaultExists(exists);
        setPhase("locked");
      });
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let disposed = false;
    void getIpc()
      .onHostKeyPrompt((p) => setPrompts((q) => [...q, p]))
      .then((u) => (disposed ? u() : (unlisten = u)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const refresh = useCallback(async () => {
    const ipc = getIpc();
    const [h, k, l] = await Promise.all([ipc.hostsList(), ipc.keysList(), ipc.layoutList()]);
    setHosts(h);
    setKeys(k);
    setLayouts(l);
  }, []);

  const newTab = useCallback(() => {
    dispatch({ type: "newTab", tabId: crypto.randomUUID(), paneId: crypto.randomUUID() });
  }, []);

  useEffect(() => {
    if (phase !== "unlocked") return;
    const onKey = (e: KeyboardEvent) => {
      const action = matchShortcut(e);
      if (action === null) return;
      e.preventDefault();
      if (action === "newTab") newTab();
      else if (action === "closePane") dispatch({ type: "closePane" });
      else {
        dispatch({
          type: "split",
          dir: action === "splitRight" ? "H" : "V",
          splitId: crypto.randomUUID(),
          paneId: crypto.randomUUID(),
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, newTab]);

  async function onUnlocked() {
    await refresh();
    setVaultExists(true);
    setPhase("unlocked");
  }

  async function lock() {
    dispatch({ type: "reset" });
    await getIpc().vaultLock();
    setHosts([]);
    setKeys([]);
    setLayouts([]);
    setPrompts([]);
    setPhase("locked");
  }

  function connect(host: Host) {
    const active = workspace.tabs.find((t) => t.id === workspace.active);
    const target = active && leaves(active.root).find((l) => l.id === active.focus && l.hostId === null);
    let paneId = target?.id;
    if (!paneId) {
      paneId = crypto.randomUUID();
      dispatch({ type: "newTab", tabId: crypto.randomUUID(), paneId });
    }
    dispatch({ type: "assignHost", paneId, hostId: host.id, title: host.name });
  }

  async function saveLayout(name: string) {
    try {
      const existing = layouts.find((l) => l.name.toLowerCase() === name.toLowerCase());
      const layout = workspaceToLayout(workspace, existing?.id ?? crypto.randomUUID(), name);
      await getIpc().layoutSave(layout);
      setLayouts(await getIpc().layoutList());
      setLayoutError(null);
    } catch (err) {
      setLayoutError(String(err instanceof Error ? err.message : err));
    }
  }

  function openLayout(layout: Layout) {
    try {
      dispatch({ type: "openTabs", tabs: planLayout(layout, hosts, () => crypto.randomUUID()) });
      setLayoutError(null);
    } catch (err) {
      setLayoutError(String(err instanceof Error ? err.message : err));
    }
  }

  async function removeLayout(layout: Layout) {
    await getIpc().layoutRemove(layout.id);
    setLayouts(await getIpc().layoutList());
  }

  function answerPrompt(accept: boolean) {
    const [current] = prompts;
    if (!current) return;
    setPrompts((q) => q.slice(1));
    void getIpc().hostKeyConfirm(current.prompt_id, accept);
  }

  if (phase === "loading") return null;
  if (phase === "locked") return <Unlock exists={vaultExists} onUnlocked={onUnlocked} />;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="row between brand">
          <h1>Terminal Vault</h1>
          <button onClick={lock} title="Lock the vault and close all sessions">
            Lock
          </button>
        </div>
        <HostList hosts={hosts} keys={keys} onChanged={refresh} onConnect={connect} />
        <KeyManager keys={keys} onChanged={refresh} />
      </aside>
      <main className="main">
        <LayoutBar
          layouts={layouts}
          onSave={saveLayout}
          onOpen={openLayout}
          onRemove={removeLayout}
          error={layoutError}
        />
        <TabBar workspace={workspace} dispatch={dispatch} onNewTab={newTab} />
        <div className="stage">
          {workspace.tabs.map((t) => (
            <PaneTree key={t.id} tab={t} visible={t.id === workspace.active} hosts={hosts} dispatch={dispatch} />
          ))}
          {workspace.tabs.length === 0 && (
            <div className="center-screen muted">
              <p>
                Pick a host or press Ctrl+Shift+T for a new tab.
                <br />
                Ctrl+Shift+D splits right, Ctrl+Alt+Shift+D splits down, Ctrl+Shift+W closes the pane.
              </p>
            </div>
          )}
        </div>
      </main>
      {prompts[0] && <HostKeyPrompt prompt={prompts[0]} onAnswer={answerPrompt} />}
    </div>
  );
}
