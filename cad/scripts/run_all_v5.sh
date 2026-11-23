#!/bin/bash
# Pinrose v5 pipeline (Eily's changes): build -> checks -> renders -> STEP -> zip. ~30 s.
set -e
cd "$(dirname "$0")/.."
PY=.venv/bin/python
$PY pinrose_v5.py
$PY checks_v5.py > out_v5/_checks_stdout.txt
grep '"ALL_OK"' out_v5/checks.json
$PY render_v5.py
$PY step_v5.py
cd out_v5
rm -f pinrose_v5_printables.zip pinrose_v5_assembly_step.zip
zip -9 -q pinrose_v5_printables.zip pinrus_v5.stl pinruswall_v5.stl motor_strap_v5.stl pinruso.stl
zip -9 -q pinrose_v5_assembly_step.zip pinrose_v5_assembly.step
