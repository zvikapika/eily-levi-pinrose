"""Probe the reference STLs: bounds, bodies, sections (prints numbers)."""
import sys, numpy as np, trimesh
from pathlib import Path
R = Path(__file__).resolve().parents[2] / "3d"
for n in ["pinruswall", "pinrus", "pinruso"]:
    m = trimesh.load(R / f"{n}.stl")
    print(f"== {n}: wt={m.is_watertight} bodies={len(m.split(only_watertight=False))} vol={m.volume:.0f} faces={len(m.faces)}")
    print("   bounds", np.round(m.bounds, 2).tolist())
    lo, hi = m.bounds
    axis = int(np.argmin(hi - lo))
    for f in np.linspace(0.05, 0.95, 7):
        h = lo[axis] + f * (hi[axis] - lo[axis])
        n_ = np.zeros(3); n_[axis] = 1
        o = np.zeros(3); o[axis] = h
        s = m.section(plane_origin=o, plane_normal=n_)
        if s is None:
            print(f"   axis{axis}={h:.2f}: none"); continue
        p, _ = s.to_2D()
        polys = p.polygons_full
        print(f"   axis{axis}={h:.2f}: {len(polys)} polys", [ (round(q.area,1), [round(v,1) for v in q.bounds]) for q in polys][:12])
