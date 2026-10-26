import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { Settings } from "../ipc";
import { ClipboardCleaner } from "../lib/clipboard";
import { DEFAULT_SETTINGS } from "../lib/settings";
import { Icon } from "./ui";

export type ToastTone = "info" | "success" | "error";

export interface ToastAction {
  label: string;
  run(): void;
}

export interface ToastInput {
  message: string;
  detail?: string;
  tone?: ToastTone;
  actions?: ToastAction[];
  seconds?: number;
}

interface ToastItem extends ToastInput {
  id: number;
}

interface Services {
  toast(input: ToastInput): number;
  dismissToast(id: number): void;
  copy(text: string, options?: { sensitive?: boolean; label?: string }): Promise<boolean>;
  settings: Settings;
}

const ServicesContext = createContext<Services | null>(null);

export function useServices(): Services {
  const value = useContext(ServicesContext);
  if (!value) throw new Error("useServices outside ServicesProvider");
  return value;
}

const DEFAULT_TOAST_SECONDS = 5;

export function ServicesProvider({ settings, children }: { settings: Settings | null; children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const cleaner = useRef<ClipboardCleaner | null>(null);
  const effective = settings ?? DEFAULT_SETTINGS;
  const clearSeconds = useRef(effective.clipboard_clear_seconds);
  clearSeconds.current = effective.clipboard_clear_seconds;

  const dismissToast = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);

  const toast = useCallback((input: ToastInput) => {
    const id = nextId.current++;
    setToasts((all) => [...all.slice(-3), { ...input, id }]);
    return id;
  }, []);

  const copy = useCallback<Services["copy"]>(
    async (text, options) => {
      try {
        cleaner.current ??= new ClipboardCleaner(navigator.clipboard);
        const seconds = options?.sensitive ? clearSeconds.current : 0;
        await cleaner.current.copy(text, seconds);
        const tail = seconds > 0 ? `Clipboard clears in ${seconds} seconds.` : undefined;
        toast({ message: options?.label ?? "Copied.", detail: tail, tone: "success", seconds: 3 });
        return true;
      } catch {
        toast({ message: "Could not copy to the clipboard.", tone: "error" });
        return false;
      }
    },
    [toast],
  );

  const value = useMemo<Services>(
    () => ({ toast, dismissToast, copy, settings: effective }),
    [toast, dismissToast, copy, effective],
  );

  return (
    <ServicesContext.Provider value={value}>
      {children}
      <div className="toasts" role="region" aria-label="Notifications">
        {toasts.map((t) => (
          <ToastView key={t.id} toast={t} onDismiss={() => dismissToast(t.id)} />
        ))}
      </div>
    </ServicesContext.Provider>
  );
}

function ToastView({ toast, onDismiss }: { toast: ToastItem; onDismiss(): void }) {
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const seconds = toast.seconds ?? DEFAULT_TOAST_SECONDS;

  useEffect(() => {
    const timer = setTimeout(() => dismissRef.current(), seconds * 1000);
    return () => clearTimeout(timer);
  }, [seconds]);

  const tone = toast.tone ?? "info";
  return (
    <div className={`toast toast-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <div className="toast-text">
        <span className="toast-message">{toast.message}</span>
        {toast.detail && <span className="toast-detail">{toast.detail}</span>}
      </div>
      {toast.actions?.map((a) => (
        <button
          key={a.label}
          type="button"
          className="toast-action"
          onClick={() => {
            a.run();
            onDismiss();
          }}
        >
          {a.label}
        </button>
      ))}
      <button type="button" className="icon-btn" aria-label="Dismiss notification" onClick={onDismiss}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

export function PathLine({ label, path }: { label: string; path: string }) {
  const { copy } = useServices();
  return (
    <div className="path-line">
      <span className="path-label">{label}</span>
      <code className="path-text" title={path}>
        {path}
      </code>
      <button type="button" className="icon-btn" aria-label="Copy path" onClick={() => void copy(path, { label: "Path copied." })}>
        <Icon name="copy" />
      </button>
    </div>
  );
}
