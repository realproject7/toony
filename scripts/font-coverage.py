"""Regenerate bundled cmap intervals. Requires local Python fontTools and Node.

Run from the repository root. No downloads or font changes are performed.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import types

# FontTools needs Brotli for WOFF2. Reuse Node's built-in decoder so a separate
# Python Brotli package is not required for this read-only maintenance task.
decoder = types.ModuleType("brotli")
decoder.decompress = lambda data: subprocess.run(
    ["node", "-e", "const z=require('node:zlib');let b=[];process.stdin.on('data',x=>b.push(x));process.stdin.on('end',()=>process.stdout.write(z.brotliDecompressSync(Buffer.concat(b))))"],
    input=data, capture_output=True, check=True,
).stdout
sys.modules["brotli"] = decoder
from fontTools.ttLib import TTFont

rows = {}
for path in sorted(Path("packages/fonts/assets").glob("*.woff2")):
    points = sorted(TTFont(path).getBestCmap())
    intervals = []
    for point in points:
        if intervals and intervals[-1][1] + 1 == point:
            intervals[-1][1] = point
        else:
            intervals.append([point, point])
    rows[path.name] = {
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "ranges": ",".join(format(a, "x") if a == b else f"{a:x}-{b:x}" for a, b in intervals),
    }

target = Path("packages/fonts/src/coverage-data.ts")
unique = list(dict.fromkeys(row["ranges"] for row in rows.values()))
for row in rows.values():
    row["ranges"] = unique.index(row["ranges"])
metadata = json.dumps(rows, indent=2)
import re
metadata = re.sub(r'"ranges": (\d+)', lambda match: '"ranges": RANGES[' + match.group(1) + "]", metadata)
target.write_text(
    "// Generated from bundled font cmap tables by scripts/font-coverage.py.\n"
    "// Coverage is codepoint availability, not a complex-script shaping guarantee.\n"
    + "const RANGES = " + json.dumps(unique, indent=2) + " as const;\n"
    + "export const FONT_COVERAGE_DATA: Record<string, { sha256: string; ranges: string }> = "
    + metadata + ";\n"
)
