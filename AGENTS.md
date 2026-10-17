# Contributor instructions

Read `docs/PO_WORKFLOW.md` before development work. It supersedes the historical
GitHub ticket-first workflow. Read `docs/VERIFICATION.md` before delivery.

- Locate the local work records with `git config --get toony.internalDir` and
  read their `START.md`. Keep private plans, tickets, research and detailed logs
  outside this repository. Do not invent missing authorization from old notes.
- Do not create GitHub issues, project boards or discussions unless explicitly
  requested. Use concise PRs to deliver compatible completed work together.
- One implementer by default. Independent review is opt-in.
- Never push directly to `main`. The local Node 20 and 24 gate remains required.
- Preserve the operator's pauses, experiment limits and final visual decisions.
- Keep code history free of private research, assets, paths and credentials even
  while the repository is private.
- Historical issue numbers belong to the legacy repository. Current development
  uses local outcome tickets and descriptive branches.

Product-facing command behavior is documented in `docs/AGENT_GUIDE.md`. Current
format and architecture contracts live in `docs/PROJECT_FORMAT.md` and
`docs/ARCHITECTURE.md`. A roadmap describes intended work, not shipped behavior.
