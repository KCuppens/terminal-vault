import { CanvasAddon } from "@xterm/addon-canvas";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { useEffect, useRef, useState } from "react";

import { getIpc, type Host, type Settings, type SplitDir } from "../ipc";
import { encodeBinaryString, encodeText } from "../lib/base64";
import { errorText } from "../lib/errors";
import { plural } from "../lib/format";
import { effectiveTmux } from "../lib/hostMeta";
import { parseHostKeyChange } from "../lib/hostKeyChanged";
import { countLines, needsPasteConfirm } from "../lib/paste";
import { matchShortcut } from "../lib/shortcuts";
import { TERMINAL_THEMES, terminalFontStack, type ResolvedTheme } from "../lib/theme";
import type { ChangedKey } from "./HostKeyDialogs";
import { Menu } from "./Menu";
import { SearchBar } from "./SearchBar";
import { Icon, Spinner, StatusDot } from "./ui";

export type PaneStatus = "connecting" | "live" | "ended";

interface Props {
  paneId: string;
  hostId: string;
  host: Host | undefined;
  /** Session override chosen at connect time; see `Ipc.sessionOpen`. */
  tmux?: string;
  visible: boolean;
  focused: boolean;
  settings: Settings;
  theme: ResolvedTheme;
  findToken: number;
  onStatus(paneId: string, status: PaneStatus | null): void;
  onSplit(dir: SplitDir): void;
  onClose(): void;
  zoomed?: boolean;
  onZoom?(): void;
  onHostKeyChanged(info: ChangedKey): void;
}

type Status =
  | { state: "connecting" }
  | { state: "live" }
  | { state: "ended"; reason: "lost" | "failed" | "exit" | "blocked"; detail: string | null };

const NO_TMUX_OSC = 777;
const NO_TMUX_PAYLOAD = "tv-no-tmux";

let audio: AudioContext | undefined;

function beep() {
  audio ??= new AudioContext();
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.frequency.value = 880;
  gain.gain.value = 0.05;
  osc.connect(gain).connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + 0.08);
}

function loadRenderer(term: Terminal) {
  try {
    const gl = new WebglAddon();
    gl.onContextLoss(() => {
      gl.dispose();
      term.loadAddon(new CanvasAddon());
    });
    term.loadAddon(gl);
  } catch {
    term.loadAddon(new CanvasAddon());
  }
}

const BANNER_TITLE: Record<"lost" | "failed" | "exit" | "blocked", string> = {
  lost: "Connection lost.",
  failed: "Could not connect.",
  exit: "Session ended.",
  blocked: "Connection blocked.",
};

export function TerminalView({
  paneId,
  hostId,
  host,
  tmux,
  visible,
  focused,
  settings,
  theme,
  findToken,
  onStatus,
  onSplit,
  onClose,
  zoomed,
  onZoom,
  onHostKeyChanged,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const callbacks = useRef({ onHostKeyChanged, onStatus });
  callbacks.current = { onHostKeyChanged, onStatus };
  const flashTimer = useRef<number | undefined>(undefined);
  const handledFind = useRef(findToken);

  const [attempt, setAttempt] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const [status, setStatus] = useState<Status>({ state: "connecting" });
  const [noTmux, setNoTmux] = useState(false);
  const [search, setSearch] = useState<{ addon: SearchAddon | null; open: boolean; key: number }>({
    addon: null,
    open: false,
    key: 0,
  });
  const [pendingPaste, setPendingPaste] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);

  const hostName = host?.name ?? "removed host";

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const current = settingsRef.current;
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: current.cursor_style,
      fontFamily: terminalFontStack(current.font_family),
      fontSize: current.font_size,
      lineHeight: 1.35,
      scrollback: current.scrollback,
      theme: TERMINAL_THEMES[theme],
    });
    const fit = new FitAddon();
    const searchAddon = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(searchAddon);
    term.open(el);
    loadRenderer(term);
    term.attachCustomKeyEventHandler((e) => matchShortcut(e) === null);

    const ipc = getIpc();
    const send = (promise: Promise<void>) => promise.catch(() => undefined);
    const subs = [
      term.onData((d) => {
        if (sessionRef.current) void send(ipc.sessionWrite(sessionRef.current, encodeText(d)));
      }),
      term.onBinary((d) => {
        if (sessionRef.current) void send(ipc.sessionWrite(sessionRef.current, encodeBinaryString(d)));
      }),
      term.onResize(({ cols, rows }) => {
        if (sessionRef.current) void send(ipc.sessionResize(sessionRef.current, cols, rows));
      }),
      term.onBell(() => {
        const mode = settingsRef.current.bell;
        if (mode === "sound") beep();
        if (mode === "visual") {
          setFlash(true);
          clearTimeout(flashTimer.current);
          flashTimer.current = window.setTimeout(() => setFlash(false), 180);
        }
      }),
      term.parser.registerOscHandler(NO_TMUX_OSC, (data) => {
        if (data !== NO_TMUX_PAYLOAD) return false;
        setNoTmux(true);
        return true;
      }),
    ];

    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData("text") ?? "";
      if (!needsPasteConfirm(text)) return;
      e.preventDefault();
      e.stopPropagation();
      setPendingPaste(text);
    };
    el.addEventListener("paste", onPaste, true);

    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (el.clientWidth > 0 && el.clientHeight > 0) fit.fit();
      });
    });
    observer.observe(el);

    termRef.current = term;
    fitRef.current = fit;
    setSearch((s) => ({ ...s, addon: searchAddon }));
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(flashTimer.current);
      observer.disconnect();
      el.removeEventListener("paste", onPaste, true);
      for (const sub of subs) sub.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    term.options.fontFamily = terminalFontStack(settings.font_family);
    term.options.fontSize = settings.font_size;
    term.options.scrollback = settings.scrollback;
    term.options.cursorStyle = settings.cursor_style;
    const frame = requestAnimationFrame(() => {
      const el = hostRef.current;
      if (el && el.clientWidth > 0 && el.clientHeight > 0) fitRef.current?.fit();
    });
    return () => cancelAnimationFrame(frame);
  }, [settings.font_family, settings.font_size, settings.scrollback, settings.cursor_style]);

  useEffect(() => {
    const term = termRef.current;
    if (term) term.options.theme = TERMINAL_THEMES[theme];
  }, [theme]);

  useEffect(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    const ipc = getIpc();
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    let id: string | null = null;
    let wasLive = false;
    setStatus({ state: "connecting" });
    setNoTmux(false);
    term.reset();

    const ended = (reason: "lost" | "failed" | "exit" | "blocked", detail: string | null) => {
      sessionRef.current = null;
      setStatus({ state: "ended", reason, detail });
    };

    (async () => {
      const size = fit.proposeDimensions() ?? { cols: term.cols, rows: term.rows };
      const opened = await ipc.sessionOpen(hostId, size.cols, size.rows, tmux);
      if (cancelled) {
        await ipc.sessionClose(opened).catch(() => undefined);
        return;
      }
      id = opened;
      sessionRef.current = opened;
      unlisten = await ipc.onSession(opened, {
        data: (bytes) => term.write(bytes),
        exit: (code) => ended("exit", code === 0 ? null : `Exit code ${code}.`),
        error: (message) => ended(wasLive ? "lost" : "failed", message),
      });
      if (cancelled) {
        unlisten();
        await ipc.sessionClose(opened).catch(() => undefined);
        return;
      }
      term.reset();
      await ipc.sessionAttach(opened);
      wasLive = true;
      setStatus({ state: "live" });
    })().catch((err: unknown) => {
      if (cancelled) return;
      const message = errorText(err);
      const changed = parseHostKeyChange(message);
      if (changed) {
        ended("blocked", null);
        callbacks.current.onHostKeyChanged({ hostId, hostName, ...changed });
      } else {
        ended("failed", message);
      }
    });

    return () => {
      cancelled = true;
      sessionRef.current = null;
      unlisten?.();
      if (id) void ipc.sessionClose(id).catch(() => undefined);
    };
  }, [hostId, tmux, attempt]);

  useEffect(() => {
    callbacks.current.onStatus(paneId, status.state);
  }, [paneId, status.state]);

  useEffect(() => () => callbacks.current.onStatus(paneId, null), [paneId]);

  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => {
      fitRef.current?.fit();
      if (focused) termRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, focused]);

  useEffect(() => {
    if (findToken === handledFind.current) return;
    handledFind.current = findToken;
    if (visible && focused) setSearch((s) => ({ ...s, open: true, key: s.key + 1 }));
  }, [findToken, visible, focused]);

  function closeSearch() {
    setSearch((s) => ({ ...s, open: false }));
    termRef.current?.focus();
  }

  function openSearch() {
    setSearch((s) => ({ ...s, open: true, key: s.key + 1 }));
  }

  const tmuxName = effectiveTmux(host, tmux);
  const dot = status.state === "live" ? "live" : status.state === "connecting" ? "connecting" : "ended";

  return (
    <div className="terminal-pane">
      <div className={tmuxName || noTmux ? "pane-head compact" : "pane-head"}>
        <StatusDot state={dot} />
        {tmuxName || noTmux ? (
          <span className="pane-title">
            {host ? `${host.user}@${hostName}` : hostName}
            <span className="pane-sep">·</span>
            {noTmux ? "tmux: not installed" : `tmux: ${tmuxName}`}
          </span>
        ) : (
          <>
            <span className="pane-title">
              <strong>{hostName}</strong>
              {host && <span className="pane-addr">{host.addr}</span>}
            </span>
            <span className="chip">ssh</span>
            {host && <span className="chip">{host.user}</span>}
          </>
        )}
        <Menu
          label={`Pane actions for ${hostName}`}
          items={[
            { label: "Split right", icon: "splitH", onSelect: () => onSplit("H") },
            { label: "Split down", icon: "splitV", onSelect: () => onSplit("V") },
            { label: "Search scrollback", icon: "search", onSelect: openSearch },
            { label: "Reconnect", icon: "refresh", onSelect: () => setAttempt((n) => n + 1) },
            { label: "Close pane", icon: "close", separatorBefore: true, onSelect: onClose },
          ]}
        />
        {!tmuxName && !noTmux && onZoom && (
          <button
            type="button"
            className="icon-btn pane-zoom"
            aria-label={zoomed ? "Restore pane" : "Expand pane"}
            aria-pressed={zoomed}
            onClick={onZoom}
          >
            <Icon name="expand" size={18} />
          </button>
        )}
      </div>
      {noTmux && (
        <div className="pane-note" role="note">
          <strong>tmux: command not found</strong>
          <span>This server does not have tmux installed.</span>
        </div>
      )}
      <div
        className={flash ? "terminal-wrap bell-flash" : "terminal-wrap"}
        style={{ background: TERMINAL_THEMES[theme].background }}
      >
        <div className="terminal" ref={hostRef} />
        {search.open && search.addon && <SearchBar key={search.key} addon={search.addon} onClose={closeSearch} />}
        {status.state === "connecting" && (
          <div className="terminal-overlay" role="status">
            <Spinner />
            <p className="overlay-title">Connecting to {hostName}...</p>
            <p className="muted">Establishing SSH connection...</p>
            <button type="button" className="btn small" onClick={onClose}>
              Cancel
            </button>
          </div>
        )}
        {status.state === "ended" && dismissedAt !== attempt && (
          <div className="pane-banner" role="alert">
            <Icon name="alertSolid" size={18} />
            <div className="banner-text">
              <strong>{BANNER_TITLE[status.reason]}</strong>{" "}
              {status.reason === "blocked" ? (
                <span>The server's host key changed. Reconnect to review it.</span>
              ) : (
                <span>
                  {status.detail ? `${status.detail} ` : ""}
                  {tmuxName ? "Reconnecting opens a new tmux window." : "Reconnecting starts a new shell."}
                </span>
              )}
            </div>
            <button type="button" className="btn small reconnect" onClick={() => setAttempt((n) => n + 1)}>
              Reconnect
            </button>
            <button type="button" className="btn small" onClick={onClose}>
              Close pane
            </button>
            <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setDismissedAt(attempt)}>
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
      </div>
      {pendingPaste !== null && (
        <div
          className="paste-card"
          role="alertdialog"
          aria-label={`Paste ${plural(countLines(pendingPaste), "line")}?`}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setPendingPaste(null);
              termRef.current?.focus();
            }
          }}
        >
          <Icon name="clipboard" size={20} />
          <div className="paste-text">
            <strong>Paste {plural(countLines(pendingPaste), "line")}?</strong>
            <span>You are about to paste {plural(countLines(pendingPaste), "line")} into this terminal.</span>
          </div>
          <div className="paste-actions">
            <button
              type="button"
              className="btn"
              onClick={() => {
                setPendingPaste(null);
                termRef.current?.focus();
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn primary"
              autoFocus
              onClick={() => {
                termRef.current?.paste(pendingPaste);
                setPendingPaste(null);
                termRef.current?.focus();
              }}
            >
              Paste
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
