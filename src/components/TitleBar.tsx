import { shortcutKeys } from "../lib/shortcuts";
import { Icon } from "./ui";

interface Props {
  unlocked: boolean;
  onPalette(): void;
  onLock(): void;
  onMinimize(): void;
  onToggleMaximize(): void;
  onClose(): void;
}

export function TitleBar({ unlocked, onPalette, onLock, onMinimize, onToggleMaximize, onClose }: Props) {
  return (
    <header className="titlebar" data-tauri-drag-region onDoubleClick={onToggleMaximize}>
      <div className="titlebar-brand" data-tauri-drag-region>
        <span className="brand-mark" aria-hidden="true">
          <Icon name="prompt" size={30} />
        </span>
        <span className="brand-name" data-tauri-drag-region>
          terminal-vault
        </span>
      </div>
      <div className="titlebar-center" data-tauri-drag-region>
        {unlocked && (
          <button
            type="button"
            className="titlebar-search"
            onClick={onPalette}
            onDoubleClick={(e) => e.stopPropagation()}
            aria-label="Open command palette"
          >
            <Icon name="search" size={20} />
            <span>Search hosts, run commands...</span>
            <kbd className="kbd">{shortcutKeys("palette").join(" ")}</kbd>
          </button>
        )}
      </div>
      <div className="titlebar-end" onDoubleClick={(e) => e.stopPropagation()}>
        {unlocked && (
          <button
            type="button"
            className="lock-chip"
            onClick={onLock}
            title={`Lock vault (${shortcutKeys("lock").join("+")})`}
            aria-label="Lock vault"
          >
            <Icon name="unlockSolid" size={18} />
            Unlocked
          </button>
        )}
        <div className="window-controls">
          <button type="button" className="window-btn" aria-label="Minimize" onClick={onMinimize}>
            <Icon name="minimize" size={14} />
          </button>
          <button type="button" className="window-btn" aria-label="Maximize or restore" onClick={onToggleMaximize}>
            <Icon name="maximize" size={14} />
          </button>
          <button type="button" className="window-btn window-close" aria-label="Close window" onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </div>
      </div>
    </header>
  );
}
