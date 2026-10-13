# PO Workflow

This repository follows a ticket-first workflow. Updated 2026-10-13.

## Delivery

1. A GitHub issue states the outcome: the goal, what a reader can observe when it
   is done, the code and docs it touches, and the exact commands that prove it.
   One issue per coherent outcome. An EPIC groups outcomes that share a roadmap
   and keeps its body as the current status table.
2. One implementer owns the outcome end to end on a `task/<issue>-<slug>` branch
   in its own worktree. Compatible outcomes that share a release boundary may
   ship in one PR. A schema migration or a public contract change ships alone.
3. The settled candidate runs `./scripts/verify-release.sh <branch>` once, on
   Node 20 and 24. That gate is the merge requirement. Hosted CI stays disabled;
   see [VERIFICATION.md](./VERIFICATION.md).
4. The PR merges through GitHub. Nothing is pushed to `main` directly.
5. A ticket closes only when its whole outcome landed. Partial scope stays open
   and says what is left.

Independent review is opt-in. It runs when the operator asks for it in the
current task, or when a change touches payments, auth, a migration, a public
contract or something hard to roll back and the operator says yes to a
recommendation. The earlier rule of two independent reviews at the exact tip of
every M/L change was retired on 2026-10-13. Speed and a single honest gate beat
ceremony.

## Public Repository Safety

This repository is public. The authoritative list of what may never enter a
tracked file, commit, issue, PR or review comment is in Epic #1: credentials and
tokens, private project files and reference captures, studied-work names and
source links, local absolute paths and session names, model and checkpoint
identifiers, runtime and accelerator identifiers, provider account identifiers.
`pnpm scan` checks what a pattern can check; the rest is read before publishing.

## Implementation Rules

- No mock, stub, placeholder, or temporary runtime code. <!-- no-stub-ignore: states the no-stub rule itself -->
- Use test fixtures only when they are explicitly named fixtures.
- Keep webtoon craft study as internal product research, not GitHub tickets.
- Do not copy specific webtoon characters, panels, compositions, dialogue, or
  distinctive scene structures.
- Prefer the simplest implementation that fully meets the ticket and matches
  established project patterns.
- Raise a test floor in `scripts/test-baseline.json` in the same PR that adds
  the tests. The gate fails when a floor trails the real count.
