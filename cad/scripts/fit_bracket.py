"""Fit the wall bracket plate into the cover's open back (cover frame).
Bracket is flipped 180 deg about X (its wall face z_b=0 goes to the cover rim z_c=50):
x_c = x_b + dx, y_c = -y_b + dy, z_c = 50 - z_b. Grid-search dx, dy minimising the worst overlap/maximising clearance."""
import numpy as np, trimesh
from pathlib import Path
from shapely.geometry import Polygon, Point
from shapely import affinity
R = Path(__file__).resolve().parents[2] / "3d"
cov = trimesh.load(R / "pinrus.stl"); br = trimesh.load(R / "pinruswall.stl")

def loops(m, z):
    s = m.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
    return [Polygon(np.asarray(e)[:, :2]) for e in s.discrete]

ls = sorted(loops(cov, 45), key=lambda p: -p.area)
inner_c = ls[1]
plate = Polygon(max(loops(br, 1.5), key=lambda p: p.area).exterior)
pf = affinity.scale(plate, 1, -1, origin=(0, 0))
pts0 = np.asarray(pf.exterior.coords)[::2]

def score(dx, dy):
    sd = []
    for p in pts0:
        P = Point(p[0] + dx, p[1] + dy)
        d = inner_c.exterior.distance(P)
        sd.append(d if inner_c.contains(P) else -d)
    return np.array(sd)

c0 = np.array(pf.centroid.coords[0])
tgt = np.array(inner_c.centroid.coords[0])
base = pts0.copy()
best = None
for th in np.arange(-4, 4.01, 0.25):
    t = np.radians(th)
    Rm = np.array([[np.cos(t), -np.sin(t)], [np.sin(t), np.cos(t)]])
    pts_r = (base - c0) @ Rm.T + tgt
    for dx in np.arange(-1.5, 1.51, 0.1):
        for dy in np.arange(-1.5, 1.51, 0.1):
            pts0 = pts_r
            s = score(dx, dy).min()
            if best is None or s > best[0]:
                best = (s, th, dx, dy)
print("best", best)
s, th, dx, dy = best
t = np.radians(th)
Rm = np.array([[np.cos(t), -np.sin(t)], [np.sin(t), np.cos(t)]])
pts0 = (base - c0) @ Rm.T + tgt
sd = score(dx, dy)
print("theta", th, "centroid plate(flipped)", np.round(c0, 3), "target", np.round(tgt, 3))
pf = Polygon(pts0)
print("inner rim bounds", np.round(inner_c.bounds, 2))
print("best dx=%.2f dy=%.2f  min signed clearance %.3f median %.3f max %.3f" % (dx, dy, sd.min(), np.median(sd), sd.max()))
q = np.asarray(affinity.translate(pf, dx, dy).exterior.coords)
for i in np.argsort(sd)[:6]:
    print("  tight at", np.round(q[i], 1), round(sd[i], 3))
for i in np.argsort(sd)[-4:]:
    print("  loose at", np.round(q[i], 1), round(sd[i], 3))
