#!/bin/bash
# Run FEFF10 (sequential modules) in every folder under $1 that holds a feff.inp, several at a time.
# FEFF10_BIN: the bin/Seq folder of a FEFF10 build (https://github.com/times-software/feff10, built with gfortran).
# JOBS: how many folders run at once (default: the number of processors; each job needs up to about 1 GB).
# Folders that already hold an xmu.dat are skipped, so a stopped run resumes; FORCE=1 runs them again.
set -euo pipefail
WORK=$1
BIN=${FEFF10_BIN:?set FEFF10_BIN to FEFF10 bin/Seq}
JOBS=${JOBS:-$(nproc)}
MODULES="rdinp atomic pot ldos screen opconsat xsph fms mkgtr path genfmt ff2x sfconv"
export BIN MODULES FORCE
run_one() {
  cd "$(dirname "$1")"
  if [ -s xmu.dat ] && [ "${FORCE:-0}" != 1 ]; then echo "done $PWD (kept)"; return 0; fi
  rm -f xmu.dat
  for m in $MODULES; do "$BIN/$m" > "log-$m.txt" 2>&1 || { echo "FAILED $m in $PWD"; return 1; }; done
  test -s xmu.dat && echo "done $PWD" || { echo "NO xmu.dat in $PWD"; return 1; }
}
export -f run_one
find "$WORK" -name feff.inp | sort | xargs -P "$JOBS" -I{} bash -c 'run_one "$@"' _ {}
