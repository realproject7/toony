# Sourced by verify-release.sh. Logs live outside the disposable checkout, so a
# removed scratch directory cannot take the evidence with it. Never rerun a
# failing stage merely to recover its output.
run_stage() {
  local stage="$1" log status started
  shift
  log="$LOGS/node-$V-$stage.log"
  started=$SECONDS
  if [ ! -d "$CLONE" ] || [ ! -f "$CLONE/package.json" ]; then
    echo "  $stage: FAIL (scratch checkout disappeared: $CLONE; logs: $LOGS)"
    return 1
  fi
  if "$@" >"$log" 2>&1; then status=0; else status=$?; fi
  if [ ! -d "$CLONE" ] || [ ! -f "$CLONE/package.json" ]; then
    echo "  $stage: FAIL (scratch checkout disappeared during stage: $CLONE; log: $log)"
    tail -30 "$log"
    return 1
  fi
  if [ "$status" -ne 0 ]; then
    echo "  $stage: FAIL (exit $status, $((SECONDS - started))s; log: $log)"
    tail -30 "$log"
    return "$status"
  fi
  echo "  $stage: PASS ($((SECONDS - started))s; log: $log)"
  # Keep shrinking inspection counts and coverage decisions visible on green.
  if [ "$stage" = check ] || [ "$stage" = coverage ] || [ "$stage" = runtime ] || [ "$stage" = test-tasks ]; then
    tail -20 "$log"
  fi
}
