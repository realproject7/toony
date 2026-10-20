"use client";

// A small "More" menu: a button that opens a short list of actions. Closes on
// Escape, on an outside click and after an action.

import Link from "next/link";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { StudioIcon } from "./studio-icon";

export interface MenuAction {
  label: string;
  onSelect?: () => void;
  href?: string;
  danger?: boolean;
  disabled?: boolean;
  testId?: string;
}

export function ActionMenu({
  label,
  actions,
  trigger,
}: {
  label: string;
  actions: MenuAction[];
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") setOpen(false);
        return;
      }
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div className="action-menu" ref={root}>
      <button
        type="button"
        className="btn btn-icon"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger ?? <StudioIcon name="more" />}
      </button>
      {open && (
        <div className="action-menu-list" role="menu" id={id}>
          {actions.map((action) =>
            action.href ? (
              <Link
                key={action.label}
                role="menuitem"
                href={action.href}
                className={action.danger ? "is-danger" : undefined}
                data-testid={action.testId}
                onClick={() => setOpen(false)}
              >
                {action.label}
              </Link>
            ) : (
              <button
                key={action.label}
                type="button"
                role="menuitem"
                disabled={action.disabled}
                className={action.danger ? "is-danger" : undefined}
                data-testid={action.testId}
                onClick={() => {
                  setOpen(false);
                  action.onSelect?.();
                }}
              >
                {action.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
