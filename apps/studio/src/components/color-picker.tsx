"use client";

// Lightweight color picker for the focused cut lettering editor (issue #55).
//
// This is deliberately a TINY custom control, not a design-tool dependency: a
// trigger swatch that opens a popover with (1) a fixed palette grid, (2) the
// recent colors the user has chosen in this browser, (3) the small project
// palette derived from the cut's own bubbles, and (4) a hex text input plus the
// browser-native <input type="color"> eyedropper. No gradients, no alpha
// channel, no canvas — colors are plain CSS hex strings, exactly what the
// `@toony/render` plan and the schema's `textColor`/`fill`/`border.color` fields
// consume. The whole component is a few KB of our own code, so lazy-loading the
// editor chunk keeps the library/reader bundles untouched.

import { useEffect, useId, useMemo, useRef, useState } from "react";

/** Curated default swatches: neutrals + a few saturated lettering accents. */
const DEFAULT_SWATCHES = [
  "#ffffff",
  "#f4efe6",
  "#d8d0c4",
  "#9a8f80",
  "#6e6860",
  "#3a332d",
  "#1a1a1a",
  "#000000",
  "#b42318",
  "#d97706",
  "#ca8a04",
  "#127c72",
  "#0b5f58",
  "#1d4ed8",
  "#6d28d9",
  "#be185d",
] as const;

const RECENT_KEY = "toony.editor.recentColors";
const RECENT_MAX = 8;
/** Accept #rgb / #rrggbb (with or without leading #), case-insensitive. */
const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Normalize an input string to a `#rrggbb` lowercase hex, or null if invalid. */
export function normalizeHex(raw: string): string | null {
  const trimmed = raw.trim();
  if (!HEX_RE.test(trimmed)) return null;
  let hex = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((ch) => ch + ch)
      .join("");
  }
  return `#${hex.toLowerCase()}`;
}

/** Read the recent-colors list from localStorage (browser only). */
function readRecent(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string" && HEX_RE.test(v));
  } catch {
    return [];
  }
}

/** Push a color to the front of the recent-colors list, de-duped and capped. */
function pushRecent(color: string): string[] {
  const normalized = normalizeHex(color);
  if (!normalized) return readRecent();
  const next = [normalized, ...readRecent().filter((c) => c !== normalized)].slice(0, RECENT_MAX);
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // Ignore quota/availability errors — recent colors are a convenience only.
    }
  }
  return next;
}

export interface ColorPickerProps {
  /** Field label shown next to the trigger. */
  label: string;
  /** Current value as a CSS color string (hex when set through this control). */
  value: string;
  /** Called with a normalized `#rrggbb` hex whenever the user picks a color. */
  onChange: (hex: string) => void;
  /**
   * Small project palette: colors already used by other bubbles in the cut, so a
   * letterer can reuse a consistent set without re-typing hex codes.
   */
  projectPalette?: readonly string[];
  /** Test id applied to the trigger button. */
  testId?: string;
}

/** A single clickable swatch cell. */
function Swatch({
  color,
  active,
  onPick,
}: {
  color: string;
  active: boolean;
  onPick: (color: string) => void;
}) {
  return (
    <button
      type="button"
      className={active ? "color-swatch color-swatch-active" : "color-swatch"}
      style={{ background: color }}
      title={color}
      aria-label={color}
      aria-pressed={active}
      onClick={() => onPick(color)}
    />
  );
}

export function ColorPicker({
  label,
  value,
  onChange,
  projectPalette = [],
  testId,
}: ColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [recent, setRecent] = useState<string[]>([]);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const popoverId = useId();

  // Load recent colors once the popover first opens (client only).
  useEffect(() => {
    if (open) setRecent(readRecent());
  }, [open]);

  // Keep the hex draft in sync with the external value while closed.
  useEffect(() => {
    if (!open) setDraft(value);
  }, [open, value]);

  // Close on outside click / Escape so the popover behaves like a menu.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const normalizedValue = useMemo(() => normalizeHex(value), [value]);

  // The de-duplicated project palette, excluding the default swatches so the row
  // only surfaces colors actually in use elsewhere in the cut.
  const palette = useMemo(() => {
    const seen = new Set<string>(DEFAULT_SWATCHES);
    const out: string[] = [];
    for (const raw of projectPalette) {
      const hex = normalizeHex(raw);
      if (hex && !seen.has(hex)) {
        seen.add(hex);
        out.push(hex);
      }
    }
    return out;
  }, [projectPalette]);

  const pick = (raw: string) => {
    const hex = normalizeHex(raw);
    if (!hex) return;
    setRecent(pushRecent(hex));
    onChange(hex);
  };

  const commitDraft = () => {
    const hex = normalizeHex(draft);
    if (hex) {
      pick(hex);
      setDraft(hex);
    } else {
      setDraft(normalizedValue ?? value);
    }
  };

  return (
    <div className="color-picker" ref={rootRef}>
      <span className="color-picker-label">{label}</span>
      <button
        type="button"
        className="color-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => setOpen((v) => !v)}
        data-testid={testId}
      >
        <span className="color-trigger-chip" style={{ background: value }} aria-hidden="true" />
        <span className="color-trigger-value">{normalizedValue ?? value}</span>
      </button>

      {open && (
        <div className="color-popover" id={popoverId} role="dialog" aria-label={`${label} color`}>
          <div className="color-grid" data-testid={testId ? `${testId}-grid` : undefined}>
            {DEFAULT_SWATCHES.map((color) => (
              <Swatch key={color} color={color} active={normalizedValue === color} onPick={pick} />
            ))}
          </div>

          {palette.length > 0 && (
            <div className="color-section">
              <span className="color-section-title">Project palette</span>
              <div className="color-row">
                {palette.map((color) => (
                  <Swatch
                    key={color}
                    color={color}
                    active={normalizedValue === color}
                    onPick={pick}
                  />
                ))}
              </div>
            </div>
          )}

          {recent.length > 0 && (
            <div className="color-section">
              <span className="color-section-title">Recent</span>
              <div className="color-row" data-testid={testId ? `${testId}-recent` : undefined}>
                {recent.map((color) => (
                  <Swatch
                    key={color}
                    color={color}
                    active={normalizedValue === color}
                    onPick={pick}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="color-hex-row">
            <input
              type="color"
              className="color-native"
              aria-label={`${label} eyedropper`}
              value={normalizedValue ?? "#000000"}
              onChange={(e) => pick(e.target.value)}
              data-testid={testId ? `${testId}-native` : undefined}
            />
            <input
              type="text"
              className="color-hex-input"
              value={draft}
              spellCheck={false}
              aria-label={`${label} hex value`}
              placeholder="#rrggbb"
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitDraft}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitDraft();
                }
              }}
              data-testid={testId ? `${testId}-hex` : undefined}
            />
          </div>
        </div>
      )}
    </div>
  );
}
