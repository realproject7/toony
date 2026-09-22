import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { NAME_SOURCE_DEFAULT } from "../scan-public-safety.mjs";

const scripts = dirname(dirname(fileURLToPath(import.meta.url)));
const scanner = join(scripts, "scan-public-safety.mjs");
const repoRoot = dirname(scripts);

// Every name here is invented for these controls. No studied work is named in
// this repository, which is the rule the scanner exists to enforce.
const SYNTHETIC_NAME = "Northwind Parable";
const SECOND_SYNTHETIC_NAME = "The Ashfall Interval";
const nameSource = JSON.stringify([SYNTHETIC_NAME]);

/** Build a throwaway repository with the given tracked files and scan it. */
function control(files, run) {
  const root = mkdtempSync(join(tmpdir(), "toony-public-safety-"));
  try {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), content);
    }
    for (const args of [
      ["init", "-q"],
      ["add", "-A"],
    ]) {
      const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
    }
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function scan(root) {
  const result = spawnSync(process.execPath, [scanner], { cwd: root, encoding: "utf8" });
  assert.ifError(result.error);
  return { ...result, output: result.stdout + result.stderr };
}

// The ignore file keeps the name source untracked, exactly as it is in this
// repository. The scan reads it from the working directory all the same.
const local = { ".gitignore": ".toony/\n", [NAME_SOURCE_DEFAULT]: nameSource };

test("a tracked file carrying a name from the source fails the scan", () => {
  control(
    {
      ...local,
      "docs/notes.md": `# Notes\n\nTechnique abstracted from ${SYNTHETIC_NAME}, 2026.\n`,
    },
    (root) => {
      const result = scan(root);
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, /\[studied-work-name\] docs\/notes\.md:3/);
      assert.match(result.output, /name source entry 1/);
      // A scanner that republishes the name in its own output is the leak.
      assert.equal(result.output.toLowerCase().includes(SYNTHETIC_NAME.toLowerCase()), false);
    },
  );
});

test("a name split across a line break is still found", () => {
  // The first hand sweep of this class returned "clean" for a file exactly like
  // this one, because the name was wrapped and nothing flattened it.
  const wrapped = SYNTHETIC_NAME.replace(" ", "\n");
  control(
    { ...local, "docs/wrapped.md": `# Wrapped\n\nThe study drew on ${wrapped} for its turns.\n` },
    (root) => {
      const result = scan(root);
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, /\[studied-work-name\] docs\/wrapped\.md:3/);
    },
  );
});

test("a wrapped name survives whatever prefix the continuation line carries", () => {
  // The unprefixed wrap above is the one shape where a plain line join already
  // puts the two halves next to each other. Every format this scanner reads
  // wraps with a prefix instead, and the prefix lands between the halves.
  const [first, second] = SYNTHETIC_NAME.split(" ");
  const cases = [
    ["src/comment.ts", `// Technique from ${first}\n// ${second}, 2026.\nexport const a = 1;\n`, 1],
    [
      "src/jsdoc.ts",
      `/**\n * Technique from ${first}\n * ${second}, 2026.\n */\nexport const b = 2;\n`,
      2,
    ],
    ["docs/quote.md", `# Q\n\n> Drew on ${first}\n> ${second} for turns.\n`, 3],
    ["docs/bullet.md", `# B\n\n- ${first}\n- ${second}\n`, 3],
    ["docs/table.md", `# T\n\n| ${first} |\n| ${second} |\n`, 3],
  ];
  for (const [path, content, line] of cases) {
    control({ ...local, [path]: content }, (root) => {
      const result = scan(root);
      assert.equal(result.status, 1, `${path}: ${result.output}`);
      assert.match(result.output, new RegExp(`\\[studied-work-name\\] ${path}:${line}`));
    });
  }
});

test("research index formats are inspected", () => {
  control(
    {
      ...local,
      "data/index.csv": `title,year\n${SYNTHETIC_NAME},2026\n`,
      "data/index.tsv": `title\tyear\n${SYNTHETIC_NAME}\t2026\n`,
    },
    (root) => {
      const result = scan(root);
      assert.equal(result.status, 1, result.output);
      assert.match(result.output, /\[studied-work-name\] data\/index\.csv:2/);
      assert.match(result.output, /\[studied-work-name\] data\/index\.tsv:2/);
    },
  );
});

test("a clean tree passes and says how many names were checked", () => {
  control(
    {
      ".gitignore": ".toony/\n",
      [NAME_SOURCE_DEFAULT]: JSON.stringify([SYNTHETIC_NAME, SECOND_SYNTHETIC_NAME]),
      "docs/notes.md": "# Notes\n\nNothing here names anything.\n",
    },
    (root) => {
      const result = scan(root);
      assert.equal(result.status, 0, result.output);
      assert.match(result.stdout, /OK \(2 of 2 tracked files inspected; 2 name\(s\) checked\)/);
    },
  );
});

test("a missing name source keeps the gate green and says out loud that it checked nothing", () => {
  control(
    { "docs/notes.md": `# Notes\n\nTechnique abstracted from ${SYNTHETIC_NAME}, 2026.\n` },
    (root) => {
      const result = scan(root);
      // `pnpm scan` runs inside `pnpm check`, which the release gate runs from a
      // fresh clone. An untracked name source cannot exist there, so a hard
      // failure would turn every branch red for a reason unrelated to it. The
      // run stays green and states that names went unchecked, which is also why
      // the leak in this control survives.
      assert.equal(result.status, 0, result.output);
      assert.match(result.stdout, /names NOT CHECKED/);
      assert.match(result.stderr, /studied-work names were NOT checked/);
      assert.ok(result.stderr.includes(NAME_SOURCE_DEFAULT), result.stderr);
    },
  );
});

test("a name source that is present but unusable fails rather than skipping", () => {
  for (const content of ["not json at all", "[]", '["   "]', "[1]", '{"names":[]}']) {
    control({ ".gitignore": ".toony/\n", [NAME_SOURCE_DEFAULT]: content }, (root) => {
      const result = scan(root);
      assert.equal(result.status, 1, result.output);
      assert.match(result.stderr, /public-safety scan: FAILED/);
    });
  }
});

test("a name source that is tracked by git fails the scan", () => {
  // No ignore file here, so the list is committed material. That is the leak
  // the scan exists to prevent, and it cannot be reported as a clean run.
  control({ [NAME_SOURCE_DEFAULT]: nameSource }, (root) => {
    const result = scan(root);
    assert.equal(result.status, 1, result.output);
    assert.match(result.stderr, /tracked by git/);
  });
});

test("the default name source path is ignored by this repository", () => {
  const result = spawnSync("git", ["check-ignore", "-q", NAME_SOURCE_DEFAULT], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, `${NAME_SOURCE_DEFAULT} must stay untracked: ${result.stderr}`);
});

test("tracked formats the scanner cannot read are reported, not counted as checked", () => {
  control(
    { ...local, "docs/notes.md": "# Notes\n", "assets/face.woff2": "binary the scan cannot read" },
    (root) => {
      const result = scan(root);
      assert.equal(result.status, 0, result.output);
      assert.match(result.stdout, /OK \(2 of 3 tracked files inspected/);
      assert.match(
        result.stdout,
        /not inspected: formats this scanner does not read: \.woff2 \(1\)/,
      );
    },
  );
});

test("the scan still runs when it is reached through a symlinked path", () => {
  // `process.argv[1]` is the path as typed while `import.meta.url` is already
  // resolved through symlinks. An entry point guard that compares them
  // unresolved skips the whole scan here: no output, exit 0, and nothing
  // downstream able to tell that apart from a clean sweep.
  control({ ...local, "docs/notes.md": `# Notes\n\nDrew on ${SYNTHETIC_NAME}.\n` }, (root) => {
    const link = join(root, "scripts-link");
    symlinkSync(scripts, link);
    const result = spawnSync(process.execPath, [join(link, "scan-public-safety.mjs")], {
      cwd: root,
      encoding: "utf8",
    });
    assert.ifError(result.error);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /\[studied-work-name\] docs\/notes\.md:3/);
  });
});

test("a tracked file this scan cannot open is reported, not counted as inspected", () => {
  control(
    { ...local, "docs/a.md": `# A\n\nDrew on ${SYNTHETIC_NAME}.\n`, "docs/b.md": "# B\n" },
    (root) => {
      // Git still tracks the file, so the run has to account for it. Counting it
      // as inspected reports a sweep one file wider than the one that happened,
      // and here that file is the one carrying the name.
      rmSync(join(root, "docs/a.md"));
      const result = scan(root);
      assert.equal(result.status, 1, result.output);
      assert.match(result.stderr, /\[unreadable-tracked-file\] docs\/a\.md/);
      assert.match(result.stderr, /2 of 3 tracked files inspected/);
    },
  );
});

test("the credential rules still run when there is no name source", () => {
  // Assembled here so this control file is not itself a finding.
  const key = `AKIA${"ABCDEFGHIJKLMNOP"}`;
  control({ "config/notes.txt": `key = ${key}\n` }, (root) => {
    const result = scan(root);
    assert.equal(result.status, 1, result.output);
    assert.match(result.stderr, /\[aws-access-key-id\] config\/notes\.txt:1/);
    assert.equal(result.output.includes(key), false);
  });
});
