#!/bin/bash
# Pinrose v3 pipeline (Eily's changes): build -> checks -> renders -> STEP -> zip. ~30 s.
set -e
cd "$(dirname "$0")/.."
PY=.venv/bin/python
$PY pinrose_v3.py
$PY checks_v3.py > out_v3/_checks_stdout.txt
grep '"ALL_OK"' out_v3/checks.json
$PY render_v3.py
$PY step_v3.py
cd out_v3
rm -f pinrose_v3_printables.zip pinrose_v3_assembly_step.zip
zip -9 -q pinrose_v3_printables.zip pinrus_v3.stl pinruswall_v3.stl motor_strap_v3.stl pinruso.stl
zip -9 -q pinrose_v3_assembly_step.zip pinrose_v3_assembly.step
