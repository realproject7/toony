// Genre starter templates for `toony init --genre <genre>` (#101).
//
// Each genre seeds a VALID, lint-clean starter episode tuned to the webtoon
// craft study (docs/TOONY-WEBTOON-CRAFT.md §6 hooks, §9 tension arcs): a
// genre-appropriate cold-open plus a short setup→escalation→payoff beat curve,
// using the P1/P2 craft fields now on main — per-cut `shotType`/`palette`/
// `styleTag`/`layer`, bubble `tone` + `sfxMode`, and craft transition kinds with
// `color`/`text`. The scaffolds are intentionally SMALL and deterministic; they
// are seed content an author edits, and the planning heuristics they embody are
// documented in docs/TOONY-PLANNING-HEURISTICS.md.
//
// Lint discipline: these must pass `toony lint` (no warnings), so each cut keeps
// ≤2 dialogue bubbles with short attributed text, no run of ≥4 identical
// `shotType`, and wide bubble boxes that never overflow. Tests pin each genre's
// shape.

import {
  type BubbleGeometry,
  type BubbleKind,
  type BubbleTone,
  type Cut,
  type Episode,
  type EpisodeBundle,
  type LetteringOverlay,
  SCHEMA_VERSION,
  type SequenceItem,
  type SfxMode,
  type ShotType,
  type Transition,
  type TransitionType,
} from "@toony/schema";

/** The documented genre vocabulary for `toony init --genre`. */
export const GENRES = ["romance", "comedy", "action", "thriller", "slice-of-life"] as const;
export type Genre = (typeof GENRES)[number];

/** Narrow an arbitrary string to a supported genre. */
export function isGenre(value: string): value is Genre {
  return (GENRES as readonly string[]).includes(value);
}

// --- Compact per-genre spec -------------------------------------------------
// A genre is authored as plain data; `buildGenreEpisode` expands it into the
// canonical schema records (ids, sequence interleave, defaults). This keeps the
// presets readable and makes the seeded craft fields obvious at a glance.

interface CutSpec {
  shotType: ShotType;
  palette: string;
  /** The cut's image-generation prompt — the seed scene description. */
  prompt: string;
  styleTag?: string;
  layer?: string;
}

interface TransitionSpec {
  type: TransitionType;
  gutterHeight?: number;
  color?: string;
  text?: string;
}

interface OverlaySpec {
  /** 1-based index of the owning cut in `cuts`. */
  cut: number;
  kind: BubbleKind;
  speaker?: string;
  text: string;
  tone?: BubbleTone;
  sfxMode?: SfxMode;
}

interface GenreSpec {
  cuts: CutSpec[];
  /** One transition between each adjacent pair of cuts (length = cuts.length - 1). */
  transitions: TransitionSpec[];
  overlays: OverlaySpec[];
}

/** A wide, short default bubble box that comfortably fits short seeded lines. */
const DEFAULT_BOX: BubbleGeometry = { x: 0.08, y: 0.07, width: 0.84, height: 0.16 };

function pad(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(3, "0")}`;
}

/** Expand a genre spec into a canonical, schema-valid episode bundle. */
function buildGenreEpisode(spec: GenreSpec): EpisodeBundle {
  const cuts: Cut[] = spec.cuts.map((c, i) => ({
    id: pad("cut", i + 1),
    image: null,
    imagePrompt: c.prompt,
    negativePrompt: "",
    shotType: c.shotType,
    palette: c.palette,
    ...(c.styleTag ? { styleTag: c.styleTag } : {}),
    ...(c.layer ? { layer: c.layer } : {}),
  }));

  const transitions: Transition[] = spec.transitions.map((t, i) => ({
    id: pad("tr", i + 1),
    type: t.type,
    gutterHeight: t.gutterHeight ?? 48,
    text: t.text ?? null,
    sfx: null,
    agentNote: null,
    humanNote: null,
    image: null,
    reviewStatus: "draft",
    ...(t.color ? { color: t.color } : {}),
  }));

  const sequence: SequenceItem[] = [];
  spec.cuts.forEach((_, i) => {
    sequence.push({ type: "cut", id: pad("cut", i + 1) });
    if (i < spec.transitions.length) sequence.push({ type: "transition", id: pad("tr", i + 1) });
  });

  const lettering: LetteringOverlay[] = spec.overlays.map((o, i) => ({
    id: pad("ov", i + 1),
    cutId: pad("cut", o.cut),
    speaker: o.speaker ?? "",
    kind: o.kind,
    text: o.text,
    font: "sans-serif",
    fill: "#ffffff",
    opacity: 1,
    border: null,
    tail: null,
    geometry: DEFAULT_BOX,
    overflow: false,
    reviewStatus: "draft",
    ...(o.tone ? { tone: o.tone } : {}),
    ...(o.sfxMode ? { sfxMode: o.sfxMode } : {}),
  }));

  const episode: Episode = {
    schemaVersion: SCHEMA_VERSION,
    id: "ep-001",
    title: "Episode 1",
    sequence,
  };
  return { episode, cuts, transitions, lettering };
}

// --- Genre presets ----------------------------------------------------------
// Cold-open + setup→escalation→payoff, one preset per genre. shotType varies so
// no monotony run forms; dialogue is short + attributed so attribution/density/
// overflow lints stay clean. Craft transitions/tones/sfxMode showcase the P2
// vocabulary where the genre calls for it.

const SPECS: Record<Genre, GenreSpec> = {
  // Romance: dialogue-first withhold over an establishing wide, then draw in.
  romance: {
    cuts: [
      {
        shotType: "establishing_wide",
        palette: "#f3d9e0",
        prompt:
          "Wide establishing shot of a quiet rooftop at dusk; two figures stand apart, the city glowing behind them.",
      },
      {
        shotType: "close_up",
        palette: "#f6e3ea",
        prompt: "Close-up on Mina's eyes, caught between hope and guard.",
      },
      {
        shotType: "medium",
        palette: "#efd2dd",
        prompt: "Medium two-shot: they finally face each other, a careful half-step closer.",
      },
      {
        shotType: "small_centered",
        palette: "#f8eef2",
        prompt: "Small centered cut: two hands almost touching on the railing.",
      },
    ],
    transitions: [
      { type: "gutter" },
      { type: "fade" },
      { type: "palette_shift", color: "#f3d9e0" },
    ],
    overlays: [
      { cut: 1, kind: "speech", speaker: "Mina", text: "You came back." },
      { cut: 2, kind: "thought", speaker: "Mina", text: "He's really here." },
      { cut: 4, kind: "narration", text: "Some distances take years to close." },
    ],
  },

  // Comedy: a serious, ominous open that the next beat undercuts (tonal misdirect).
  comedy: {
    cuts: [
      {
        shotType: "establishing_wide",
        palette: "#3a3f4b",
        prompt:
          "Ominous wide shot: storm clouds boiling over a high-school gate, dramatic shadows.",
        layer: "metaphor",
      },
      {
        shotType: "impact_splash",
        palette: "#ffe08a",
        prompt: "Hard cut reveal: it's just Jun, overslept, sprinting with toast in his mouth.",
        styleTag: "chibi",
      },
      {
        shotType: "medium",
        palette: "#ffe9a8",
        prompt: "Medium shot: Jun skids to a stop in front of the unimpressed hall monitor.",
      },
      {
        shotType: "close_up",
        palette: "#fff2c4",
        prompt: "Close-up punchline: the monitor's deadpan stare.",
      },
    ],
    transitions: [{ type: "scene-break" }, { type: "gutter" }, { type: "beat" }],
    overlays: [
      { cut: 2, kind: "sfx", text: "tmp tmp tmp", sfxMode: "hand_lettered" },
      { cut: 3, kind: "speech", speaker: "Jun", text: "I can explain!", tone: "shout" },
      { cut: 4, kind: "speech", speaker: "Monitor", text: "Late. Again." },
    ],
  },

  // Action: a tight desire/question montage that pulls back to a scale reveal,
  // then a kinetic payoff.
  action: {
    cuts: [
      {
        shotType: "medium",
        palette: "#d94f3a",
        prompt: "Medium shot: a fighter's hands tightening around a worn hilt.",
      },
      {
        shotType: "close_up",
        palette: "#b23a2a",
        prompt: "Close-up: eyes narrowing, breath held.",
      },
      {
        shotType: "establishing_wide",
        palette: "#7a2418",
        prompt:
          "Pull back to a vast establishing wide: the enemy host fills the whole valley (scale reveal).",
      },
      {
        shotType: "impact_splash",
        palette: "#f0c419",
        prompt: "Full-bleed impact splash: the first clash, dust and motion.",
      },
    ],
    transitions: [
      { type: "gutter", gutterHeight: 24 },
      { type: "black_band" },
      { type: "gutter", gutterHeight: 24 },
    ],
    overlays: [
      { cut: 1, kind: "thought", speaker: "Rei", text: "Not one step back." },
      { cut: 4, kind: "sfx", text: "BOOM", sfxMode: "impact_band" },
    ],
  },

  // Thriller: a threat-object cold-open with a sound-cue card, pivoting darker.
  thriller: {
    cuts: [
      {
        shotType: "close_up",
        palette: "#2b2f38",
        prompt:
          "Extreme close-up of a phone lighting up on a dark table — UNKNOWN NUMBER (threat object).",
        layer: "reality",
      },
      {
        shotType: "medium",
        palette: "#23262d",
        prompt: "Medium shot: a silhouette frozen in the doorway, listening.",
      },
      {
        shotType: "establishing_wide",
        palette: "#1b1d22",
        prompt: "Wide establishing shot of the empty house, a single light burning upstairs.",
      },
      {
        shotType: "small_centered",
        palette: "#15171b",
        prompt: "Small centered cut: a hand reaching for the door lock.",
      },
    ],
    transitions: [
      { type: "title_card", text: "RING — RING —", color: "#15110d" },
      { type: "desaturate_repeat" },
      { type: "gutter" },
    ],
    overlays: [
      { cut: 2, kind: "whisper", speaker: "Ana", text: "Who's there?" },
      { cut: 4, kind: "narration", text: "The lock was already open." },
    ],
  },

  // Slice-of-life: a gentle establishing open and a quiet, warm beat.
  "slice-of-life": {
    cuts: [
      {
        shotType: "establishing_wide",
        palette: "#cfe3d8",
        prompt: "Soft morning light spilling across a small, lived-in kitchen.",
      },
      {
        shotType: "medium",
        palette: "#d8e8de",
        prompt: "Medium shot: pouring coffee, steam curling up.",
      },
      {
        shotType: "close_up",
        palette: "#e3efe8",
        prompt: "Close-up: a small, unguarded smile.",
      },
      {
        shotType: "small_centered",
        palette: "#eef5f1",
        prompt: "Small centered cut: two mugs set side by side.",
      },
    ],
    transitions: [{ type: "gutter" }, { type: "gutter" }, { type: "fade" }],
    overlays: [
      { cut: 2, kind: "speech", speaker: "Sora", text: "Morning." },
      { cut: 4, kind: "narration", text: "Ordinary days, quietly kept." },
    ],
  },
};

/** Build the genre-tuned starter episode bundle for a genre. */
export function buildGenreEpisodeBundle(genre: Genre): EpisodeBundle {
  return buildGenreEpisode(SPECS[genre]);
}
