#!/bin/bash
# Pinrose v6 pipeline (Eily's changes): build -> checks -> renders -> STEP -> zip. ~30 s.
set -e
cd "$(dirname "$0")/.."
PY=.venv/bin/python
$PY pinrose_v6.py
$PY checks_v6.py > out_v6/_checks_stdout.txt
grep '"ALL_OK"' out_v6/checks.json
$PY render_v6.py
$PY step_v6.py
cd out_v6
rm -f pinrose_v6_printables.zip pinrose_v6_assembly_step.zip
zip -9 -q pinrose_v6_printables.zip pinrus_v6.stl pinruswall_v6.stl motor_strap_v6.stl pinruso.stl
zip -9 -q pinrose_v6_assembly_step.zip pinrose_v6_assembly.step
