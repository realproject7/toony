import assert from "node:assert/strict";
import { test } from "node:test";
import { fontFaceCss, fontFacesCss } from "../css.js";
import { FONT_FAMILIES, getFontFamily } from "../registry.js";

test("fontFaceCss emits one @font-face per weight, self-hosted from baseUrl", () => {
  const nunito = getFontFamily("nunito");
  assert.ok(nunito);
  const css = fontFaceCss(nunito, "/fonts");
  const blocks = css.match(/@font-face/g) ?? [];
  assert.equal(blocks.length, nunito.files.length);
  assert.ok(css.includes('font-family: "Nunito";'));
  assert.ok(css.includes('src: url("/fonts/nunito-400.woff2") format("woff2");'));
  assert.ok(css.includes("font-weight: 700;"));
  // No CDN host appears anywhere in the generated CSS.
  assert.ok(!/https?:\/\//.test(css));
});

test("fontFacesCss covers every curated family and trims a trailing slash", () => {
  const css = fontFacesCss("/fonts/");
  for (const family of FONT_FAMILIES) {
    assert.ok(css.includes(`font-family: "${family.name}";`), `missing ${family.name}`);
    for (const f of family.files) {
      assert.ok(css.includes(`/fonts/${f.file}`), `missing ${f.file}`);
    }
  }
  assert.ok(!css.includes("/fonts//"), "double slash from trailing-slash baseUrl");
});
