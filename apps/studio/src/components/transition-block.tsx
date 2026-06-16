// Transition block — a first-class editable beat between cuts (Production Scroll
// hard rule 4). The shell renders the transition's type, gutter height, and any
// text/SFX/notes in reading order. Rich rhythm visuals are issue #7.

import type { Transition } from "@toony/schema";

export function TransitionBlock({ transition }: { transition: Transition }) {
  const detail = transition.text ?? transition.sfx ?? transition.humanNote ?? transition.agentNote;
  return (
    <div className="transition-block" data-testid={`transition-${transition.id}`}>
      <span className="transition-type">{transition.type.replace(/-/g, " ")}</span>
      {detail && <span className="transition-detail">{detail}</span>}
      <span className="transition-gutter">{transition.gutterHeight}px</span>
    </div>
  );
}
