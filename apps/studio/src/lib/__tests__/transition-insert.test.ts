// Insert-planner tests for the transition editor (#150).
//
// The record must be created exactly once per insert. The old code created it
// inside the `setSequence` functional updater, so React StrictMode's dev
// double-invocation forked a duplicate. These run under the node:test harness.

import assert from "node:assert/strict";
import { test } from "node:test";
import type { SequenceItem, Transition } from "@toony/schema";
import { planTransitionInsert } from "../transition-insert.js";

function makeTransition(index: number): Transition {
  return {
    id: `tr-${index}`,
    type: "gutter",
    gutterHeight: 48,
    text: null,
    sfx: null,
    agentNote: null,
    humanNote: null,
    image: null,
    reviewStatus: "human-edited",
  };
}

const TWO_CUTS: SequenceItem[] = [
  { type: "cut", id: "cut-1" },
  { type: "cut", id: "cut-2" },
];

test("planTransitionInsert appends one record and splices one reference at the index", () => {
  const plan = planTransitionInsert([], TWO_CUTS, 1, makeTransition);
  assert.equal(plan.transitions.length, 1);
  assert.equal(plan.transitions[0]?.id, plan.created.id);
  assert.deepEqual(plan.sequence, [
    { type: "cut", id: "cut-1" },
    { type: "transition", id: plan.created.id },
    { type: "cut", id: "cut-2" },
  ]);
});

test("planTransitionInsert calls the record factory exactly once", () => {
  let calls = 0;
  const make = (index: number) => {
    calls += 1;
    return makeTransition(index);
  };
  planTransitionInsert([], TWO_CUTS, 1, make);
  assert.equal(calls, 1);
});

test("StrictMode: an insert creates exactly one record even when setters double-invoke (#150)", () => {
  let makeCalls = 0;
  const make = (index: number): Transition => {
    makeCalls += 1;
    return makeTransition(index);
  };

  // Faithfully model React StrictMode double-invoking a state UPDATER in dev.
  const commit = <S>(prev: S, updater: (p: S) => S): S => {
    updater(prev); // throwaway first invocation
    return updater(prev); // committed second invocation
  };

  // NEW design: the record is minted ONCE, up front; the setters receive plain
  // values. Even modeled as double-invoked updaters, `make` is never called
  // inside them — so no duplication. (Creating inside the updater would make
  // `makeCalls === 2` here and fail this test, exactly the regressed behavior.)
  const plan = planTransitionInsert([], TWO_CUTS, 1, make);
  const transitions = commit<Transition[]>([], () => plan.transitions);
  const sequence = commit<SequenceItem[]>(TWO_CUTS, () => plan.sequence);

  assert.equal(makeCalls, 1, "the transition record must be created exactly once");
  assert.equal(
    transitions.filter((t) => t.id === plan.created.id).length,
    1,
    "exactly one transition record",
  );
  assert.equal(
    sequence.filter((i) => i.type === "transition").length,
    1,
    "exactly one transition reference in the sequence",
  );
});
