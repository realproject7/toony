# @toony/render

Framework-agnostic geometry and layout core for Toony lettering and transitions.

Pure TypeScript — **no React, no DOM, no canvas**. It depends only on
`@toony/schema`. Given a lettering overlay and the cut's pixel dimensions, it
computes the balloon outline, the speech-tail triangle, and the wrapped /
auto-fit body text lines. Given a transition, it computes the gutter band plan.

Everything it returns is **plain geometry data** — command lists, an SVG path
string, point triangles, positioned text lines, resolved colors — never
SVG/canvas nodes. This is the single source of truth that the studio SVG preview
(#7), the focused lettering editor (#8), and the headless canvas export (#10)
all consume, so the three renderers cannot drift and there is no body/tail seam.

## Coordinate contract

- **In:** all overlay geometry and tail points are normalized `0..1` relative to
  the cut image (the `@toony/schema` space). `(0,0)` is the top-left of the cut.
- **Out:** all returned coordinates are in the **caller's render pixel space** —
  pass display px for the preview, natural-image px for the export. Because
  layout scales linearly with the render size, the same overlay wraps and breaks
  identically at any scale (the WYSIWYG invariant).

The schema's `LetteringOverlay.tail` is a normalized **point** (not an enum) — the
tail resolves deterministically to `0..1` image coordinates upstream (#4), so this
core never re-derives a tail from an enum.

## Bubble layout API

```ts
import { layoutCut, type BubbleRender } from "@toony/render";

const plans: BubbleRender[] = layoutCut(overlays, renderWidth, renderHeight);
```

`layoutBubble(overlay, width, height, opts?)` / `layoutCut(overlays, width, height, opts?)`
return one `BubbleRender` per overlay:

| Field | Meaning |
| --- | --- |
| `box` | body rect `{x,y,width,height}` in pixel space |
| `hasBubble` | false for SFX (bare text, no body) |
| `outline` | `BalloonCommand[]` — `M`/`L`/`A`, maps 1:1 to canvas and SVG |
| `pathD` | SVG path `d` tracing the same outline (`""` for SFX) |
| `tail` | `{tip, base1, base2}` triangle, or `null` (tailless / tip inside box) |
| `fill`, `stroke`, `textColor`, `speakerColor` | resolved colors (stored style overrides per-kind defaults) |
| `strokeWidth`, `fillOpacity` | resolved stroke px and fill opacity |
| `text` | `{lines, fontSize, lineHeight, speakerFontSize, overflow}` |
| `lines` | positioned, center-anchored `RenderedTextLine[]` |
| `textOrigin` | top-left of the body text area (below any speaker strip) |
| `overflow` | text overflows even at min font |

### SVG consumer (preview, #7)

```ts
const p = layoutBubble(overlay, w, h);
// <path d={p.pathD} fill={p.fill} fillOpacity={p.fillOpacity}
//       stroke={p.stroke} strokeWidth={p.strokeWidth} />
// p.lines.forEach(l => <text x={l.centerX} y={l.y + p.text.fontSize}
//       textAnchor="middle">{l.text}</text>)
```

### Canvas consumer (export, #10)

```ts
const p = layoutBubble(overlay, naturalW, naturalH);
for (const c of p.outline) {
  if (c.k === "M") ctx.moveTo(c.x, c.y);
  else if (c.k === "L") ctx.lineTo(c.x, c.y);
  else ctx.arcTo(c.cornerX, c.cornerY, c.x, c.y, c.r);
}
ctx.closePath(); ctx.fill(); ctx.stroke();
```

## Text measurement

Layout is deterministic **given a `measure` function**. By default the core uses
`approximateMeasure` — a DOM-free, per-character metric approximation — so the
preview can lay out on the server and every consumer that does not inject its own
measurer gets identical numbers. Inject a real `canvas.measureText`-backed
measurer via `opts.measure` for pixel-accurate fit in the browser/export:

```ts
layoutBubble(overlay, w, h, { measure: (t, size, weight) => {
  ctx.font = `${weight ?? 400} ${size}px sans-serif`;
  return ctx.measureText(t).width;
}});
```

## Transition layout API

```ts
import { layoutTransition, type TransitionRender } from "@toony/render";

const t = layoutTransition(transition);
// t.gutterHeight  — clamped px height (the vertical rhythm)
// t.treatment     — "gutter" | "fade" | "card" | "break"
// t.label, t.detail, t.isSfx, t.isCard
```

## Lower-level geometry

`balloonOutline`, `balloonPathD`, `speechTailGeometry`, `defaultBalloonRadius`
are exported for callers that need the raw geometry. `bubbleKindStyle`,
`kindHasBubble`, `kindSupportsTail` expose the per-kind defaults;
`layoutBubbleText`, `wrapText`, `defaultBubbleFontRange` expose the text engine.

## Provenance

The balloon outline + tail geometry and the deterministic word-wrap / auto-fit
were **adopted from** `plotlink-ows` `app/lib/overlays.ts` and
`app/lib/bubble-text.ts` (the proven WYSIWYG command-list core) and **adapted**
to Toony's schema: image-space tail points instead of bubble-relative anchors,
Toony's six-kind bubble taxonomy with stored-style overrides, and a DOM-free
default measurer for server-side preview. The transition layout is built fresh —
`plotlink-ows` has no transition concept.
