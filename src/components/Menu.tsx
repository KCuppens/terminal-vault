import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Icon, type IconName } from "./ui";

export interface MenuItem {
  label: string;
  icon?: IconName;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
  onSelect(): void;
}

interface Props {
  label: string;
  items: MenuItem[];
  className?: string;
  menuClassName?: string;
  /** Trigger content; defaults to the more icon. */
  children?: ReactNode;
}

interface Anchor {
  top: number;
  right: number;
}

export function Menu({ label, items, className, menuClassName, children }: Props) {
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const open = anchor !== null;

  function toggle() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect || open) setAnchor(null);
    else setAnchor({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
  }

  function close(restoreFocus: boolean) {
    setAnchor(null);
    if (restoreFocus) buttonRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    popupRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    const away = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!popupRef.current?.contains(target) && !buttonRef.current?.contains(target)) setAnchor(null);
    };
    const dismiss = () => setAnchor(null);
    document.addEventListener("mousedown", away);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    document.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("mousedown", away);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
      document.removeEventListener("scroll", dismiss, true);
    };
  }, [open]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
      return;
    }
    if (e.key === "Tab") {
      close(false);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const nodes = [...(popupRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])];
    if (nodes.length === 0) return;
    const current = nodes.indexOf(document.activeElement as HTMLElement);
    let next = current;
    if (e.key === "ArrowDown") next = (current + 1) % nodes.length;
    else if (e.key === "ArrowUp") next = (current - 1 + nodes.length) % nodes.length;
    else if (e.key === "Home") next = 0;
    else next = nodes.length - 1;
    nodes[next]?.focus();
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={className ?? "icon-btn"}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            toggle();
          }
        }}
      >
        {children ?? <Icon name="more" />}
      </button>
      {anchor &&
        createPortal(
          <div
            ref={popupRef}
            className={menuClassName ? `menu ${menuClassName}` : "menu"}
            role="menu"
            aria-label={label}
            style={{ top: anchor.top, right: anchor.right }}
            onKeyDown={onKeyDown}
          >
            {items.map((item) => (
              <div key={item.label} role="none">
                {item.separatorBefore && <div className="menu-sep" role="separator" />}
                <button
                  type="button"
                  role="menuitem"
                  className={item.danger ? "menu-item danger" : "menu-item"}
                  disabled={item.disabled}
                  onClick={() => {
                    close(false);
                    item.onSelect();
                  }}
                >
                  {item.icon && <Icon name={item.icon} />}
                  {item.label}
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
