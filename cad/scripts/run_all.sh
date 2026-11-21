#!/bin/bash
# Full Pinrose v2 pipeline: build -> checks -> renders -> STEP -> zip. ~3-4 min on the M2.
set -e
cd "$(dirname "$0")/.."
PY=.venv/bin/python
$PY pinrose_v2.py
$PY checks_v2.py > out/_checks_stdout.txt
grep '"ALL_OK"' out/checks.json
$PY render_v2.py
$PY step_v2.py
cd out
rm -f pinrose_v2_printables.zip pinrose_v2_assembly_step.zip
zip -9 -q pinrose_v2_printables.zip pinrus_v2.stl pinruswall_v2.stl motor_strap_v2.stl pinruso.stl
zip -9 -q pinrose_v2_assembly_step.zip pinrose_v2_assembly.step
ls -la *.zip *.png *.stl *.step
