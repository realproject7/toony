// Pure insert planner for the transition editor (#150).
//
// The record used to be created INSIDE the `setSequence` functional updater, so
// React StrictMode's double-invocation of that updater (Next dev default) forked
// a duplicate transition per insert. Creating the record here — exactly once, at
// the top level of the handler, never inside a state updater — makes an insert
// produce exactly one record no matter how many times the state setters run.
// Pure and React-free, so it runs under the repo-standard `node:test` harness.

import type { SequenceItem, Transition } from "@toony/schema";

export interface PlannedInsert {
  /** The single newly created transition record. */
  created: Transition;
  /** Next transitions list (current + the created record). */
  transitions: Transition[];
  /** Next reading sequence with the created transition spliced in at `index`. */
  sequence: SequenceItem[];
}

/**
 * Plan inserting a new transition at `index` in the reading sequence. `make` is
 * invoked exactly once, here, to mint the record — the caller then applies the
 * returned `transitions`/`sequence` as plain values to its three setters, so no
 * record creation ever happens inside a (double-invoked) state updater.
 */
export function planTransitionInsert(
  transitions: readonly Transition[],
  sequence: readonly SequenceItem[],
  index: number,
  make: (sequenceLength: number) => Transition,
): PlannedInsert {
  const created = make(sequence.length);
  const nextSequence = [...sequence];
  nextSequence.splice(index, 0, { type: "transition", id: created.id });
  return {
    created,
    transitions: [...transitions, created],
    sequence: nextSequence,
  };
}
