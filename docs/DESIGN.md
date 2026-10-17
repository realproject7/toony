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
5. Status, counters, and agent logs stay compact.
6. Wallet, account, publish execution, and royalty concepts do not appear.
7. Agent actions are small, explicit production commands.
