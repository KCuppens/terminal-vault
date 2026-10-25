import { useEffect, useRef, useState } from "react";
import { CanvasAddon } from "@xterm/addon-canvas";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { getIpc } from "../ipc";
import { encodeBinaryString, encodeText } from "../lib/base64";
import { matchShortcut } from "../lib/shortcuts";

interface Props {
  hostId: string;
  visible: boolean;
  focused: boolean;
  onFocus(): void;
}

type Status = { state: "connecting" } | { state: "live" } | { state: "ended"; message: string };

const THEME = {
  background: "#0f1115",
  foreground: "#d7dae0",
  cursor: "#7aa2f7",
  selectionBackground: "#33467c",
};

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

export function TerminalView({ hostId, visible, focused, onFocus }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<Status>({ state: "connecting" });

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: '"Cascadia Mono", Consolas, "DejaVu Sans Mono", monospace',
      fontSize: 14,
      scrollback: 5000,
      theme: THEME,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    loadRenderer(term);
    term.attachCustomKeyEventHandler((e) => matchShortcut(e) === null);

    const ipc = getIpc();
    const send = (promise: Promise<void>) => promise.catch(() => undefined);
    const dataSub = term.onData((d) => {
      if (sessionRef.current) void send(ipc.sessionWrite(sessionRef.current, encodeText(d)));
    });
    const binSub = term.onBinary((d) => {
      if (sessionRef.current) void send(ipc.sessionWrite(sessionRef.current, encodeBinaryString(d)));
    });
    const resizeSub = term.onResize(({ cols, rows }) => {
      if (sessionRef.current) void send(ipc.sessionResize(sessionRef.current, cols, rows));
    });

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
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      dataSub.dispose();
      binSub.dispose();
      resizeSub.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, []);

  useEffect(() => {
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    const ipc = getIpc();
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    let id: string | null = null;
    setStatus({ state: "connecting" });
    term.reset();
    term.write("Connecting…\r\n");

    const ended = (message: string) => {
      sessionRef.current = null;
      term.write(`\r\n\x1b[2m[${message}]\x1b[0m\r\n`);
      setStatus({ state: "ended", message });
    };

    (async () => {
      const size = fit.proposeDimensions() ?? { cols: term.cols, rows: term.rows };
      const opened = await ipc.sessionOpen(hostId, size.cols, size.rows);
      if (cancelled) {
        await ipc.sessionClose(opened).catch(() => undefined);
        return;
      }
      id = opened;
      sessionRef.current = opened;
      unlisten = await ipc.onSession(opened, {
        data: (bytes) => term.write(bytes),
        exit: (code) => ended(`process exited with code ${code}`),
        error: (message) => ended(message),
      });
      if (cancelled) {
        unlisten();
        await ipc.sessionClose(opened).catch(() => undefined);
        return;
      }
      term.reset();
      await ipc.sessionAttach(opened);
      setStatus({ state: "live" });
    })().catch((err: unknown) => {
      if (!cancelled) ended(String(err));
    });

    return () => {
      cancelled = true;
      sessionRef.current = null;
      unlisten?.();
      if (id) void ipc.sessionClose(id).catch(() => undefined);
    };
  }, [hostId, attempt]);

  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => {
      fitRef.current?.fit();
      if (focused) termRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, focused]);

  return (
    <div className="terminal-wrap" onMouseDown={onFocus}>
      <div className="terminal" ref={hostRef} />
      {status.state === "ended" && (
        <div className="terminal-overlay">
          <button className="primary" onClick={() => setAttempt((n) => n + 1)}>
            Reconnect
          </button>
        </div>
      )}
    </div>
  );
}
