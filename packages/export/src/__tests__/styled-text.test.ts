import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutBubble } from "@toony/render";
import {
  defaultLetteringTextLayout,
  type LetteringOverlay,
  reconcileLetteringText,
  styleLetteringRange,
} from "@toony/schema";
import { composeCut } from "../compose.js";
import { createCanvasMeasure } from "../measure.js";

const fixture: LetteringOverlay = {
  id: "styled-export",
  cutId: "cut-001",
  speaker: "Speaker",
  kind: "speech",
  text: "Hello 안녕",
  textLayout: defaultLetteringTextLayout(),
  fontFamily: "noto-sans-kr",
  fontSize: 30,
  textRanges: [
    { start: 0, end: 5, style: { textColor: "#ff0000", fontWeight: 700, fontSize: 42 } },
    { start: 6, end: 8, style: { textColor: "#0000ff" } },
  ],
  fill: "#ffffff",
  opacity: 1,
  border: null,
  tail: null,
  geometry: { x: 0.1, y: 0.1, width: 0.8, height: 0.6 },
  verticalAlign: "middle",
  reviewStatus: "draft",
  overflow: false,
};

test("real raster export draws both selected colors and preserves the saved rich document", async () => {
  for (const width of [400, 800]) {
    const a = await composeCut([fixture], null, width, { panelAspect: 1 });
    const b = await composeCut([JSON.parse(JSON.stringify(fixture))], null, width, {
      panelAspect: 1,
    });
    assert.deepEqual(a.canvas.toBuffer("image/png"), b.canvas.toBuffer("image/png"));
    const data = a.canvas.getContext("2d").getImageData(0, 0, width, width).data;
    let red = 0,
      blue = 0;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i] ?? 0) > 180 && (data[i + 1] ?? 255) < 80 && (data[i + 2] ?? 255) < 80) red++;
      if ((data[i + 2] ?? 0) > 180 && (data[i] ?? 255) < 80 && (data[i + 1] ?? 255) < 80) blue++;
    }
    assert.ok(red > 30 && blue > 20, `${width}: red=${red}, blue=${blue}`);
  }
});

test("edited Unicode ranges retain actual-font wrapping and shared positioned styles", async () => {
  const styled = styleLetteringRange(fixture, 6, 8, { fontWeight: 700 });
  const edited = { ...fixture, ...reconcileLetteringText(styled, "Yes! Hello 안녕") };
  const plan = layoutBubble(edited, 800, 800, { measure: createCanvasMeasure() });
  assert.equal(
    plan.lines.flatMap((l) => l.segments ?? []).find((s) => s.text === "안녕")?.fontWeight,
    700,
  );
  assert.equal(plan.overflow, false);
  const output = await composeCut([edited], null, 800, { panelAspect: 1 });
  assert.ok(output.canvas.toBuffer("image/png").length > 1000);
});

test("range measurement selects the variable weight axis without changing legacy metrics", () => {
  const measure = createCanvasMeasure();
  const legacy = measure("Hello", 38, 700, "nunito");
  const css = measure("Hello", 38, 700, "nunito", "css");
  assert.ok(Math.abs(css - 95.91) < 0.02, `bundled bold axis: ${css}`);
  assert.ok(Math.abs(css - legacy) > 3, "the variable font default is not its CSS bold instance");
  assert.equal(
    measure("Hello", 38, 700, "nunito"),
    legacy,
    "CSS mode must reset before a legacy call",
  );
});
