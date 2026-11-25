"""Virtual fit: put each jig on the v6 cover (straight side at y = 90, round end at its far point) and measure overlap."""
import sys, json
from pathlib import Path
import numpy as np, trimesh
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import pinrose_v2 as V, pinrose_v3 as P3
from pinrose_v2 import I
OUT = Path(__file__).resolve().parent.parent / "out_jig"
cov = trimesh.load(Path(__file__).resolve().parent.parent / "out_v6" / "pinrus_v6.stl")
c, b, r = V.load_refs(); o0, i0 = P3.shell_outlines(c); _, in1 = P3.grow(o0, i0)
res = {}
def unflip(m):
    # the STL is saved band-down (print orientation); back to the build frame (top plate at z' 0..3)
    m = m.copy(); m.apply_transform(trimesh.transformations.rotation_matrix(np.pi, [1, 0, 0])); m.apply_translation([0, 0, -m.bounds[0][2]]); return m


def place(m, O, t, n_out, flip_y=False):
    m = unflip(m)
    # jig local: x along the wall, y across (outer = +y straight / -y round), z' (rim at z' = 3, depth = z' - 3)
    t = np.r_[t, 0]; n = np.r_[n_out, 0]; e = np.array([0, 0, 1.0])
    Y = -n if flip_y else n
    X = np.cross(Y, -e)  # so that det [X, Y, -e] = +1
    M = np.eye(4); M[:3, 0] = X; M[:3, 1] = Y; M[:3, 2] = -e; M[:3, 3] = [O[0], O[1], 53.0]
    m = m.copy(); m.apply_transform(M); return m
# straight: left side at y = 90
xl, _ = V.half_width(in1, 90.0); xl2, _ = V.half_width(in1, 100.0)
t = np.array([xl2 - xl, 10.0]); t /= np.linalg.norm(t)
n_out = np.array([-t[1], t[0]]) if (-t[1]) < 0 else np.array([t[1], -t[0]])
js = place(trimesh.load(OUT / "notch_jig_straight.stl"), (xl, 90.0), t, n_out)
# round end: far point
ymin = in1.bounds[1]
jr = place(trimesh.load(OUT / "notch_jig_round.stl"), (V.AXIS_X, ymin), np.array([1.0, 0]), np.array([0, -1.0]), flip_y=True)
for name, j in (("straight@y90", js), ("round@tip_of_round_end", jr)):
    x = I(j, cov)
    v = 0.0 if x.is_empty else float(x.volume)
    pq = trimesh.proximity.ProximityQuery(cov)
    pts, _ = trimesh.sample.sample_surface_even(j, 20000, seed=1)
    d = pq.signed_distance(pts)            # >0 inside the cover
    res[name] = dict(overlap_mm3=round(v, 3), max_penetration_mm=round(float(d.max()), 3), jig_bounds=np.round(j.bounds, 1).tolist())
    j.export(OUT / f"_fit_{name.split('@')[0]}.stl")  # scratch, used by render_jig.py (not committed)
print(json.dumps(res, indent=1))
