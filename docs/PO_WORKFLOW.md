# Development workflow

Updated 2026-10-18. Development planning is local. GitHub holds code deliveries.

## Local work records

Read `git config --get toony.internalDir` to locate the local planning folder.
Its `START.md` gives the current outcome and next action. Its `ROADMAP.md` holds
the outcome tickets, dependencies and acceptance criteria. Detailed research,
experiment records, decisions and verification logs stay there.

That folder lives outside the code repository, has no remote, and must never be
copied into a commit, issue, PR or release. If it is unavailable, report that
fact instead of creating a GitHub backlog. Do not create GitHub issues, project
boards or discussion threads unless the operator explicitly requests them.

## Delivery

1. One implementer owns one coherent outcome. Use a descriptive feature branch;
   a GitHub issue number is not required. Reuse a suitable checkout. Create a
   worktree when isolation actually helps.
2. Make local commits and run focused checks while implementing. Keep the local
   ticket current at meaningful boundaries, not after every command.
3. Bundle compatible completed outcomes into one PR when they share integration,
   release timing and rollback boundaries. Split a schema migration from
   unrelated changes. Do not wait for an entire epic to open a useful PR.
4. Run `./scripts/verify-release.sh <branch>` on the settled candidate. The
   required clean-checkout gate remains Node 20 and 24. Reuse valid evidence for
   unchanged code; rerun affected checks after changes. Hosted CI stays disabled.
5. A PR contains the concrete behavior change, necessary technical explanation,
   validation summary and material limitations. Keep internal ticket contents,
   local evidence paths, private research and session transcripts out of it.
6. Merge through a PR. Never push directly to `main`. Mark a local ticket done
   only when its complete acceptance and required delivery evidence exist.

Independent review is opt-in. Record `review not selected` locally when it is
not requested. Routine implementation choices do not need another approval.
Material changes to agreed visual behavior, copy, acceptance or authority go to
the operator before implementation. The operator owns final visual acceptance.

See [VERIFICATION.md](./VERIFICATION.md) for the existing gate contract.

## Data boundaries

Repository privacy does not make internal material suitable for code history.
Never commit secrets, credentials, private projects or reference captures,
studied-work names or source links, local absolute paths or session names,
private model/checkpoint/runtime/accelerator identifiers, or provider account
identifiers. Shipped third-party integration names are permitted.

Run `pnpm scan` and inspect the intended publication diff. Its credential and
path checks do not prove that all private information is absent. A missing local
name list is an unchecked scope, not a pass. Keep that list outside tracking.

Research may contribute general craft principles and synthetic test cases.
Do not copy reference characters, dialogue, panels or distinctive scene layouts.
Packs remain data and do not supply story semantics during planning. Building
and running agent drawing and art changes through the local ComfyUI engine is
core product work and needs no experiment ticket or budget approval. A paid
remote provider still needs the operator's yes.

## Implementation rules

- Preserve existing project readability and preview/export consistency.
- No mock, stub, placeholder, or temporary runtime results. <!-- no-stub-ignore: states the no-stub rule itself -->
- Name test fixtures explicitly and keep them separate from quality evidence.
- Use the simplest implementation that meets the accepted outcome.
- Raise test floors with added tests as required by the existing gate.
- Keep publication, payments, credentials and production infrastructure within
  the operator's existing authority boundaries.

Issue numbers in pre-import code comments and historical technical examples
refer to the legacy repository. They are not tickets in this repository.
