#!/bin/bash
# Pinrose v4 pipeline (Eily's changes): build -> checks -> renders -> STEP -> zip. ~30 s.
set -e
cd "$(dirname "$0")/.."
PY=.venv/bin/python
$PY pinrose_v4.py
$PY checks_v4.py > out_v4/_checks_stdout.txt
grep '"ALL_OK"' out_v4/checks.json
$PY render_v4.py
$PY step_v4.py
cd out_v4
rm -f pinrose_v4_printables.zip pinrose_v4_assembly_step.zip
zip -9 -q pinrose_v4_printables.zip pinrus_v4.stl pinruswall_v4.stl motor_strap_v4.stl pinruso.stl
zip -9 -q pinrose_v4_assembly_step.zip pinrose_v4_assembly.step
