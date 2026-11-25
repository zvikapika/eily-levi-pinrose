"""rev 3: the two end blocks are joined only by the band under the notch: smallest cross-section along the jig."""
import numpy as np, trimesh
from pathlib import Path
O = Path(__file__).resolve().parent.parent / "out_jig"
for n in ("notch_jig_straight", "notch_jig_round"):
    m = trimesh.load(O / f"{n}.stl")
    best = (1e9, None)
    for xp in np.linspace(-15.0, 15.0, 121):
        sec = m.section(plane_origin=[xp, 0, 0], plane_normal=[1, 0, 0])
        a = 0.0 if sec is None else sum(p.area for p in sec.to_2D()[0].polygons_full)
        best = min(best, (a, round(xp, 2)))
    print(n, "weakest cross-section", round(best[0], 1), "mm2 at x =", best[1], "| bodies", len(m.split(only_watertight=False)))
