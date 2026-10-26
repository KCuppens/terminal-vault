import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { plural } from "../lib/format";
import { queryPalette, type PaletteIconName, type PaletteItem } from "../lib/palette";
import { Icon, Keycaps, type IconName } from "./ui";

interface Props {
  items: PaletteItem[];
  recentIds: string[];
  onRun(item: PaletteItem): void;
  onClose(): void;
}

const ICONS: Record<PaletteIconName, IconName> = {
  host: "monitor",
  tmux: "monitor",
  pane: "splitH",
  layout: "layout",
  lock: "lock",
  tab: "terminalBox",
  split: "splitV",
  search: "search",
  gear: "gear",
  key: "key",
  plus: "plus",
};

export function CommandPalette({ items, recentIds, onRun, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const result = useMemo(() => queryPalette(items, query, recentIds), [items, query, recentIds]);
  const count = result.flat.length;
  const activeIndex = Math.min(active, Math.max(0, count - 1));
  const activeItem = result.flat[activeIndex];
  const optionId = (item: PaletteItem) => `${listId}-${item.id}`;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => previous?.focus();
  }, []);

  useEffect(() => {
    if (!activeItem) return;
    document.getElementById(optionId(activeItem))?.scrollIntoView({ block: "nearest" });
  }, [activeItem?.id]);

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (count === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + count) % count);
    } else if (e.key === "Home" && e.ctrlKey) {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End" && e.ctrlKey) {
      e.preventDefault();
      setActive(Math.max(0, count - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeItem) onRun(activeItem);
    }
  }

  return (
    <div
      className="palette-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-input">
          <Icon name="search" size={20} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Search hosts, run commands..."
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeItem ? optionId(activeItem) : undefined}
            aria-label="Search hosts and commands"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
          {query !== "" && (
            <button
              type="button"
              className="icon-btn"
              aria-label="Clear search"
              onClick={() => {
                setQuery("");
                setActive(0);
                inputRef.current?.focus();
              }}
            >
              <Icon name="close" size={18} />
            </button>
          )}
        </div>
        <div className="palette-list" id={listId} role="listbox" aria-label="Results">
          {count === 0 && <p className="palette-empty">No matches for "{query.trim()}".</p>}
          {result.groups.map((group) => (
            <div key={group.section} role="group" aria-label={group.section}>
              <div className="palette-section" aria-hidden="true">
                {group.section}
              </div>
              {group.items.map((item) => {
                const selected = item === activeItem;
                return (
                  <div
                    key={item.id}
                    id={optionId(item)}
                    role="option"
                    aria-selected={selected}
                    className={selected ? "palette-row active" : "palette-row"}
                    onMouseMove={() => setActive(result.flat.indexOf(item))}
                    onClick={() => onRun(item)}
                  >
                    <span className={item.icon === "layout" ? "row-icon accent" : "row-icon"}>
                      <Icon name={ICONS[item.icon]} size={22} />
                    </span>
                    <span className="palette-text">
                      <span className="palette-title">{item.title}</span>
                      {item.subtitle && <span className="palette-sub">{item.subtitle}</span>}
                    </span>
                    {item.shortcut && item.shortcut.length > 0 && <Keycaps keys={item.shortcut} />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div className="palette-foot">
          <span>
            <kbd className="kbd">↑</kbd> <kbd className="kbd">↓</kbd> to navigate
          </span>
          <span>
            <kbd className="kbd">Enter</kbd> to select
          </span>
          <span>
            <kbd className="kbd">Esc</kbd> to close
          </span>
          <span className="palette-count" aria-live="polite">
            Showing {plural(count, "result")}
          </span>
        </div>
      </div>
    </div>
  );
}
