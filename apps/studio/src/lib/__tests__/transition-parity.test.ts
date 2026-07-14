// Studio-side transition text parity (#148), in the #157 node:test harness.
//
// The studio `TransitionBlock` renders panel/card text from the SAME
// `@toony/render` layout the export canvas uses, in the SAME shared band
// typeface — so a long string breaks into the same lines and draws in the same
// face in the Read view and the export raster. `TransitionBlock` itself is a
// React component (not node-testable here), so this asserts the shared surface
// it consumes: the wrapped layout + the shared Nunito stack.

import assert from "node:assert/strict";
import { test } from "node:test";
import { BAND_FONT_STACK, layoutCardText, layoutPanelText, layoutTransition } from "@toony/render";
import type { Transition } from "@toony/schema";

function transition(over: Partial<Transition> = {}): Transition {
  return {
    id: "tr-1",
    type: "narration_card",
    gutterHeight: 48,
    text: null,
    sfx: null,
    agentNote: null,
    humanNote: null,
    image: null,
    reviewStatus: "human-edited",
    ...over,
  };
}

const LONG =
  "The tide remembers every name the harbor has ever whispered into the waiting dark of the long night.";

test("the studio consumes the shared wrapped v4 panel layout (#148 parity)", () => {
  // Exactly the call `TransitionBlock` makes for a v4 text panel.
  const plan = layoutTransition(transition({ type: "narration_card", text: LONG }));
  const panel = layoutPanelText(plan, 800, 300);
  assert.ok(panel);
  assert.ok(panel.lines.length > 1, "long narration text must wrap in the studio path too");
  assert.equal(panel.lines.map((l) => l.text).join(" "), LONG);
});

test("the studio consumes the shared wrapped legacy-card layout (#148 parity)", () => {
  const plan = layoutTransition(transition({ type: "title_card", text: LONG }));
  const card = layoutCardText(plan, 800, 300);
  assert.ok(card);
  assert.ok(
    card.lines.filter((l) => l.weight === 700).length > 1,
    "long card detail must wrap in the studio path too",
  );
});

test("the studio sets the same shared band typeface export registers (#148)", () => {
  // `TransitionBlock` sets `fontFamily: BAND_FONT_STACK` on every panel/card line.
  assert.ok(BAND_FONT_STACK.includes("Nunito"));
});
