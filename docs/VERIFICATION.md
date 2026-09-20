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

## What must have run

`scripts/test-baseline.json` pins package identities and per-package passed-test
floors from an independent reviewed tree. It is not generated from the candidate
being judged. The source commit and evidence describe where those floors came
from. Additions can exceed a floor. A missing test script, omitted test task,
incomplete summary, duplicate summary, failed/cancelled test, or reduced passed
count fails the gate. New test packages must also report complete nonzero runs.

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

## Compiler controls

`pnpm test:verification` runs the infrastructure controls, including the pinned
TypeScript compiler against isolated fixture configs and actual output files.
It covers seven emit-precedence cases, incremental/composite build-info paths,
and rejected inline flags. A second task claiming the actual emit directory must
produce a checker finding. Build-info writes are measured separately: the output
checker protects JavaScript/declaration emit directories, not build-info files.

These compiler controls run once per Node major in the release gate. They are
deliberately outside `pnpm check`, keeping the frequent editing loop fast. The
gate reports stage duration, and each PR's verification receipt records measured
cost. No second baseline test run is required by the coverage guard.

The 24 scoped controls measured 8.6 seconds on Node 20 and 4.4 seconds on Node 24
on the development Mac on 2026-09-21. The runtime probes took 2.7 and 3.4 seconds.
That adds about 19 seconds across both majors; host load changes wall time. The
coverage check only reads manifests and the existing test log.
