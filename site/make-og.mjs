// Compose the toony.dev share card (og.png) from the brand values.
//
// Run from the repo root after `pnpm install`:
//   node site/make-og.mjs
//
// It draws with the same canvas library the export pipeline uses, so the card is
// reproducible from source rather than a hand-painted binary nobody can regenerate.
// Text is drawn in a system sans; the card carries no product claims, so it does
// not need the curated faces the episode rasters register.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "../packages/export/node_modules/@napi-rs/canvas/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));

// Brand values, mirroring site/styles.css.
const CANVAS = "#fcf9f3";
const INK = "#14120c";
const MUTED = "#6b655a";
const GOLD = "#f4ce42";
const GOLD_ON = "#4a3a00";
const PINK = "#fc0e4c";

const W = 1200;
const H = 630;
const PAD_X = 80;

const canvas = createCanvas(W, H);
const ctx = canvas.getContext("2d");

ctx.fillStyle = CANVAS;
ctx.fillRect(0, 0, W, H);

// Eyebrow pill.
const eyebrow = "LOCAL-FIRST WEBTOON PRODUCTION";
ctx.font = "700 20px sans-serif";
ctx.letterSpacing = "1.6px";
const eyebrowWidth = ctx.measureText(eyebrow).width;
const pillW = eyebrowWidth + 40;
const pillH = 44;
const pillY = 96;
ctx.fillStyle = GOLD;
ctx.beginPath();
ctx.roundRect(PAD_X, pillY, pillW, pillH, pillH / 2);
ctx.fill();
ctx.fillStyle = GOLD_ON;
ctx.textBaseline = "middle";
ctx.fillText(eyebrow, PAD_X + 20, pillY + pillH / 2 + 1);
ctx.letterSpacing = "0px";

// Headline.
ctx.fillStyle = INK;
ctx.font = "800 66px sans-serif";
ctx.textBaseline = "alphabetic";
ctx.fillText("Your webtoon lives", PAD_X, 250);
ctx.fillText("in a folder.", PAD_X, 322);

// Supporting line.
ctx.fillStyle = MUTED;
ctx.font = "400 25px sans-serif";
ctx.fillText("An agent does the planning and the busywork.", PAD_X, 386);
ctx.fillText("You do the part that needs taste.", PAD_X, 422);

// Wordmark.
ctx.fillStyle = INK;
ctx.font = "800 30px sans-serif";
const mark = "toony.dev";
ctx.fillText(mark, PAD_X, 520);
ctx.fillStyle = PINK;
ctx.fillText(".", PAD_X + ctx.measureText(mark).width, 520);

const cat = await loadImage(readFileSync(join(HERE, "toony-cat.png")));
const catH = 380;
const catW = Math.round((cat.width * catH) / cat.height);
ctx.drawImage(cat, W - PAD_X - catW, (H - catH) / 2, catW, catH);

writeFileSync(join(HERE, "og.png"), canvas.toBuffer("image/png"));
console.log(`og.png written: ${W}x${H}`);
