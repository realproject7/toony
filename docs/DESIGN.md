# Design Package

The initial Open Design package lives outside this repository:

```txt
<LOCAL_DESIGN_PACKAGE>/toony-design/
```

Implementation tickets should reference the design package paths, but public
issues and pull requests must not include credentials, provider keys, or private
Open Design runtime details.

Core design concept: Production Scroll.

Hard UI rules:

1. The episode sequence is the primary object.
2. The cut canvas is the largest object in focused editing views.
3. Bubble previews are visible in the full episode preview.
4. Transition blocks are editable first-class objects between cuts.
5. Status, counters, and agent activity stay compact. The agent panel shows
   status, the plan, questions and results, never raw logs or tool output.
6. Wallet, Toony account, publish execution, and royalty concepts do not appear.
   The agent connection uses the person's own CLI sign-in and shows only whether
   it is ready.
7. Agent actions are typed Toony tools with visible results. Every change is
   undoable, and replacing a person's lettering always needs their approval.
8. The human workspace is for seeing the work and for the craft only a person
   does well (lettering, balloons, transitions). Requests for everything else go
   through the conversation, not extra buttons.
