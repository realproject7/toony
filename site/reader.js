// Renders the "Dead Air" episode strip on the landing page.
//
// The sequence, the transition kinds, their heights, colors, and text are copied
// from examples/dead-air/episodes/ep-001 in this repository, so the strip shows
// the real episode rather than a mock. Panel colors mirror the per-kind defaults
// resolved by @toony/render (void #0a0a0a, the text cards #15110d, color_field
// from the transition's own color) and the shared panel text color #f3ece0.
//
// Heights are the authored gutterHeight in project pixels, rescaled to this
// reading column. Note this is NOT what the renderer does: `resolveBandHeight`
// treats gutterHeight as an absolute pixel height with a width-derived floor, so
// the studio draws tr-001 at its full 150px whatever the column width. What this
// strip reproduces is the EXPORT raster composed at project width and then shrunk
// to fit, which is the right model for a fixed-width showcase image.

const PANEL_TEXT = "#f3ece0";
const CARD_FILL = "#15110d";
const PROJECT_WIDTH = 832;

/** The episode sequence: cuts by file, transitions by resolved appearance. */
const SEQUENCE = [
  {
    kind: "cut",
    src: "/episode/cut-001.jpg",
    alt: "A dark radio booth at night, rain streaking the window, an empty chair at the console",
  },
  { kind: "panel", height: 150, fill: "#101618", text: "2:14 AM — LIVE" },
  {
    kind: "cut",
    src: "/episode/cut-002.jpg",
    alt: "Wren at the broadcast microphone in the dark booth, chin resting on her hand",
  },
  { kind: "panel", height: 200, fill: "#16222b", text: null },
  {
    kind: "cut",
    src: "/episode/cut-003.jpg",
    alt: "A glowing red call-line button on the mixing desk, shallow focus",
  },
  { kind: "panel", height: 220, fill: CARD_FILL, text: "One unknown caller. No name. No number." },
  {
    kind: "cut",
    src: "/episode/cut-004.jpg",
    alt: "A hand hovering over a glowing red call-line button on the mixing desk",
  },
  { kind: "panel", height: 180, fill: CARD_FILL, text: "...is someone there?" },
  {
    kind: "cut",
    src: "/episode/cut-005.jpg",
    alt: "The Caller: a hooded figure in shadow, face hidden, in near-monochrome",
  },
  { kind: "panel", height: 300, fill: "#0a0a0a", text: null },
  {
    kind: "cut",
    src: "/episode/cut-006.jpg",
    alt: "A close-up of Wren in the dark booth, wide-eyed and sweating",
  },
  {
    kind: "panel",
    height: 200,
    fill: "#0a0a0a",
    text: null,
    fade: { color: "#000000", length: 160 },
  },
  {
    kind: "cut",
    src: "/episode/cut-007.jpg",
    alt: "The empty booth after the blackout, the console lit only by red",
  },
];

function buildPanel(item, columnWidth) {
  const el = document.createElement("div");
  el.className = "panel";
  // Shrink the authored panel height by the same factor the export raster is
  // shrunk by to fit this column.
  const scaled = Math.round((item.height * columnWidth) / PROJECT_WIDTH);
  el.style.minHeight = `${scaled}px`;
  // The fade span is authored in project pixels against the panel's project
  // height, so it has to shrink with the panel. Expressed as a percentage it
  // stays correct at every column width; as raw px it clamped to zero here and
  // the fade swallowed the whole panel.
  const fadeStart = item.fade ? Math.max(0, 100 - (item.fade.length / item.height) * 100) : 0;
  el.style.background = item.fade
    ? `linear-gradient(to bottom, ${item.fill} 0, ${item.fill} ${fadeStart}%, ${item.fade.color} 100%)`
    : item.fill;
  el.style.color = PANEL_TEXT;
  if (item.text) el.textContent = item.text;
  else el.setAttribute("aria-hidden", "true");
  return el;
}

function render() {
  const host = document.getElementById("reader");
  if (!host) return;
  const columnWidth = host.clientWidth || 384;

  const frag = document.createDocumentFragment();
  for (const item of SEQUENCE) {
    if (item.kind === "cut") {
      const img = document.createElement("img");
      img.src = item.src;
      img.alt = item.alt;
      img.loading = "lazy";
      img.decoding = "async";
      // Intrinsic size of the web-optimised cuts, so the column reserves the
      // right space before they load.
      img.width = 525;
      img.height = 768;
      frag.append(img);
    } else {
      frag.append(buildPanel(item, columnWidth));
    }
  }
  host.replaceChildren(frag);
}

render();

// Re-scale panel heights when the reading column resizes, so the strip keeps the
// same rhythm at every width.
if (typeof ResizeObserver !== "undefined") {
  const host = document.getElementById("reader");
  if (host) {
    let last = host.clientWidth;
    new ResizeObserver(() => {
      if (Math.abs(host.clientWidth - last) < 8) return;
      last = host.clientWidth;
      render();
    }).observe(host);
  }
}
