"""Checks + picture for the connectors: a 17x17 trunking stub pushed into every arm must not touch the sleeve, and the
inside must be one open path (ray from each arm mouth to the junction centre hits nothing)."""
import sys
from pathlib import Path
import numpy as np, trimesh
sys.path.insert(0, str(Path(__file__).resolve().parent))
import connectors as C
from pinrose_v2 import I

rows = []
for name, arms in C.STARTER.items():
    m = C.connector(arms)
    bad = 0.0
    for d, back in arms:
        # trunking stub: exactly PROFILE_W x PROFILE_H, from the hub edge out 30 mm, sitting on its surface
        x0 = C.PROFILE_W / 2 + C.CLR + C.T
        zs = -C.PROFILE_H / 2
        stub = C._box(x0 + 0.5, x0 + 30, -C.PROFILE_W / 2, C.PROFILE_W / 2, zs if back is not None else -C.PROFILE_H / 2, C.PROFILE_H / 2)
        stub.apply_transform(C._frame(d, back))
        x = I(stub, m)
        bad = max(bad, 0.0 if x.is_empty else float(x.volume))
    # open path for the cable: from each mouth toward the centre, a 5 mm cable on the axis
    blocked = []
    for d, back in arms:
        dd = np.asarray(d, float) / np.linalg.norm(d)
        o = dd * (C.PROFILE_W / 2 + C.CLR + C.T + C.SOCKET + 2)
        loc, _, _ = m.ray.intersects_location([o], [-dd])
        t = [float(np.dot(p - o, -dd)) for p in loc]
        blocked.append(any(tt < np.linalg.norm(o) - 0.5 for tt in t))
    rows.append((name, round(bad, 3), "open" if not any(blocked) else "BLOCKED"))
for r in rows:
    print(f"{r[0]:22s} trunking-overlap {r[1]:6.3f} mm3   cable path {r[2]}")

# picture of the starter set
import pyvista as pv
pv.OFF_SCREEN = True
names = list(C.STARTER)
pl = pv.Plotter(off_screen=True, shape=(2, 6), window_size=(2400, 900), border=False)
pl.set_background("white")
for k, n in enumerate(names):
    pl.subplot(k // 6, k % 6)
    m = trimesh.load(C.OUT / f"conn_{n}.stl")
    f = np.hstack([np.full((len(m.faces), 1), 3), m.faces]).astype(np.int64)
    pl.add_mesh(pv.PolyData(np.asarray(m.vertices), f), color="#f4f4f2", smooth_shading=False, specular=0.3)
    c = m.bounds.mean(0)
    pl.camera_position = [tuple(c + [60, -80, 70]), tuple(c), (0, 0, 1)]
    pl.reset_camera(); pl.camera.zoom(1.1)
    pl.add_text(n.replace("_", " "), font_size=10, color="black")
pl.screenshot(C.OUT / "connectors_starter_set.png")
print("picture ok")
