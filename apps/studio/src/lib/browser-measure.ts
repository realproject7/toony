"use client";

// Browser text measurer for the studio bubble layout (#149).
//
// The studio used to lay out bubbles with `@toony/render`'s deterministic
// DOM-free approximation, which buckets every non-ASCII glyph at a generic body
// width — so CJK and display faces wrapped/auto-fit differently from the export
// raster (which measures with a real canvas). This provides an offscreen-canvas
// `measureText` measurer over the resolved curated face — mirroring
// `packages/export/src/measure.ts` — so studio wrap/auto-fit matches export.
//
// Measurement needs a browser (canvas + loaded fonts), so the hook returns null
// on the server and until `document.fonts.ready`; the layout falls back to the
// approximation for that first paint and then re-layouts with real metrics.

import type { MeasureWidth } from "@toony/render";
import { useEffect, useState } from "react";
import { resolveCanvasFont } from "./canvas-font";

/**
 * Build an offscreen-canvas width measurer (browser only). The `ctx.font` string
 * is memoized per font key (`family|weight|size`), so repeated measurements at a
 * given face/size don't re-resolve the family. Returns null when a 2D canvas
 * context is unavailable.
 */
export function createBrowserMeasure(): MeasureWidth | null {
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return null;
  const fontCache = new Map<string, string>();
  return (text, fontSize, fontWeight = 400, fontFamily) => {
    const key = `${fontFamily ?? ""}|${fontWeight}|${fontSize}`;
    let font = fontCache.get(key);
    if (font === undefined) {
      font = resolveCanvasFont(fontFamily, fontWeight, fontSize);
      fontCache.set(key, font);
    }
    ctx.font = font;
    return ctx.measureText(text).width;
  };
}

/**
 * A browser canvas measurer, available once the app is hydrated AND the curated
 * faces are loaded (`document.fonts.ready`) — so bubble text wraps/auto-fits with
 * real metrics matching the export raster. Returns null on the server and until
 * fonts are ready (the caller falls back to the deterministic approximation for
 * that first paint, then re-layouts when this flips). Rebuilds if more faces
 * finish loading later, so a lazily-loaded face still triggers a re-layout.
 */
export function useBrowserMeasure(): MeasureWidth | null {
  const [measure, setMeasure] = useState<MeasureWidth | null>(null);
  useEffect(() => {
    if (typeof document === "undefined") return;
    let cancelled = false;
    const rebuild = () => {
      if (cancelled) return;
      const m = createBrowserMeasure();
      if (m) setMeasure(() => m);
    };
    const fonts = document.fonts;
    if (fonts?.ready) {
      fonts.ready.then(rebuild).catch(() => {});
    } else {
      rebuild();
    }
    fonts?.addEventListener?.("loadingdone", rebuild);
    return () => {
      cancelled = true;
      fonts?.removeEventListener?.("loadingdone", rebuild);
    };
  }, []);
  return measure;
}
