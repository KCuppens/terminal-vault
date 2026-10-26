import { useId, useState, type ReactNode } from "react";

import { version } from "../../package.json";
import { getIpc, type Settings, type VaultInfo } from "../ipc";
import { errorText } from "../lib/errors";
import {
  AUTO_LOCK_MINUTES,
  BELL_CHOICES,
  CLIPBOARD_SECONDS,
  CURSOR_CHOICES,
  FONT_FAMILIES,
  FONT_SIZES,
  SCROLLBACK_LINES,
  THEME_CHOICES,
  UI_SCALES,
  autoLockLabel,
  clipboardLabel,
  scaleLabel,
  withCurrent,
  type Choice,
} from "../lib/settings";
import { terminalFontStack } from "../lib/theme";
import { useServices } from "./services";
import { ChangePassphraseDialog, DeleteVaultDialog } from "./VaultDialogs";
import { Icon, Segmented, Spinner, Switch } from "./ui";

interface Props {
  settings: Settings;
  info: VaultInfo | null;
  onSave(next: Settings): void;
  onVaultDeleted(): void;
  onClose(): void;
}

function numberChoices(values: number[], current: number, label: (n: number) => string): Choice<number>[] {
  return withCurrent(values, current).map((value) => ({ value, label: label(value) }));
}

type SectionIcon = "shield" | "terminalBox" | "sliders" | "rack" | "info";

function Section({ title, icon, desc, children }: { title: string; icon: SectionIcon; desc: string; children: ReactNode }) {
  return (
    <section className="sx-sec">
      <div className="sx-side">
        <Icon name={icon} size={22} />
        <div>
          <h2>{title}</h2>
          <p>{desc}</p>
        </div>
      </div>
      <div className="sx-body">{children}</div>
    </section>
  );
}

function Row({ label, hint, htmlFor, wide, children }: { label: string; hint?: string; htmlFor?: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? "sx-row wide" : "sx-row"}>
      <div className="sx-text">
        <label htmlFor={htmlFor}>{label}</label>
        {hint && <p className="hint">{hint}</p>}
      </div>
      <div className="sx-ctl">{children}</div>
    </div>
  );
}

function SelectField<V extends string | number>({
  id,
  value,
  options,
  onChange,
}: {
  id: string;
  value: V;
  options: Choice<V>[];
  onChange(value: V): void;
}) {
  return (
    <select
      id={id}
      className="input select"
      value={String(value)}
      onChange={(e) => {
        const picked = options.find((o) => String(o.value) === e.target.value);
        if (picked) onChange(picked.value);
      }}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

type Dialog = "passphrase" | "delete" | null;

export function SettingsPage({ settings, info, onSave, onVaultDeleted, onClose }: Props) {
  const { toast, copy } = useServices();
  const ids = useId();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState<"backup" | "export" | null>(null);

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => onSave({ ...settings, [key]: value });

  async function writeFile(kind: "backup" | "export") {
    setBusy(kind);
    try {
      const ipc = getIpc();
      const path = kind === "backup" ? (await ipc.vaultBackup()).path : await ipc.hostsExport();
      toast({
        message: kind === "backup" ? "Vault backed up." : "Hosts exported. Keys are not included.",
        detail: path,
        actions: [{ label: "Copy path", run: () => void copy(path, { label: "Path copied." }) }],
        seconds: 12,
      });
    } catch (err) {
      toast({ message: errorText(err), tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  const fontFamilies = withCurrent(FONT_FAMILIES, settings.font_family).map((f) => ({ value: f, label: f }));

  return (
    <div className="settings-page">
      <header className="settings-head">
        <div>
          <h1>Settings</h1>
          <p className="muted">Changes are saved as you make them.</p>
        </div>
        <button type="button" className="btn" onClick={onClose}>
          <Icon name="terminal" size={14} /> Back to terminals
        </button>
      </header>

      <Section title="Security" icon="shield" desc="Protect your vault and sensitive data.">
        <Row wide label="Auto-lock after idle" htmlFor={`${ids}-lock`}>
          <SelectField
            id={`${ids}-lock`}
            value={settings.auto_lock_minutes}
            options={numberChoices(AUTO_LOCK_MINUTES, settings.auto_lock_minutes, autoLockLabel)}
            onChange={(v) => set("auto_lock_minutes", v)}
          />
        </Row>
        <Row label="Lock on minimise" hint="Automatically lock the app when it is minimised or the computer is locked.">
          <Switch checked={settings.lock_on_minimize} label="Lock on minimise" onChange={(v) => set("lock_on_minimize", v)} />
        </Row>
        <Row
          label="Clipboard clear"
          hint="Automatically clear clipboard after copying a public key (in seconds)."
          htmlFor={`${ids}-clip`}
        >
          <SelectField
            id={`${ids}-clip`}
            value={settings.clipboard_clear_seconds}
            options={numberChoices(CLIPBOARD_SECONDS, settings.clipboard_clear_seconds, clipboardLabel)}
            onChange={(v) => set("clipboard_clear_seconds", v)}
          />
        </Row>
        <div className="sx-actions">
          <button type="button" className="obtn-o sx-btn" onClick={() => setDialog("passphrase")}>
            Change passphrase...
          </button>
        </div>
      </Section>

      <Section title="Terminal" icon="terminalBox" desc="Customize your terminal experience.">
        <div className="sx-pair">
          <div className="sx-field sx-grow">
            <label htmlFor={`${ids}-font`}>Font family</label>
            <SelectField id={`${ids}-font`} value={settings.font_family} options={fontFamilies} onChange={(v) => set("font_family", v)} />
          </div>
          <div className="sx-field sx-narrow">
            <label htmlFor={`${ids}-size`}>Font size</label>
            <SelectField
              id={`${ids}-size`}
              value={settings.font_size}
              options={numberChoices(FONT_SIZES, settings.font_size, (n) => String(n))}
              onChange={(v) => set("font_size", v)}
            />
          </div>
        </div>
        <div
          className="font-preview"
          aria-label="Font preview"
          style={{ fontFamily: terminalFontStack(settings.font_family), fontSize: `${settings.font_size}px` }}
        >
          <span className="prompt">user@host</span>
          <span className="path">:~</span>$ The quick brown fox jumps over the lazy dog.
        </div>
        <Row wide label="Scrollback lines" htmlFor={`${ids}-scroll`}>
          <SelectField
            id={`${ids}-scroll`}
            value={settings.scrollback}
            options={numberChoices(SCROLLBACK_LINES, settings.scrollback, (n) => n.toLocaleString("en-US"))}
            onChange={(v) => set("scrollback", v)}
          />
        </Row>
        <div className="sx-pair sx-inline">
          <div className="sx-field">
            <label htmlFor={`${ids}-cursor`}>Cursor style</label>
            <SelectField id={`${ids}-cursor`} value={settings.cursor_style} options={CURSOR_CHOICES} onChange={(v) => set("cursor_style", v)} />
          </div>
          <div className="sx-field sx-grow">
            <label htmlFor={`${ids}-bell`}>Bell</label>
            <SelectField id={`${ids}-bell`} value={settings.bell} options={BELL_CHOICES} onChange={(v) => set("bell", v)} />
          </div>
        </div>
      </Section>

      <Section title="Appearance" icon="sliders" desc="Choose how the app looks.">
        <Row wide label="Theme">
          <Segmented label="Theme" value={settings.theme} options={THEME_CHOICES} onChange={(v) => set("theme", v)} />
        </Row>
        <Row wide label="UI scale" htmlFor={`${ids}-scale`}>
          <SelectField
            id={`${ids}-scale`}
            value={settings.ui_scale}
            options={numberChoices(UI_SCALES, settings.ui_scale, scaleLabel)}
            onChange={(v) => set("ui_scale", v)}
          />
        </Row>
      </Section>

      <Section title="Vault" icon="rack" desc="Manage your encrypted vault file.">
        <div className="sx-field">
          <span className="sx-label">File location</span>
          <div className="sx-path">
            <code title={info?.path}>{info?.path ?? ""}</code>
            <button
              type="button"
              className="icon-btn"
              aria-label="Copy path"
              disabled={!info}
              onClick={() => info && void copy(info.path, { label: "Path copied." })}
            >
              <Icon name="copy" />
            </button>
          </div>
          <p className="hint">This file is encrypted and contains your hosts, keys and settings.</p>
        </div>
        <div className="sx-grid">
          <button type="button" className="obtn-o sx-btn" disabled={busy !== null} onClick={() => void writeFile("backup")}>
            {busy === "backup" ? <Spinner /> : <Icon name="arrowDown" size={16} />} Back up vault...
          </button>
          <button type="button" className="obtn-o sx-btn" disabled={busy !== null} onClick={() => void writeFile("export")}>
            {busy === "export" ? <Spinner /> : <Icon name="upload" size={16} />} Export hosts (no keys)...
          </button>
          <button type="button" className="obtn-o sx-btn sx-danger" onClick={() => setDialog("delete")}>
            <Icon name="trash" size={16} /> Delete vault...
          </button>
        </div>
      </Section>

      <Section title="About" icon="info" desc="App version information.">
        <Row label="Version">
          <span className="sx-version">{version}</span>
        </Row>
      </Section>

      {dialog === "passphrase" && <ChangePassphraseDialog onClose={() => setDialog(null)} />}
      {dialog === "delete" && <DeleteVaultDialog onDeleted={onVaultDeleted} onClose={() => setDialog(null)} />}
    </div>
  );
}
