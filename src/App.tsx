import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import { CommandPalette } from "./components/CommandPalette";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { CreateVault } from "./components/CreateVault";
import { HostForm } from "./components/HostForm";
import { HostKeyChanged, HostKeyTrust, type ChangedKey } from "./components/HostKeyDialogs";
import { HostsPanel } from "./components/HostsPanel";
import { ImportSshConfig } from "./components/ImportSshConfig";
import { KeysPanel } from "./components/KeysPanel";
import { LayoutNameDialog, OpenLayoutDialog } from "./components/LayoutDialogs";
import { LayoutsPanel } from "./components/LayoutsPanel";
import { isModalOpen } from "./components/Modal";
import { PaneTree } from "./components/PaneTree";
import { Rail, type PanelId } from "./components/Rail";
import { ServicesProvider, useServices } from "./components/services";
import { SettingsPage } from "./components/SettingsPage";
import { StatusBar, type OpenTerminal } from "./components/StatusBar";
import { TabBar } from "./components/TabBar";
import { TitleBar } from "./components/TitleBar";
import { TmuxPicker } from "./components/TmuxPicker";
import type { PaneStatus } from "./components/TerminalView";
import { Unlock } from "./components/Unlock";
import { Icon, type DotState } from "./components/ui";
import {
  getIpc,
  type Host,
  type HostKeyPromptInfo,
  type KeyInfo,
  type Layout,
  type Settings,
  type SplitDir,
  type VaultInfo,
} from "./ipc";
import { demoChangedKey, demoScene, SCENE_LAYOUT } from "./ipc/demo";
import { remainingSeconds, showCountdown } from "./lib/autoLock";
import { errorText } from "./lib/errors";
import { missingHostIds, planLayout, pruneLayout, workspaceToLayout } from "./lib/layoutPlan";
import { buildPaletteItems, type ConnectMode, type PaletteItem } from "./lib/palette";
import { emptyWorkspace, leaves, workspaceReducer, type TabState } from "./lib/panes";
import { DEFAULT_SETTINGS } from "./lib/settings";
import { matchShortcut, type ShortcutAction } from "./lib/shortcuts";
import { resolveTheme } from "./lib/theme";

type Phase = "loading" | "locked" | "unlocked" | "failed";
type View = "terminals" | "settings";

type Dialog =
  | { kind: "host"; host: Host | null }
  | { kind: "tmux"; host: Host }
  | { kind: "import" }
  | { kind: "saveLayout" }
  | { kind: "openLayout"; layout: Layout }
  | { kind: "closeWindow"; sessions: number }
  | null;

const DARK_QUERY = "(prefers-color-scheme: dark)";
const MAX_RECENT = 8;
const ACTIVITY_THROTTLE_MS = 1000;
const uuid = () => crypto.randomUUID();

const DOT_PRIORITY: DotState[] = ["ended", "connecting", "live", "none"];

function strongestState(states: DotState[]): DotState {
  return DOT_PRIORITY.find((s) => states.includes(s)) ?? "none";
}

export function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    getIpc()
      .settingsGet()
      .then(setSettings)
      .catch(() => undefined);
  }, []);

  return (
    <ServicesProvider settings={settings}>
      <Shell settings={settings} onSettings={setSettings} />
    </ServicesProvider>
  );
}

function Shell({ settings, onSettings }: { settings: Settings; onSettings(next: Settings): void }) {
  const { toast } = useServices();
  const [phase, setPhase] = useState<Phase>("loading");
  const [vaultExists, setVaultExists] = useState(false);
  const [info, setInfo] = useState<VaultInfo | null>(null);
  const [startError, setStartError] = useState("");
  const [unlockedAt, setUnlockedAt] = useState(() => new Date());

  const [hosts, setHosts] = useState<Host[]>([]);
  const [keys, setKeys] = useState<KeyInfo[]>([]);
  const [layouts, setLayouts] = useState<Layout[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [workspace, dispatch] = useReducer(workspaceReducer, emptyWorkspace);
  const [paneStatus, setPaneStatus] = useState<Record<string, PaneStatus>>({});

  const [view, setView] = useState<View>("terminals");
  const [panel, setPanel] = useState<PanelId | null>("hosts");
  const [keyFilter, setKeyFilter] = useState<KeyInfo | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [findToken, setFindToken] = useState(0);
  const [prompts, setPrompts] = useState<HostKeyPromptInfo[]>([]);
  const [changedKey, setChangedKey] = useState<ChangedKey | null>(demoChangedKey);
  const [lockSeconds, setLockSeconds] = useState<number | null>(null);
  const [prefersDark, setPrefersDark] = useState(() => window.matchMedia(DARK_QUERY).matches);

  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const lastActivity = useRef(Date.now());

  const theme = resolveTheme(settings.theme, prefersDark);

  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY);
    const onChange = () => setPrefersDark(query.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.fontSize = `${(16 * settings.ui_scale) / 100}px`;
  }, [settings.ui_scale]);

  useEffect(() => {
    const ipc = getIpc();
    Promise.all([ipc.vaultExists(), ipc.vaultInfo().catch(() => null)])
      .then(([exists, vaultInfo]) => {
        setVaultExists(exists);
        setInfo(vaultInfo);
        setPhase("locked");
      })
      .catch((err) => {
        setStartError(errorText(err));
        setPhase("failed");
      });
  }, []);

  useEffect(() => {
    const unlisteners: Array<() => void> = [];
    let disposed = false;
    const keep = (u: () => void) => (disposed ? u() : unlisteners.push(u));
    const ipc = getIpc();
    void ipc.onHostKeyPrompt((p) => setPrompts((q) => [...q, p])).then(keep);
    void ipc
      .onHostKeyPromptClosed((id) => setPrompts((q) => q.filter((p) => p.prompt_id !== id)))
      .then(keep);
    return () => {
      disposed = true;
      unlisteners.forEach((u) => u());
    };
  }, []);

  const refresh = useCallback(async () => {
    const ipc = getIpc();
    const [h, k, l] = await Promise.all([ipc.hostsList(), ipc.keysList(), ipc.layoutList()]);
    setHosts(h);
    setKeys(k);
    setLayouts(l);
    setLoaded(true);
  }, []);

  const clearSession = useCallback(() => {
    dispatch({ type: "reset" });
    setHosts([]);
    setKeys([]);
    setLayouts([]);
    setLoaded(false);
    setPrompts([]);
    setChangedKey(null);
    setPaneStatus({});
    setDialog(null);
    setPaletteOpen(false);
    setKeyFilter(null);
    setLockSeconds(null);
    setView("terminals");
  }, []);

  const lock = useCallback(async () => {
    clearSession();
    try {
      await getIpc().vaultLock();
    } catch (err) {
      toast({ message: `Could not lock the vault. ${errorText(err)}`, tone: "error" });
    }
    setPhase("locked");
  }, [clearSession, toast]);

  function onUnlocked() {
    setVaultExists(true);
    setUnlockedAt(new Date());
    lastActivity.current = Date.now();
    const scene = demoScene();
    setPanel(scene === "main" ? null : "hosts");
    setPhase("unlocked");
    refresh()
      .then(async () => {
        if (!scene) return;
        const ipc = getIpc();
        const [h, l] = await Promise.all([ipc.hostsList(), ipc.layoutList()]);
        const layout = l.find((x) => x.name === SCENE_LAYOUT);
        if (layout) openTabs(planLayout(layout, h, uuid));
      })
      .catch((err) => toast({ message: `Could not load the vault. ${errorText(err)}`, tone: "error" }));
  }

  async function onVaultDeleted() {
    clearSession();
    setVaultExists(false);
    setInfo(await getIpc().vaultInfo().catch(() => null));
    setPhase("locked");
  }

  useEffect(() => {
    if (phase !== "unlocked") return;
    let last = 0;
    const touch = () => {
      const now = Date.now();
      if (now - last < ACTIVITY_THROTTLE_MS) return;
      last = now;
      lastActivity.current = now;
    };
    const events = ["mousemove", "mousedown", "keydown", "wheel"] as const;
    events.forEach((name) => window.addEventListener(name, touch, { passive: true }));
    const timer = setInterval(() => {
      const remaining = remainingSeconds(lastActivity.current, Date.now(), settingsRef.current.auto_lock_minutes);
      if (remaining === 0) void lock();
      else setLockSeconds(showCountdown(remaining) ? remaining : null);
    }, 1000);
    return () => {
      events.forEach((name) => window.removeEventListener(name, touch));
      clearInterval(timer);
    };
  }, [phase, lock]);

  useEffect(() => {
    if (phase !== "unlocked") return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    void getIpc()
      .onWindowMinimized(() => {
        if (settingsRef.current.lock_on_minimize) void lock();
      })
      .then((u) => {
        if (disposed) u();
        else unlisten = u;
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [phase, lock]);

  const activeTab = workspace.tabs.find((t) => t.id === workspace.active);

  const currentLayout = useMemo(() => {
    try {
      return workspaceToLayout(workspace, "current", "");
    } catch {
      return null;
    }
  }, [workspace]);

  function newTab() {
    setView("terminals");
    dispatch({ type: "newTab", tabId: uuid(), paneId: uuid() });
  }

  function split(dir: SplitDir) {
    if (!activeTab) return;
    setView("terminals");
    dispatch({ type: "split", dir, splitId: uuid(), paneId: uuid() });
  }

  function showPanel(id: PanelId, toggle: boolean) {
    const wasShown = view === "terminals" && panel === id;
    setView("terminals");
    setPanel(toggle && wasShown ? null : id);
  }

  function toggleSettings() {
    setView((v) => (v === "settings" ? "terminals" : "settings"));
  }

  function missingKey(host: Host): boolean {
    if (host.key_id !== null) return false;
    setDialog({ kind: "host", host });
    toast({ message: `${host.name} has no key. Assign one first.`, tone: "error" });
    return true;
  }

  function assign(paneId: string, host: Host, tmux?: string) {
    if (missingKey(host)) return;
    dispatch({ type: "assignHost", paneId, hostId: host.id, title: host.name, tmux });
  }

  function startSession(host: Host, mode: ConnectMode, tmux?: string) {
    setView("terminals");
    const focused = activeTab && leaves(activeTab.root).find((l) => l.id === activeTab.focus);
    if (mode === "newPane" && activeTab) {
      const paneId = uuid();
      dispatch({ type: "split", dir: "H", splitId: uuid(), paneId });
      assign(paneId, host, tmux);
    } else if (mode !== "newPane" && focused && focused.hostId === null) {
      assign(focused.id, host, tmux);
    } else {
      const paneId = uuid();
      dispatch({ type: "newTab", tabId: uuid(), paneId });
      assign(paneId, host, tmux);
    }
  }

  function connect(host: Host, mode: ConnectMode) {
    if (missingKey(host)) return;
    if (mode === "tmux") setDialog({ kind: "tmux", host });
    else startSession(host, mode);
  }

  function openTabs(tabs: TabState[]) {
    setView("terminals");
    dispatch({ type: "openTabs", tabs });
  }

  function openLayout(layout: Layout) {
    if (missingHostIds(layout, hosts).length > 0) {
      setDialog({ kind: "openLayout", layout });
      return;
    }
    try {
      openTabs(planLayout(layout, hosts, uuid));
    } catch (err) {
      toast({ message: errorText(err), tone: "error" });
    }
  }

  async function saveLayout(name: string) {
    if (!currentLayout) throw new Error("Open a terminal with a host first.");
    const existing = layouts.find((l) => l.name.toLowerCase() === name.toLowerCase());
    await getIpc().layoutSave({ ...currentLayout, id: existing?.id ?? uuid(), name });
    await refresh();
    toast({ message: `Saved layout ${name}.`, tone: "success" });
  }

  async function decidePrompt(accept: boolean) {
    const [current] = prompts;
    if (!current) return;
    setPrompts((q) => q.slice(1));
    try {
      await getIpc().hostKeyConfirm(current.prompt_id, accept);
    } catch {
      // The prompt already timed out; it is gone from the queue either way.
    }
  }

  const onStatus = useCallback((paneId: string, status: PaneStatus | null) => {
    setPaneStatus((prev) => {
      if ((prev[paneId] ?? null) === status) return prev;
      const next = { ...prev };
      if (status === null) delete next[paneId];
      else next[paneId] = status;
      return next;
    });
  }, []);

  function runShortcut(action: ShortcutAction) {
    switch (action) {
      case "palette":
        setPaletteOpen((open) => !open);
        break;
      case "settings":
        toggleSettings();
        break;
      case "lock":
        void lock();
        break;
      case "newTab":
        newTab();
        break;
      case "splitRight":
        split("H");
        break;
      case "splitDown":
        split("V");
        break;
      case "closePane":
        if (view === "terminals") dispatch({ type: "closePane" });
        break;
      case "find":
        if (view === "terminals" && activeTab) setFindToken((t) => t + 1);
        break;
      case "openHosts":
        showPanel("hosts", false);
        break;
      case "openKeys":
        showPanel("keys", false);
        break;
      case "openLayouts":
        showPanel("layouts", false);
        break;
      case "saveLayout":
        if (currentLayout) setDialog({ kind: "saveLayout" });
        else toast({ message: "Open a terminal with a host first.", tone: "info" });
        break;
    }
  }

  function runPaletteItem(item: PaletteItem) {
    setPaletteOpen(false);
    const id = item.id.replace(/^recent:/, "");
    setRecentIds((ids) => [id, ...ids.filter((x) => x !== id)].slice(0, MAX_RECENT));
    const { action } = item;
    if (action.type === "connect") {
      const host = hosts.find((h) => h.id === action.hostId);
      if (host) connect(host, action.mode);
    } else if (action.type === "openLayout") {
      const layout = layouts.find((l) => l.id === action.layoutId);
      if (layout) openLayout(layout);
    } else if (action.type === "shortcut") {
      runShortcut(action.action);
    } else {
      setDialog({ kind: "host", host: null });
    }
  }

  const keyHandler = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyHandler.current = (e) => {
    if (e.key === "Escape" && view === "settings" && !paletteOpen && !isModalOpen()) {
      setView("terminals");
      return;
    }
    const action = matchShortcut(e);
    if (action === null) return;
    if (isModalOpen()) return;
    if (paletteOpen && action !== "palette") return;
    e.preventDefault();
    runShortcut(action);
  };

  useEffect(() => {
    if (phase !== "unlocked") return;
    const onKey = (e: KeyboardEvent) => keyHandler.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  const paletteItems = useMemo(() => buildPaletteItems({ hosts, layouts }), [hosts, layouts]);

  const hostName = useMemo(() => new Map(hosts.map((h) => [h.id, h.name])), [hosts]);

  const { terminals, tabStates, hostStates } = useMemo(() => {
    const open: (OpenTerminal & { hostId: string })[] = [];
    const byTab: Record<string, DotState> = {};
    for (const tab of workspace.tabs) {
      const tabPanes = leaves(tab.root).filter((l) => l.hostId !== null);
      for (const l of tabPanes) {
        open.push({
          paneId: l.id,
          hostId: l.hostId ?? "",
          name: hostName.get(l.hostId ?? "") ?? "Unknown host",
          state: paneStatus[l.id] ?? "none",
        });
      }
      byTab[tab.id] = strongestState(tabPanes.map((l) => paneStatus[l.id] ?? "none"));
    }
    const byHost: Record<string, DotState> = {};
    for (const t of open) byHost[t.hostId] = strongestState([byHost[t.hostId] ?? "none", t.state]);
    return { terminals: open, tabStates: byTab, hostStates: byHost };
  }, [workspace.tabs, paneStatus, hostName]);

  const statusTerminals = useMemo(() => {
    const ids = new Set(activeTab ? leaves(activeTab.root).map((l) => l.id) : []);
    return terminals.filter((t) => ids.has(t.paneId));
  }, [terminals, activeTab]);

  function requestClose() {
    const sessions = terminals.filter((t) => t.state === "live" || t.state === "connecting").length;
    if (sessions === 0) void getIpc().windowClose();
    else setDialog({ kind: "closeWindow", sessions });
  }

  function focusTerminal(paneId: string) {
    setView("terminals");
    dispatch({ type: "focusPane", paneId });
  }

  function saveSettings(next: Settings) {
    const previous = settings;
    onSettings(next);
    getIpc()
      .settingsSave(next)
      .then(onSettings)
      .catch((err) => {
        onSettings(previous);
        toast({ message: `Could not save settings. ${errorText(err)}`, tone: "error" });
      });
  }

  const unlocked = phase === "unlocked";
  const trust = prompts[0];

  return (
    <div className="app-shell">
      <TitleBar
        unlocked={unlocked}
        onPalette={() => setPaletteOpen(true)}
        onLock={() => void lock()}
        onMinimize={() => void getIpc().windowMinimize()}
        onToggleMaximize={() => void getIpc().windowToggleMaximize()}
        onClose={unlocked ? requestClose : () => void getIpc().windowClose()}
      />
      {phase === "loading" && <div className="auth-screen" aria-busy="true" />}
      {phase === "failed" && (
        <div className="auth-screen">
          <div className="auth-card" role="alert">
            <h1>Could not start</h1>
            <p className="error-text">{startError}</p>
          </div>
        </div>
      )}
      {phase === "locked" &&
        (vaultExists ? (
          <Unlock info={info} onUnlocked={onUnlocked} />
        ) : (
          <CreateVault info={info} onCreated={onUnlocked} />
        ))}
      {unlocked && (
        <>
          <div className="workbench">
            <Rail
              panel={panel}
              settingsOpen={view === "settings"}
              onPanel={(id) => showPanel(id, true)}
              onSettings={toggleSettings}
            />
            {view === "terminals" && panel && (
              <aside className="side-panel">
                {panel === "hosts" && (
                  <HostsPanel
                    hosts={hosts}
                    keys={keys}
                    loaded={loaded}
                    hostStates={hostStates}
                    keyFilter={keyFilter}
                    onClearKeyFilter={() => setKeyFilter(null)}
                    onAdd={() => setDialog({ kind: "host", host: null })}
                    onEdit={(host) => setDialog({ kind: "host", host })}
                    onConnect={connect}
                    onImport={() => setDialog({ kind: "import" })}
                    onChanged={refresh}
                  />
                )}
                {panel === "keys" && (
                  <KeysPanel
                    keys={keys}
                    hosts={hosts}
                    loaded={loaded}
                    onChanged={refresh}
                    onShowHosts={(key) => {
                      setKeyFilter(key);
                      showPanel("hosts", false);
                    }}
                  />
                )}
                {panel === "layouts" && (
                  <LayoutsPanel
                    layouts={layouts}
                    hosts={hosts}
                    loaded={loaded}
                    canSave={currentLayout !== null}
                    onSaveCurrent={() => setDialog({ kind: "saveLayout" })}
                    onOpen={openLayout}
                    onChanged={refresh}
                  />
                )}
              </aside>
            )}
            <main className="main">
              <TabBar
                tabs={workspace.tabs}
                active={workspace.active}
                tabStates={tabStates}
                layouts={layouts}
                root={activeTab?.root ?? null}
                onArrange={(mode) =>
                  activeTab &&
                  dispatch({
                    type: "arrange",
                    mode,
                    splitIds: Array.from({ length: leaves(activeTab.root).length - 1 }, uuid),
                  })
                }
                onSelect={(tabId) => {
                  setView("terminals");
                  dispatch({ type: "selectTab", tabId });
                }}
                onClose={(tabId) => dispatch({ type: "closeTab", tabId })}
                onNew={newTab}
                onSplit={split}
                onSaveLayout={() => setDialog({ kind: "saveLayout" })}
                onOpenLayout={openLayout}
              />
              <div className="stage">
                {workspace.tabs.map((t) => (
                  <PaneTree
                    key={t.id}
                    tab={t}
                    visible={view === "terminals" && t.id === workspace.active}
                    hosts={hosts}
                    settings={settings}
                    theme={theme}
                    findToken={findToken}
                    dispatch={dispatch}
                    onAssign={(paneId, host) => assign(paneId, host)}
                    onStatus={onStatus}
                    onHostKeyChanged={setChangedKey}
                  />
                ))}
                {view === "terminals" && workspace.tabs.length === 0 && (
                  <div className="stage-empty">
                    <Icon name="terminal" size={32} />
                    <p className="empty-title">No terminals open</p>
                    <p className="muted">Pick a host from the list, or open a new tab.</p>
                    <div className="empty-actions">
                      <button type="button" className="btn primary" onClick={newTab}>
                        New tab
                      </button>
                      <button type="button" className="btn" onClick={() => showPanel("hosts", false)}>
                        Show hosts
                      </button>
                    </div>
                  </div>
                )}
                {view === "settings" && (
                  <SettingsPage
                    settings={settings}
                    info={info}
                    onSave={saveSettings}
                    onVaultDeleted={() => void onVaultDeleted()}
                    onClose={() => setView("terminals")}
                  />
                )}
              </div>
            </main>
          </div>
          <StatusBar
            terminals={statusTerminals}
            unlockedAt={unlockedAt}
            lockSeconds={lockSeconds}
            onFocusPane={focusTerminal}
            onSettings={toggleSettings}
          />
        </>
      )}

      {unlocked && paletteOpen && (
        <CommandPalette items={paletteItems} recentIds={recentIds} onRun={runPaletteItem} onClose={() => setPaletteOpen(false)} />
      )}
      {unlocked && dialog?.kind === "host" && (
        <HostForm host={dialog.host} keys={keys} onSaved={refresh} onClose={() => setDialog(null)} />
      )}
      {unlocked && dialog?.kind === "tmux" && (
        <TmuxPicker
          host={dialog.host}
          onChoose={(tmux) => {
            const host = dialog.host;
            setDialog(null);
            startSession(host, "default", tmux);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {unlocked && dialog?.kind === "import" && (
        <ImportSshConfig
          hosts={hosts}
          keys={keys}
          onImported={async (count) => {
            await refresh();
            if (count > 0) toast({ message: `Imported ${count} ${count === 1 ? "host" : "hosts"}.`, tone: "success" });
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {unlocked && dialog?.kind === "saveLayout" && currentLayout && (
        <LayoutNameDialog
          title="Save current layout"
          confirmLabel="Save layout"
          initial=""
          existingNames={layouts.map((l) => l.name)}
          preview={currentLayout}
          hosts={hosts}
          onSubmit={saveLayout}
          onClose={() => setDialog(null)}
        />
      )}
      {unlocked && dialog?.kind === "openLayout" && (
        <OpenLayoutDialog
          layout={dialog.layout}
          hosts={hosts}
          onOpen={() => {
            const pruned = pruneLayout(dialog.layout, hosts);
            setDialog(null);
            try {
              openTabs(planLayout(pruned, hosts, uuid));
            } catch (err) {
              toast({ message: errorText(err), tone: "error" });
            }
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {unlocked && dialog?.kind === "closeWindow" && (
        <ConfirmDialog
          title="Close Terminal Vault?"
          message={`${dialog.sessions} ${dialog.sessions === 1 ? "session" : "sessions"} will end.`}
          confirmLabel="Close"
          danger
          onConfirm={() => getIpc().windowClose()}
          onClose={() => setDialog(null)}
        />
      )}
      {unlocked && trust && (
        <HostKeyTrust
          key={trust.prompt_id}
          prompt={trust}
          position={1}
          total={prompts.length}
          onDecide={decidePrompt}
        />
      )}
      {unlocked && changedKey && (
        <HostKeyChanged info={changedKey} onClose={() => setChangedKey(null)} onForgotten={() => setChangedKey(null)} />
      )}
    </div>
  );
}
