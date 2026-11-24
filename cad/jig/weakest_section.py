import numpy as np, trimesh
from pathlib import Path
O = Path(__file__).resolve().parent.parent / "out_jig"
# the middle of the jig (between the saw slots, |x| < 9) hangs on whatever crosses the planes just below the notch line
for n in ("notch_jig_straight", "notch_jig_round"):
    m = trimesh.load(O / f"{n}.stl")
    res = []
    for z in np.linspace(20.6, 23.4, 8):
        sec = m.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
        P, T = sec.to_2D()
        a = 0.0
        from shapely.geometry import box
        for poly in P.polygons_full:
            from shapely import affinity
            pts = np.c_[np.asarray(poly.exterior.coords), np.zeros(len(poly.exterior.coords)), np.ones(len(poly.exterior.coords))] @ T.T
            from shapely.geometry import Polygon
            g = Polygon(pts[:, :2], [np.c_[np.asarray(h.coords), np.zeros(len(h.coords)), np.ones(len(h.coords))].dot(T.T)[:, :2] for h in poly.interiors])
            a += g.intersection(box(-9, -100, 9, 100)).area
        res.append(round(a, 1))
    print(n, "material holding the middle (|x|<9) just below the notch line, mm2 per plane:", res)
