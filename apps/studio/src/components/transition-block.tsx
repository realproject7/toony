// Transition block — a real interstitial PANEL in the scroll (#118).
//
// A transition is not a UI gap: it is an image panel between scenes (solid color,
// narration/dialogue/time card, void, fade, or plain reading gutter). This
// renders the SAME panel the export canvas composes (`composeTransitionBand`):
// background fill → optional full-panel gradient → optional fade overlay →
// optional text with the plan's resolved H+V anchoring. Geometry/treatment all
// come from `@toony/render`'s `layoutTransition`, so the studio Read panel and the
// export raster match (true WYSIWYG).
//
// `readOnly` (reader, #49) drops all authoring chrome — only the rendered panel
// remains, exactly as a reader sees it. The episode preview keeps a small
// type/height meta chip so authors can still identify each transition.

import { layoutTransition } from "@toony/render";
import type { Transition } from "@toony/schema";

/** The v4 text-panel kinds that honor the plan's H+V text anchoring (#115). */
const V4_TEXT_PANELS = new Set(["narration_card", "dialogue_card", "time_card"]);

/** `#rgb`/`#rrggbb` → `rgba(r,g,b,a)`; falls back to the raw color for non-hex. */
function rgba(color: string, alpha: number): string {
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(color);
  const m6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  let r: number;
  let g: number;
  let b: number;
  if (m3) {
    r = Number.parseInt(`${m3[1]}${m3[1]}`, 16);
    g = Number.parseInt(`${m3[2]}${m3[2]}`, 16);
    b = Number.parseInt(`${m3[3]}${m3[3]}`, 16);
  } else if (m6) {
    r = Number.parseInt(m6[1] as string, 16);
    g = Number.parseInt(m6[2] as string, 16);
    b = Number.parseInt(m6[3] as string, 16);
  } else {
    return color;
  }
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function TransitionBlock({
  transition,
  readOnly,
}: {
  transition: Transition;
  readOnly?: boolean;
}) {
  const plan = layoutTransition(transition);

  // Panel height: honor the authored gutter height; cards/bands/breaks get a
  // legibility floor (mirrors the export floor so short panels still read).
  const floored = plan.isCard || plan.treatment === "band" || plan.treatment === "fade";
  const height = floored ? Math.max(plan.gutterHeight, 72) : plan.gutterHeight;

  // Background fill, in the SAME precedence the export canvas uses: full-panel
  // gradient → resolved band fill → explicit color → card dark → fade default →
  // white reading space.
  let background: string;
  if (plan.gradient) {
    const { from, to, direction } = plan.gradient;
    const [top, bottom] = direction === "top_bottom" ? [from, to] : [to, from];
    background = `linear-gradient(to bottom, ${top}, ${bottom})`;
  } else if (plan.bandFill) {
    background = plan.bandFill;
  } else if (plan.color) {
    background = plan.color;
  } else if (plan.treatment === "card") {
    background = "#15110d";
  } else if (plan.treatment === "fade") {
    background = "linear-gradient(to bottom, #ffffff, #d9d4cc)";
  } else {
    background = "#ffffff";
  }

  // Optional fade overlay (#115), drawn over the fill, under text.
  let fadeBg: string | null = null;
  if (plan.fade) {
    const { color, length, direction } = plan.fade;
    fadeBg =
      direction === "top_bottom"
        ? `linear-gradient(to bottom, ${rgba(color, 0)} calc(100% - ${length}px), ${rgba(color, 1)} 100%)`
        : `linear-gradient(to bottom, ${rgba(color, 1)} 0, ${rgba(color, 0)} ${length}px)`;
  }

  // Text: v4 panels honor H+V anchoring; legacy cards/breaks center their detail.
  // Band treatment (color/void/black_band/palette_shift) draws no text — fill only.
  const isV4Text = V4_TEXT_PANELS.has(plan.type);
  const hasText =
    plan.detail !== null && (isV4Text || plan.treatment === "card" || plan.treatment === "break");
  const lightText = plan.treatment !== "break" && plan.treatment !== "fade";

  const justify =
    plan.verticalAlign === "top"
      ? "flex-start"
      : plan.verticalAlign === "bottom"
        ? "flex-end"
        : "center";
  const textAlign = isV4Text ? plan.textAlign : "center";
  const detailSize = Math.max(12, Math.round(height * (isV4Text ? 0.14 : 0.2)));

  return (
    <div
      className="transition-block"
      data-testid={`transition-${transition.id}`}
      data-treatment={plan.treatment}
      data-readonly={readOnly ? "true" : undefined}
      style={{ minHeight: `${height}px`, background }}
    >
      {fadeBg && (
        <div className="transition-fade" style={{ background: fadeBg }} aria-hidden="true" />
      )}
      {plan.treatment === "break" && <div className="transition-rule" aria-hidden="true" />}
      {hasText && (
        <div
          className="transition-text"
          style={{
            justifyContent: justify,
            textAlign,
            color: lightText ? "#f3ece0" : "#2a2a2a",
          }}
        >
          <span className="transition-text-inner">
            <span
              className={plan.isSfx ? "transition-sfx" : "transition-detail"}
              style={{ fontSize: `${detailSize}px` }}
            >
              {plan.detail}
            </span>
            {!isV4Text && <span className="transition-label">{plan.label}</span>}
          </span>
        </div>
      )}
      {!readOnly && (
        <span className="transition-meta">
          {plan.label} · {plan.gutterHeight}px
        </span>
      )}
    </div>
  );
}
