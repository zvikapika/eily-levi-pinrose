import numpy as np, trimesh, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pinrose_v2 as P
for f in [P.OUT / "asm" / "bracket.stl", P.OUT / "pinruswall_v2.stl"]:
    m = trimesh.load(f)
    print(f.name, m.is_watertight, len(m.faces))
    for b in m.split(only_watertight=False):
        print("   body", len(b.faces), round(float(b.volume), 3), np.round(b.bounds, 2).tolist(), b.is_watertight)
m = trimesh.load(P.OUT / "asm" / "bracket.stl")
for xy in [(-43.27, 15.49), (-43, 60), (-30, 10), (-43, 100)]:
    loc, _, _ = m.ray.intersects_location([[xy[0], xy[1], 20]], [[0, 0, 1]])
    print(xy, "hits", np.round(np.asarray(loc).reshape(-1, 3)[:, 2], 2), "contains@48.5", m.contains([[xy[0], xy[1], 48.5]]))
