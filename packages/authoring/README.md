# @toony/authoring

The authoring orchestration shared by the `toony` CLI and Toony Studio. One
function, `compileEpisodeDraft`, turns an episode script into a checked draft
exactly the way `toony draft compile` does:

1. read the script (the project's own `script/episodes/<id>.json`, or a named file);
2. refuse a missing or invalid script;
3. compile it with the project's lettering theme, when an installed pack provides it;
4. refuse a draft that does not validate with its project;
5. lint what a draft can lint without art (character refs, craft, bubble overflow);
6. measure the page geometry, and grade it against a craft band when one is given;
7. diff it against the episode as the project holds it now;
8. write `.toony/drafts/<id>.json`, recording the project state it was compared against.

Applying stays a separate step (`applyDraft` in `@toony/project-io`). Pack
discovery and reading a band file are the caller's job, so this package has no
dependency on `@toony/packs` and no filesystem input beyond the project.

The CLI formats the result as `toony draft compile` output. Studio creates new
episodes from agent-written scripts with it and then applies the draft.
