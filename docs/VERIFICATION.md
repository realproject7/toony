# Local release verification

Run `pnpm verify-release <branch>` before merging. Hosted CI stays disabled.
The gate uses a clean checkout, a frozen install, and Node 20 and 24. It records
the selected Node, pnpm entry/version, and the Node executed by pnpm. A runtime
mismatch fails before product checks. Shell wrappers that substitute a bundled
Node are skipped; the selected JavaScript pnpm/Corepack entry runs with the
selected Node, including nested pnpm commands.

Each stage runs once. Its complete output and exit status are retained in the
`toony-release-logs-*` directory printed at startup, outside the scratch checkout.
The final stage line links its log. Failures include the output tail, including
install and test-compile failures; inspect the retained log for earlier output.
Successful check and coverage stages also show their inspection counts. If the
scratch checkout disappears, the gate says so without replacing the original
log. Delete the printed log directory when its evidence is no longer needed.

Checkouts and child `TMPDIR`s are private to each run. The pnpm content-addressed
store remains shared to reuse downloaded dependencies. This does not isolate a
run from external store cleanup or corruption. Logs preserve those failures;
concurrent runs are not a reason to delete another run's scratch directories.

The release gate also requires the source checkout's ignored
`.toony/public-safety-names.json`. It copies that private name list into the
scratch checkout with mode `0600`, then runs the public-safety scanner with
`--require-names` on both Node majors. A missing, tracked, malformed or unusable
name source fails delivery. Keep the list untracked; never include its contents
in code history or public verification receipts. Name findings identify source
entry numbers without printing the names.

For routine work, `pnpm scan` can run without a name source and explicitly
reports `names NOT CHECKED`. That result does not satisfy the release gate's
required name check.

## What must have run

`scripts/test-baseline.json` pins package identities and per-package passed-test
floors, plus one floor for the `pnpm test:verification` controls under
`verification`. A floor is never lowered from the candidate being judged; the
source commit and evidence describe where the floors came from. A missing test
script, omitted test task, incomplete summary, duplicate summary,
failed/cancelled test, or reduced passed count fails the gate. New test packages
must also report complete nonzero runs.

A floor may trail the real count by at most `FLOOR_SLACK` tests (3, in
`scripts/check-test-results.mjs`). Beyond that the gate fails and names the
number to set. So raising a floor is part of adding tests: the PR that adds them
raises the floor to the count it produces, and a floor can never again fall so
far behind that a whole test file disappears unnoticed (#322). Raising is always
safe. Lowering is the case the independence rule guards, and it goes through a
declared reduction.

For a legitimate reduction, add an entry to `reductions` in the same PR:

```json
"@toony/example": {
  "minimum": 12,
  "reason": "Removed duplicate cases after consolidating the parser; see this PR's review."
}
```

The entry must name an existing baseline package. Use zero only to deliberately
retire its test task. Keep the original independent floor and explain the
reduction; the gate prints that declaration on every run. Review the declaration
as part of the change. Do not regenerate floors from the run being judged.

The parser uses explicit TAP (`#`) and Node 24 spec (`ℹ`) summary markers, with
package identities from Turbo prefixes. It does not depend on POSIX character
classes or locale. The September 2026 zero-count failure came from `ℹ` being
classified as alphanumeric under `C.UTF-8`; the same log counted correctly in
`C`. It was not an ANSI defect or evidence that the tests did not run. Controls
cover both reporters/locales, color escapes, missing tasks and incomplete output.

## Scoped verification controls

`pnpm test:verification` runs the infrastructure controls. They come in three
groups.

The pinned TypeScript compiler runs against isolated fixture configs and actual
output files. It covers seven emit-precedence cases, incremental/composite
build-info paths, and rejected inline flags. A second task claiming the actual
emit directory must produce a checker finding. Build-info writes are measured
separately: the output checker protects JavaScript/declaration emit directories,
not build-info files.

The test-log parser controls cover both Node reporters and locales, color
escapes, masked package identities, a declared count reduction, a deleted
package test script, and stage logs that survive a failure.

The public-safety scanner controls cover the name matcher and the scan's own
honesty. A studied-work name is found through a plain wrap, a prefixed wrap and
a hyphenated wrap, while ordinary prose carrying the same words stays unflagged.
A finding reports the source entry the operator would count in their own file,
and never the name. A name source that is missing, unusable or tracked by git, a
blank entry, a tracked file or format the scan could not read, and the scanner
reached through a symlinked path each have a control of their own. The
credential rules run whether or not there is a name source.

These controls run once per Node major in the release gate. They are
deliberately outside `pnpm check`, keeping the frequent editing loop fast. The
gate reports stage duration, and each PR's verification receipt records measured
cost. No second baseline test run is required by the coverage guard. Their count
is read back from the retained stage log by
`check-test-results.mjs --verification` and held to the `verification` floor,
because the package coverage stage keys on turbo package prefixes and these
controls have none.

`pnpm test:verification` reported 40 controls on 2026-09-22 and 42 on 2026-10-13. They measured 2.5 seconds on Node
20 and 2.3 seconds on Node 24 in a warm working tree on the development Mac on
2026-09-22. The gate runs them from a fresh clone, where a cold start costs
more, and prints that stage's own duration on every run. Read the run, not this
line. The runtime probes took 2.7 and 3.4 seconds on 2026-09-21. Host load
changes wall time. The coverage check only reads manifests and the existing test
log.

## Scale fixture

`pnpm scale-fixture` runs the synthetic sixty-cut fixture (#314) on its own: it
builds a sixty-cut episode into a scratch directory, drives validate, both
`toony plan` forms, sixty imports, both lint commands, measure and the three
exports over it, and prints one record of exit code, whole-second wall-clock
and output volume per stage, with the fixture's limits clause. The same test
runs inside `toony-cli`'s test task, so the release gate runs it once per Node
major and its record lives in the retained `test` stage log, on the lines
prefixed `scale-fixture:`. Timings are recorded and never gated; the verdict
turns on control flow and output volume only. `docs/SCALE_FIXTURE.md` holds the
record from one run and states what the fixture cannot prove.
