import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadProject } from "../reader.js";
import { buildInitialProject } from "../scaffold.js";
import { readStoryBible, STORY_BIBLE_TEMPLATE } from "../story-bible.js";
import { writeProject } from "../writer.js";

test("story bible is neutral only when absent, blank or the untouched scaffold", async () => {
  const root = await mkdtemp(join(tmpdir(), "toony-bible-"));
  try {
    assert.equal(await readStoryBible(root), "");
    for (const text of [
      "",
      " \n\t",
      STORY_BIBLE_TEMPLATE,
      STORY_BIBLE_TEMPLATE.replace(/\n/g, "\r\n"),
    ]) {
      await writeFile(join(root, "story-bible.md"), text);
      assert.equal(await readStoryBible(root), "");
    }
    await writeFile(join(root, "story-bible.md"), "# Story Bible\nThe ocean is red.\n");
    assert.equal(await readStoryBible(root), "# Story Bible\nThe ocean is red.");
    await rm(join(root, "story-bible.md"));
    await mkdir(join(root, "story-bible.md"));
    await assert.rejects(() => readStoryBible(root), /could not read story-bible\.md/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("new scaffolds omit characters folder; reading preserves legacy folders and registry", async () => {
  const work = await mkdtemp(join(tmpdir(), "toony-bible-scaffold-"));
  const root = join(work, "project");
  try {
    const project = buildInitialProject("bible");
    project.webtoon.characters = [{ id: "hero", name: "Hero", lockstring: "red scarf" }];
    await writeProject(root, project);
    await assert.rejects(() => stat(join(root, "characters")), { code: "ENOENT" });
    await mkdir(join(root, "characters"));
    await writeFile(join(root, "characters/legacy.md"), "legacy notes");
    assert.deepEqual(
      (await loadProject(root)).project.webtoon.characters,
      project.webtoon.characters,
    );
    assert.equal(await readStoryBible(root), "");
    assert.equal(await readFile(join(root, "characters/legacy.md"), "utf8"), "legacy notes");
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
