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
NODE_VERSIONS=("20" "24")
PID_FILE=".verify-release-pid"

# One scratch directory per RUN, not per ref. A fixed per-ref path meant a
# second run of the same ref cloned into the directory the first was still
# writing, and git reported the unreadable tree it happened to catch mid-write:
#
#   fatal: unable to read tree (66bc438...)
#   warning: Clone succeeded, but checkout failed.
#
# The named object is present in the source repository, so that message sends
# whoever reads it after a corrupt repository rather than a collision. `mktemp`
# removes the class: concurrent runs of one ref get different directories and
# both work. The ref stays in the path so a stray directory is still traceable.
#
# The checkout goes in a subdirectory because `git clone` refuses a target that
# is not empty, and the run's pid marker has to live beside the checkout rather
# than inside it.
WORK="$(mktemp -d "${TMPDIR:-/tmp}/toony-verify-$(echo "$REF" | tr '/' '-')-XXXXXX")" || {
  echo "verify-release: could not create a scratch directory under ${TMPDIR:-/tmp}." >&2
  exit 2
}
CLONE="$WORK/repo"
# Interrupting a run used to leave a full clone plus two node_modules trees
# behind until the next run of that same ref cleaned them up; with a unique
# directory per run nothing would ever collect them, so the run collects itself.
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM
echo $$ >"$WORK/$PID_FILE"

# No trap runs on SIGKILL, and a directory unique to one run has no later run of
# that ref to sweep it -- which the old fixed path did have. So each run collects
# the ones it can PROVE are abandoned. Each is a full clone plus the two
# node_modules trees the run installed, sitting there until the OS reaps its
# temp directory.
#
# "Prove" is the whole of it, because the failure mode here is deleting a live
# gate's checkout and turning the only merge gate this repo has into a spurious
# FAIL. A directory is collectable only when it carries a pid marker AND that
# process is gone. Two things are therefore deliberately left alone:
#
#   - A directory with no marker. It was made by a version of this script that
#     does not write one: every ref that has not integrated this change, which
#     on the day this lands is most of them. Nothing here can tell such a run
#     from an abandoned one, so it is not ours to collect; its own script clears
#     it on the next run of its ref, exactly as it did before.
#   - A directory whose marker names a live process, including a gate started by
#     another lane on this machine.
#
# A recycled pid reads as live and leaks rather than deleting, which is the
# harmless direction. The age test is redundant cover for the window between
# `mktemp` and the marker being written -- that window is already excluded by
# the marker check above -- and it stays because the operation it guards is
# `rm -rf`.
for dir in "${TMPDIR:-/tmp}"/toony-verify-*; do
  [ -d "$dir" ] || continue
  [ "$dir" = "$WORK" ] && continue
  [ -n "$(find "$dir" -maxdepth 0 -mmin +1 2>/dev/null)" ] || continue
  owner="$(cat "$dir/$PID_FILE" 2>/dev/null)"
  [ -n "$owner" ] || continue
  ps -p "$owner" -o pid= >/dev/null 2>&1 && continue
  echo "verify-release: collecting an abandoned scratch directory ($dir)"
  rm -rf "$dir"
done

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
else
  echo "verify-release: nvm not found; cannot switch Node majors." >&2
  echo "Install nvm, or run 'pnpm install --frozen-lockfile && pnpm check && pnpm test' by hand on Node ${NODE_VERSIONS[*]}." >&2
  exit 2
fi

echo "verify-release: cloning $REF into $CLONE"
git clone --quiet --branch "$REF" "$REPO_ROOT" "$CLONE" || {
  echo "verify-release: could not clone ref '$REF'." >&2
  exit 2
}
cd "$CLONE" || exit 2
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

  # `check` typechecks with each package's tsconfig.json; `build` uses
  # tsconfig.build.json and, for packages/cli, also runs bundle-studio — work no
  # other step performs. A gate that skips build reports green on a repo that
  # does not ship.
  if pnpm build >/dev/null 2>&1; then
    echo "  build:   PASS"
  else
    echo "  build:   FAIL"
    pnpm build 2>&1 | tail -20
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
exit "$FAILED"
