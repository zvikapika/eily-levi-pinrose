"""Detailed probes: cup slits, floor hole, wall thickness, bracket pillars, ring."""
import numpy as np, trimesh
from pathlib import Path
from shapely.geometry import Point
R = Path(__file__).resolve().parents[2] / "3d"
cov = trimesh.load(R / "pinrus.stl")
br = trimesh.load(R / "pinruswall.stl")
ring = trimesh.load(R / "pinruso.stl")

def sec(m, z, n=(0, 0, 1)):
    s = m.section(plane_origin=np.array(n) * z, plane_normal=n)
    if s is None:
        return []
    from shapely.geometry import Polygon
    return [Polygon(np.asarray(e)[:, :2]) for e in s.discrete]

CX, CY = -43.0, 15.5
# cup: radial sample at angles, find slit z range via rays
print("cup center estimate from section z=20:")
for z in [5, 10, 20, 35]:
    for pg in sec(cov, z):
        if pg.area < 2000:
            print("  z", z, "poly bounds", np.round(pg.bounds, 2), "area", round(pg.area, 1))
# ray from cup centre outward along +Y and -Y at various z
for ang, lab in [(90, "+Y (to tip)"), (-90, "-Y (round end)"), (0, "+X"), (180, "-X")]:
    d = np.array([np.cos(np.radians(ang)), np.sin(np.radians(ang)), 0])
    zs = np.arange(3.2, 50, 0.5)
    hits = []
    for z in zs:
        o = np.array([CX, CY, z])
        loc, _, _ = cov.ray.intersects_location([o], [d])
        r = sorted(np.linalg.norm(loc[:, :2] - o[:2], axis=1)) if len(loc) else []
        hits.append([round(x, 2) for x in r[:4]])
    # print transitions
    prev = None
    print("ray", lab)
    for z, h in zip(zs, hits):
        k = len(h)
        if prev is None or k != prev[0] or (h and prev[1] and abs(h[0] - prev[1][0]) > 0.3):
            print("   z", round(z, 2), h)
        prev = (k, h)
# slit width at z=25: sample angles near 90 and -90
for z in [13, 25]:
    angs = np.arange(60, 120, 0.25)
    open_ = []
    for a in angs:
        d = np.array([np.cos(np.radians(a)), np.sin(np.radians(a)), 0])
        loc, _, _ = cov.ray.intersects_location([[CX, CY, z]], [d])
        r = sorted(np.linalg.norm(loc[:, :2] - [CX, CY], axis=1))
        open_.append(r[0] > 23 if r else True)
    open_ = np.array(open_)
    if open_.any():
        a0, a1 = angs[open_][0], angs[open_][-1]
        print(f"slit +Y z={z}: ang {a0}..{a1}, chord ~{2*20.5*np.sin(np.radians((a1-a0)/2)):.2f}")
# floor hole and floor thickness
for x in [-43, -43 + 19, -43 + 21.5, -43, -60]:
    pass
loc, _, _ = cov.ray.intersects_location([[CX, CY, -5]], [[0, 0, 1]])
print("z hits at cup centre:", np.round(sorted((loc.reshape(-1,3))[:, 2]), 2))
for y in [40, 60, 80, 100, 120]:
    loc, _, _ = cov.ray.intersects_location([[CX, y, -5]], [[0, 0, 1]])
    print(f"z hits at x={CX}, y={y}:", np.round(sorted((loc.reshape(-1,3))[:, 2]), 2))
    loc, _, _ = cov.ray.intersects_location([[CX, y, 20]], [[1, 0, 0]])
    loc2, _, _ = cov.ray.intersects_location([[CX, y, 20]], [[-1, 0, 0]])
    print("   x walls at z=20:", np.round(sorted(np.r_[(loc.reshape(-1,3))[:, 0], (loc2.reshape(-1,3))[:, 0]]), 2))
# tip and round-end walls on axis
for z in [20, 48]:
    loc, _, _ = cov.ray.intersects_location([[CX, 60, z]], [[0, 1, 0]])
    print("tip wall y", z, np.round(sorted((loc.reshape(-1,3))[:, 1]), 2))
    loc, _, _ = cov.ray.intersects_location([[-10, 15.5, z]], [[0, -1, 0]])
    print("round wall y at x=-10", z, np.round(sorted((loc.reshape(-1,3))[:, 1]), 2))
    loc, _, _ = cov.ray.intersects_location([[-43, -10, z]], [[0, -1, 0]])
    print("round wall y at x=-43", z, np.round(sorted((loc.reshape(-1,3))[:, 1]), 2))
# rim: is there a step/lip at the top of walls? radial wall thickness vs z at x side
for z in [4, 20, 40, 45, 48, 49.5]:
    loc, _, _ = cov.ray.intersects_location([[CX, 60, z]], [[1, 0, 0]])
    print("side wall x at y=60 z", z, np.round(sorted((loc.reshape(-1,3))[:, 0]), 2))

print("== bracket")
print(np.round(br.bounds, 2))
for z in [1.0, 2.0, 2.4, 2.6, 3.0]:
    loc, _, _ = br.ray.intersects_location([[-103, 60, -5]], [[0, 0, 1]])
print("plate z at (-103,60):", np.round(sorted((loc.reshape(-1,3))[:, 2]), 2))
s = br.section(plane_origin=[0, 0, 8], plane_normal=[0, 0, 1])
for e in s.discrete:
    e = np.asarray(e)
    print("  pillar z=8:", np.round(e[:, :2].min(0), 2), np.round(e[:, :2].max(0), 2))
s = br.section(plane_origin=[0, 0, 20], plane_normal=[0, 0, 1])
for e in s.discrete:
    e = np.asarray(e)
    print("  pillar z=20:", np.round(e[:, :2].min(0), 2), np.round(e[:, :2].max(0), 2), np.round(e[:, :2], 1).tolist())
s = br.section(plane_origin=[0, 0, 1.2], plane_normal=[0, 0, 1])
for e in s.discrete:
    e = np.asarray(e)
    print("  plate z=1.2 loop:", np.round(e[:, :2].min(0), 2), np.round(e[:, :2].max(0), 2), len(e))
print("== ring", np.round(ring.bounds, 2), "vol", round(ring.volume, 1))
c = ring.bounds.mean(0)
for a in [0, 45, 90, 135, 180, 270]:
    d = np.array([np.cos(np.radians(a)), np.sin(np.radians(a)), 0])
    loc, _, _ = ring.ray.intersects_location([[c[0], c[1], 1.5]], [d])
    print("  ring radial hits", a, np.round(sorted(np.linalg.norm(loc[:, :2] - c[:2], axis=1)), 2))
loc, _, _ = ring.ray.intersects_location([[c[0], c[1], -5]], [[0, 0, 1]])
print("  ring centre z hits", np.round((loc.reshape(-1,3))[:, 2], 2))
