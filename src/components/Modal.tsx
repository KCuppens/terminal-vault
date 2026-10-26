import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Icon } from "./ui";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let openCount = 0;

export function isModalOpen(): boolean {
  return openCount > 0;
}

export type ModalSize = "sm" | "md" | "lg";

interface Props {
  title: string;
  subtitle?: string;
  size?: ModalSize;
  tone?: "danger";
  icon?: ReactNode;
  onClose(): void;
  hideClose?: boolean;
  headRight?: ReactNode;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Modal({ title, subtitle, size = "md", tone, icon, onClose, hideClose, headRight, footer, className, children }: Props) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    openCount += 1;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement)) {
      const preferred = dialog.querySelector<HTMLElement>("[data-autofocus]");
      (preferred ?? dialog.querySelector<HTMLElement>(".modal-body " + FOCUSABLE) ?? dialog).focus();
    }
    return () => {
      openCount -= 1;
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (e.key !== "Tab") return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const items = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) {
      e.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialog)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCloseRef.current();
      }}
    >
      <div
        ref={dialogRef}
        className={`modal modal-${size}${tone === "danger" ? " modal-danger" : ""}${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="modal-head">
          {icon && <span className="modal-icon">{icon}</span>}
          <div className="modal-titles">
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {headRight}
          {!hideClose && (
            <button type="button" className="icon-btn" aria-label="Close dialog" onClick={() => onCloseRef.current()}>
              <Icon name="close" />
            </button>
          )}
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
