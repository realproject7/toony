// Structural validation of the authored planning artifacts (#311).
//
// These validators are handed a value, a path and a collector and nothing else,
// so everything that needs a filename or the project character registry — the
// filename agreement, the brief revision comparison, character-ref resolution —
// is tested against the readers in `@toony/project-io`, not here.

import assert from "node:assert/strict";
import { test } from "node:test";
import { IssueCollector, type ValidationIssue } from "../errors.js";
import {
  EPISODE_SCRIPT_FORMAT_VERSION,
  type EpisodeScript,
  isRevisionId,
  PRODUCTION_BRIEF_FORMAT_VERSION,
  type ProductionBrief,
  SCRIPT_CUTS_MAX,
  validateEpisodeScriptValue,
  validateProductionBriefValue,
} from "../script.js";

const REVISION = "b".repeat(64);

function validBrief(): ProductionBrief {
  return {
    briefFormat: PRODUCTION_BRIEF_FORMAT_VERSION,
    intent: "A quiet harbour story about a debt nobody wrote down.",
    audience: "Adult readers who want a slow burn.",
    world: "A working harbour town, late autumn, one week of story time.",
    storyGoals: ["Make the debt feel physical.", "Land the confession in the last beat."],
    contentConstraints: ["No on-page violence."],
    cast: [
      { characterId: "mira", role: "The one who owes.", continuity: "Never removes her coat." },
      { characterId: "sol", role: "The one who is owed." },
    ],
    revisionPolicy: "Revise a goal only with a named reason.",
    planningProfile: {
      geometry: "Tall cuts at the harbour, square cuts indoors.",
      transitions: "Gutters between beats, one scene break at the turn.",
      lettering: "Narration in the gutter, dialogue in panel.",
    },
  };
}

function validScript(): EpisodeScript {
  return {
    scriptFormat: EPISODE_SCRIPT_FORMAT_VERSION,
    episodeId: "ep-001",
    briefRevision: REVISION,
    beats: [
      {
        id: "beat-001",
        purpose: "Establish the harbour and the debt.",
        goals: [{ characterId: "mira", goal: "Get through the morning unseen." }],
        cuts: [
          {
            id: "sc-001",
            intent: "Open on the thing the episode is about.",
            scene: "The harbour before dawn, nets still wet.",
            characters: ["mira"],
            dialogue: [{ speaker: null, text: "The tide keeps its own books." }],
            letteringIntent: "One narration box, low in the frame.",
          },
          {
            id: "sc-002",
            intent: "Put a face on the debt.",
            scene: "Mira counts coins on a crate.",
            characters: ["mira", "sol"],
            dialogue: [{ speaker: "sol", text: "You are short again." }],
          },
        ],
      },
      {
        id: "beat-002",
        purpose: "Turn the debt into a choice.",
        cuts: [
          {
            id: "sc-003",
            intent: "Close on the choice.",
            scene: "Sol holds the ledger out.",
          },
        ],
      },
    ],
  };
}

function issuesFor(run: (c: IssueCollector) => void): ValidationIssue[] {
  const c = new IssueCollector();
  run(c);
  return c.result().issues;
}

function briefIssues(value: unknown): ValidationIssue[] {
  return issuesFor((c) => validateProductionBriefValue(value, "brief", c));
}

function scriptIssues(value: unknown): ValidationIssue[] {
  return issuesFor((c) => validateEpisodeScriptValue(value, "script", c));
}

function assertIssue(issues: ValidationIssue[], path: string, code: string): void {
  assert.ok(
    issues.some((issue) => issue.path === path && issue.code === code),
    `expected ${code} at ${path}, got ${JSON.stringify(issues)}`,
  );
}

test("a well-formed brief and script validate clean", () => {
  assert.deepEqual(briefIssues(validBrief()), []);
  assert.deepEqual(scriptIssues(validScript()), []);
});

test("a minimal brief and script validate clean", () => {
  const brief = {
    briefFormat: PRODUCTION_BRIEF_FORMAT_VERSION,
    intent: "One episode, one idea.",
    audience: "Anyone.",
    world: "One room.",
    storyGoals: ["Land the idea."],
  };
  assert.deepEqual(briefIssues(brief), []);
  const script = {
    scriptFormat: EPISODE_SCRIPT_FORMAT_VERSION,
    episodeId: "ep-001",
    briefRevision: REVISION,
    beats: [
      {
        id: "beat-001",
        purpose: "The only beat.",
        cuts: [{ id: "sc-001", intent: "Say it.", scene: "One room, one lamp." }],
      },
    ],
  };
  assert.deepEqual(scriptIssues(script), []);
});

test("a non-object is rejected at the root", () => {
  assertIssue(briefIssues("not a brief"), "brief", "brief.type");
  assertIssue(scriptIssues([]), "script", "script.type");
});

test("a missing required field is a field-level issue naming the path", () => {
  const brief = validBrief();
  delete (brief as Partial<ProductionBrief>).world;
  assertIssue(briefIssues(brief), "brief.world", "field.required");

  const script = validScript();
  const cut = script.beats[0]?.cuts[0];
  assert.ok(cut);
  delete (cut as Partial<typeof cut>).scene;
  assertIssue(scriptIssues(script), "script.beats[0].cuts[0].scene", "field.required");
});

test("a wrong scalar type is a field-level issue naming the path", () => {
  const brief = validBrief() as unknown as Record<string, unknown>;
  brief.intent = 7;
  assertIssue(briefIssues(brief), "brief.intent", "field.required");
  brief.intent = "back to a string";
  brief.revisionPolicy = 7;
  assertIssue(briefIssues(brief), "brief.revisionPolicy", "field.type");

  const script = validScript();
  const beat = script.beats[1] as Record<string, unknown> | undefined;
  assert.ok(beat);
  beat.purpose = false;
  assertIssue(scriptIssues(script), "script.beats[1].purpose", "field.required");
});

test("storyGoals must be a non-empty array of non-empty strings", () => {
  const brief = validBrief();
  brief.storyGoals = [];
  assertIssue(briefIssues(brief), "brief.storyGoals", "brief.story-goals");
  brief.storyGoals = ["fine", ""];
  assertIssue(briefIssues(brief), "brief.storyGoals", "brief.story-goals");
});

test("a duplicate beat id is rejected", () => {
  const script = validScript();
  const second = script.beats[1];
  assert.ok(second);
  second.id = "beat-001";
  assertIssue(scriptIssues(script), "script.beats[1].id", "script.beat.duplicate-id");
});

test("a duplicate cut id is rejected across the whole script", () => {
  const script = validScript();
  const cut = script.beats[1]?.cuts[0];
  assert.ok(cut);
  cut.id = "sc-001";
  assertIssue(scriptIssues(script), "script.beats[1].cuts[0].id", "script.cut.duplicate-id");
});

test("a script with no beats is rejected", () => {
  const script = validScript();
  script.beats = [];
  assertIssue(scriptIssues(script), "script.beats", "script.beats");
});

test("a beat with no cuts is rejected", () => {
  const script = validScript();
  const beat = script.beats[1];
  assert.ok(beat);
  beat.cuts = [];
  assertIssue(scriptIssues(script), "script.beats[1].cuts", "script.beat-cuts");
});

test("an unknown key is rejected at every nested level of the brief", () => {
  const brief = validBrief() as unknown as Record<string, unknown>;
  brief.targetCutCount = 100;
  const note = (brief.cast as Record<string, unknown>[])[0] as Record<string, unknown>;
  note.lockstring = "nope";
  (brief.planningProfile as Record<string, unknown>).panelAspect = 1.4;
  const issues = briefIssues(brief);
  assertIssue(issues, "brief.targetCutCount", "brief.unknown-key");
  assertIssue(issues, "brief.cast[0].lockstring", "brief.unknown-key");
  assertIssue(issues, "brief.planningProfile.panelAspect", "brief.unknown-key");
});

test("an unknown key is rejected at every nested level of the script", () => {
  const script = validScript() as unknown as Record<string, unknown>;
  script.referenceWidth = 800;
  const beats = script.beats as Record<string, unknown>[];
  const first = beats[0] as Record<string, unknown>;
  first.panelAspect = 1.4;
  const goal = (first.goals as Record<string, unknown>[])[0] as Record<string, unknown>;
  goal.lockstring = "nope";
  const cut = (first.cuts as Record<string, unknown>[])[0] as Record<string, unknown>;
  cut.gutterHeight = 48;
  const line = (cut.dialogue as Record<string, unknown>[])[0] as Record<string, unknown>;
  line.font = "nope";
  const issues = scriptIssues(script);
  assertIssue(issues, "script.referenceWidth", "script.unknown-key");
  assertIssue(issues, "script.beats[0].panelAspect", "script.unknown-key");
  assertIssue(issues, "script.beats[0].goals[0].lockstring", "script.unknown-key");
  assertIssue(issues, "script.beats[0].cuts[0].gutterHeight", "script.unknown-key");
  assertIssue(issues, "script.beats[0].cuts[0].dialogue[0].font", "script.unknown-key");
});

test("an unsafe episode id is rejected before it can become a path", () => {
  for (const unsafe of ["../../outside", "a/b", "..", "C:\\work"]) {
    const script = validScript();
    script.episodeId = unsafe;
    assertIssue(scriptIssues(script), "script.episodeId", "script.episode-id.unsafe");
  }
});

test("a wrong format version is rejected on both artifacts", () => {
  const brief = validBrief();
  brief.briefFormat = PRODUCTION_BRIEF_FORMAT_VERSION + 1;
  assertIssue(briefIssues(brief), "brief.briefFormat", "brief.format");

  const script = validScript();
  script.scriptFormat = EPISODE_SCRIPT_FORMAT_VERSION + 1;
  assertIssue(scriptIssues(script), "script.scriptFormat", "script.format");
});

test("a malformed brief revision is rejected", () => {
  for (const bad of ["", "not-a-hash", "B".repeat(64), "b".repeat(63)]) {
    const script = validScript();
    script.briefRevision = bad;
    assertIssue(scriptIssues(script), "script.briefRevision", "script.brief-revision");
  }
  assert.equal(isRevisionId(REVISION), true);
  assert.equal(isRevisionId(undefined), false);
});

test("a dialogue line speaker is a character id or null", () => {
  const script = validScript();
  const line = script.beats[0]?.cuts[0]?.dialogue?.[0];
  assert.ok(line);
  line.speaker = "";
  assertIssue(
    scriptIssues(script),
    "script.beats[0].cuts[0].dialogue[0].speaker",
    "script.line-speaker",
  );
});

test("a script past the cut cap is rejected at the field", () => {
  const script = validScript();
  const beat = script.beats[0];
  assert.ok(beat);
  script.beats = [beat];
  beat.cuts = Array.from({ length: SCRIPT_CUTS_MAX + 1 }, (_unused, i) => ({
    id: `sc-${i}`,
    intent: "One cut.",
    scene: "One room.",
  }));
  assertIssue(scriptIssues(script), "script.beats", "script.cuts");
});

test("the validators hold no episode length and no fixed roster", () => {
  // P1/P2 at the validator level: two scripts of clearly different lengths and
  // different casts are each valid on their own, because nothing here compares
  // one episode with another or with a project-wide number.
  const short = validScript();
  const long = validScript();
  long.episodeId = "ep-002";
  const beat = long.beats[0];
  assert.ok(beat);
  long.beats = [beat];
  beat.cuts = Array.from({ length: 97 }, (_unused, i) => ({
    id: `sc-${i}`,
    intent: "One cut.",
    scene: "One room.",
    characters: ["nell"],
  }));
  assert.deepEqual(scriptIssues(short), []);
  assert.deepEqual(scriptIssues(long), []);
});
