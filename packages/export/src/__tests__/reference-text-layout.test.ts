import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutBubble } from "@toony/render";
import { defaultLetteringTextLayout, type LetteringOverlay } from "@toony/schema";
import { composeCut } from "../compose.js";
import { createCanvasMeasure } from "../measure.js";

const fixture: LetteringOverlay = {
  id: "text-frame-fixture",
  cutId: "cut-001",
  speaker: "Speaker",
  kind: "speech",
  text: "가나다\nHello",
  fill: "#ffffff",
  opacity: 1,
  border: null,
  tail: null,
  geometry: { x: 0.1, y: 0.1, width: 0.8, height: 0.3 },
  overflow: false,
  reviewStatus: "draft",
  textColor: "#111111",
  fontFamily: "noto-sans-kr",
  fontSize: 30,
  verticalAlign: "middle",
  textLayout: defaultLetteringTextLayout(),
};

async function inkBounds(width: number) {
  const height = width * 1.25;
  const plan = layoutBubble(fixture, width, height, { measure: createCanvasMeasure() });
  const output = await composeCut([fixture], null, width, { panelAspect: 1.25 });
  const { x, y, width: fw, height: fh } = plan.textFrame;
  const left = Math.ceil(x),
    top = Math.ceil(y),
    w = Math.floor(fw),
    h = Math.floor(fh);
  const pixels = output.canvas.getContext("2d").getImageData(left, top, w, h).data;
  let minY = h,
    maxY = -1;
  for (let py = 0; py < h; py++)
    for (let px = 0; px < w; px++) {
      const i = (py * w + px) * 4;
      if ((pixels[i] ?? 255) < 80 && (pixels[i + 1] ?? 255) < 80 && (pixels[i + 2] ?? 255) < 80) {
        minY = Math.min(minY, py);
        maxY = Math.max(maxY, py);
      }
    }
  assert.ok(maxY > minY, "actual rendered text pixels must exist");
  return { center: top + (minY + maxY) / 2, frameCenter: y + fh / 2, plan, output };
}

test("actual Korean/Latin raster ink is centered in the shared text frame at two export widths", async () => {
  for (const width of [400, 800]) {
    const result = await inkBounds(width);
    assert.ok(
      Math.abs(result.center - result.frameCenter) <= 2,
      `${width}: ${result.center} vs ${result.frameCenter}`,
    );
  }
});

test("reference text layout survives JSON persistence without changing exported pixels", async () => {
  const a = await composeCut([fixture], null, 800, { panelAspect: 1.25 });
  const restored: LetteringOverlay = JSON.parse(JSON.stringify(fixture));
  const b = await composeCut([restored], null, 800, { panelAspect: 1.25 });
  assert.deepEqual(a.canvas.toBuffer("image/png"), b.canvas.toBuffer("image/png"));
});
