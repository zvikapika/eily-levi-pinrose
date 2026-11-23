"""v6 detail: section through a strap boss along the slot (plane x = boss axis) + top view of the bosses."""
import sys
from pathlib import Path
import numpy as np, trimesh, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MPoly, Rectangle
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import pinrose_v6 as P3
import pinrose_v2 as V
A = P3.OUT / "asm"
cov, strap, strap2, motor = (trimesh.load(A / f"{n}.stl") for n in ("cover", "strap", "strap2", "motor"))
bx = V.AXIS_X + V.BOSS_X
fig, (a1, a2) = plt.subplots(1, 2, figsize=(14, 6))
for m, col in ((cov, "#f4f1ea"), (strap, "#cfe3f5"), (strap2, "#cfe3f5")):
    s = m.section(plane_origin=[bx, 0, 0], plane_normal=[1, 0, 0])
    if s is None: continue
    for e in s.discrete:
        e = np.asarray(e); a1.add_patch(MPoly(np.c_[e[:, 1], e[:, 2]], closed=True, fc=col, ec="#333", lw=.7))
for yb in (V.Y_FACE + V.STRAP_Y, P3.STRAP2_Y):
    z0 = P3.NUT_TOP_Z - P3.NUT_T - P3.NUT_SLOT_CLR
    a1.add_patch(Rectangle((yb - 3.18, z0), 6.35, P3.NUT_T, fc="#888", ec="k"))
    a1.add_patch(Rectangle((yb - 1.5, 8.5), 3.0, 18.5 - 8.5, fc="#555", alpha=.6))
    a1.text(yb, 30, "M3×10 + nut", ha="center", fontsize=8)
a1.set_xlim(52, 96); a1.set_ylim(-1, 33); a1.set_aspect("equal"); a1.grid(True, lw=.3)
a1.set_title("Section through the strap bosses (x = boss axis)\nØ10 boss, Ø3.3 hole, captive M3 nut (grey) in a side slot")
a1.set_xlabel("y (mm)"); a1.set_ylabel("z (mm)")
for e in cov.section(plane_origin=[0, 0, 11], plane_normal=[0, 0, 1]).discrete:
    e = np.asarray(e); a2.add_patch(MPoly(e[:, :2], closed=True, fc="#f4f1ea", ec="#333", lw=.7))
a2.set_xlim(-72, -14); a2.set_ylim(48, 100); a2.set_aspect("equal"); a2.grid(True, lw=.3)
a2.set_title("Plan at nut height (z = 11): the slots open toward\nthe cup (strap 1) and toward the tip (strap 2)")
fig.tight_layout(); fig.savefig(P3.OUT / "pinrose_v6_nut_detail.png", dpi=130)
print("ok")
