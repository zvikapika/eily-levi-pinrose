"""Detail of the v5 in-plane snap: section across the snap (plane y = snap_y) + top view of the bracket finger."""
import json, sys
from pathlib import Path
import numpy as np, trimesh, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MPoly
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import pinrose_v5 as P3
A = P3.OUT / "asm"
cov, br = trimesh.load(A / "cover.stl"), trimesh.load(A / "bracket.stl")
ys = json.loads((P3.OUT / "build_log.json").read_text())["snap_y"]
fig, (a1, a2) = plt.subplots(1, 2, figsize=(13, 6))
for m, col in ((cov, "#f4f1ea"), (br, "#9ec3e6")):
    for e in m.section(plane_origin=[0, ys, 0], plane_normal=[0, 1, 0]).discrete:
        e = np.asarray(e); a1.add_patch(MPoly(np.c_[e[:, 0], e[:, 2]], closed=True, fc=col, ec="#333", lw=.7))
a1.set_xlim(-85.5, -76); a1.set_ylim(44, 51); a1.set_aspect("equal"); a1.grid(True, lw=.3)
a1.set_title(f"Section across the snap (y = {ys}): cover wall (white) + bracket (blue)\n0.5 mm bump in a 0.6 mm groove, 1.0 mm wall left outside - invisible")
a1.set_xlabel("x (mm)"); a1.set_ylabel("z (mm, wall at 50)")
for e in br.section(plane_origin=[0, 0, 48.5], plane_normal=[0, 0, 1]).discrete:
    e = np.asarray(e); a2.add_patch(MPoly(e[:, :2], closed=True, fc="#9ec3e6", ec="#333", lw=.7))
a2.set_xlim(-86, -60); a2.set_ylim(-5, 30); a2.set_aspect("equal"); a2.grid(True, lw=.3)
a2.set_title("Bracket from the wall side: 20 x 3 mm spring finger\n(slot 1 mm), bump at the free end")
fig.tight_layout(); fig.savefig(P3.OUT / "pinrose_v5_snap_detail.png", dpi=130)
print("ok")
