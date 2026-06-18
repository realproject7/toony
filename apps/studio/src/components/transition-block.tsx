// Transition block — the vertical rhythm between cuts (issue #7, read-only).
//
// Resolves the transition through `@toony/render`'s `layoutTransition` and
// renders it as a band whose real gutter height occupies actual vertical space,
// conveying the scroll rhythm a reader experiences. The type, any text/SFX, and
// the gutter height stay visible and compact. Rich transition EDITING is #9.

import { layoutTransition } from "@toony/render";
import type { Transition } from "@toony/schema";

export function TransitionBlock({ transition }: { transition: Transition }) {
  const plan = layoutTransition(transition);

  // The band reserves its real gutter height so the scroll rhythm is literal.
  // Cards/breaks and the v3 solid bands (#99) get a visible minimum so their
  // label/detail is legible even when authored with a small gutter; plain gutters
  // honor the exact height.
  const reserved =
    plan.isCard || plan.treatment === "band" ? Math.max(plan.gutterHeight, 56) : plan.gutterHeight;
  // The resolved solid-band fill (#99, folds in any #98 color) wins; otherwise a
  // legacy explicit #98 color. Same resolved color the export canvas uses, so the
  // studio and export bands match.
  const background = plan.bandFill ?? plan.color;

  return (
    <div
      className="transition-block"
      data-testid={`transition-${transition.id}`}
      data-treatment={plan.treatment}
      style={
        background ? { minHeight: `${reserved}px`, background } : { minHeight: `${reserved}px` }
      }
    >
      <div className="transition-rule" aria-hidden="true" />
      <div className="transition-band">
        <span className="transition-type">{plan.label}</span>
        {plan.detail && (
          <span className={plan.isSfx ? "transition-sfx" : "transition-detail"}>{plan.detail}</span>
        )}
      </div>
      <span className="transition-gutter">{plan.gutterHeight}px</span>
    </div>
  );
}
