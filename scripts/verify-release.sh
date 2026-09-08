#!/usr/bin/env bash
#
# The release gate, run locally.
#
# This is what `.github/workflows/ci.yml` used to do on every push and pull
# request: a clean checkout, a frozen install, and `pnpm check` + `pnpm test`
# on both supported Node majors. The workflow is disabled (see its header), so
# this script is the gate. Run it before merging anything.
#
# It clones the repository into a scratch directory so a stale `node_modules`,
# a warm turbo cache, or an uncommitted file cannot make a branch look green
# when a fresh checkout would fail. That is not paranoia: the retired CI once
# failed a documentation-only branch that passed in the working tree.
#
#   ./scripts/verify-release.sh              # verify the current branch
#   ./scripts/verify-release.sh main         # verify a specific ref
#
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REF="${1:-$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)}"
WORK="${TMPDIR:-/tmp}/toony-verify-$(echo "$REF" | tr '/' '-')"
NODE_VERSIONS=("20" "24")

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
else
  echo "verify-release: nvm not found; cannot switch Node majors." >&2
  echo "Install nvm, or run 'pnpm install --frozen-lockfile && pnpm check && pnpm test' by hand on Node ${NODE_VERSIONS[*]}." >&2
  exit 2
fi

echo "verify-release: cloning $REF into $WORK"
rm -rf "$WORK"
git clone --quiet --branch "$REF" "$REPO_ROOT" "$WORK" || {
  echo "verify-release: could not clone ref '$REF'." >&2
  exit 2
}
cd "$WORK" || exit 2
echo "verify-release: HEAD $(git rev-parse --short HEAD)"

FAILED=0
for V in "${NODE_VERSIONS[@]}"; do
  if ! nvm use "$V" >/dev/null 2>&1; then
    echo "NODE $V: UNAVAILABLE (nvm install $V)"
    FAILED=1
    continue
  fi
  echo
  echo "=== Node $(node -v) ==="
  rm -rf node_modules .turbo

  if ! pnpm install --frozen-lockfile >/dev/null 2>&1; then
    echo "  install: FAIL"
    FAILED=1
    continue
  fi

  if pnpm check >/dev/null 2>&1; then
    echo "  check:   PASS"
  else
    echo "  check:   FAIL"
    pnpm check 2>&1 | tail -20
    FAILED=1
  fi

  if OUT=$(pnpm test --force 2>&1); then
    # node:test defaults to the TAP reporter on Node 20 ("# pass 53") and the
    # spec reporter on Node 24 ("i pass 53"), so match either marker or the
    # gate silently reports zero tests on one of the two majors and calls it a
    # pass. Counting is part of the gate: a run that reports no tests at all is
    # a failure, not a success.
    PASS=$(printf '%s\n' "$OUT" | grep -E '(#|[^[:alnum:]]) pass [0-9]+$' | awk '{s+=$NF} END {print s+0}')
    FAIL=$(printf '%s\n' "$OUT" | grep -E '(#|[^[:alnum:]]) fail [0-9]+$' | awk '{s+=$NF} END {print s+0}')
    PKGS=$(printf '%s\n' "$OUT" | grep -cE '(#|[^[:alnum:]]) pass [0-9]+$')
    if [ "$PASS" -eq 0 ]; then
      echo "  test:    FAIL (command succeeded but reported no tests — reporter or counting is broken)"
      FAILED=1
    elif [ "$FAIL" -ne 0 ]; then
      echo "  test:    FAIL ($PASS passed, $FAIL failed, $PKGS packages)"
      FAILED=1
    else
      echo "  test:    PASS ($PASS passed, $FAIL failed, $PKGS packages)"
    fi
  else
    echo "  test:    FAIL"
    printf '%s\n' "$OUT" | grep -B2 -A8 -iE 'not ok|# fail [1-9]|SyntaxError|Error:' | head -40
    FAILED=1
  fi
done

echo
if [ "$FAILED" -eq 0 ]; then
  echo "verify-release: PASS on Node ${NODE_VERSIONS[*]} — $REF is mergeable."
else
  echo "verify-release: FAIL — do not merge $REF."
fi
rm -rf "$WORK"
exit "$FAILED"
