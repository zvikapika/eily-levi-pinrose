"""Plot world-XY sections of the reference STLs at several Z, save PNG grid."""
import numpy as np, trimesh, matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from pathlib import Path
R = Path(__file__).resolve().parents[2] / "3d"
OUT = Path("/Users/zvika/.hermes/profiles/cad-executor/cache/scratch/pin")
def secs(m, z):
    s = m.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
    if s is None: return []
    return [np.asarray(e)[:, :2] for e in s.discrete]
for n, zs in [("pinruswall", [1.0, 3.5, 6, 10, 14, 17, 20, 24]),
              ("pinrus", [1.5, 4, 8, 15, 30, 38, 42, 49])]:
    m = trimesh.load(R / f"{n}.stl")
    fig, ax = plt.subplots(2, 4, figsize=(20, 18))
    for a, z in zip(ax.flat, zs):
        for p in secs(m, z):
            a.plot(p[:, 0], p[:, 1], "k-", lw=0.8)
        a.set_title(f"{n} z={z}"); a.set_aspect("equal"); a.grid(True, lw=0.3)
        a.set_xticks(np.arange(-150, 0, 10)); a.set_yticks(np.arange(-20, 170, 10))
        a.tick_params(labelsize=6)
    fig.tight_layout(); fig.savefig(OUT / f"sec_{n}.png", dpi=70)
# side views (XZ section at several Y) for both
for n in ["pinruswall", "pinrus"]:
    m = trimesh.load(R / f"{n}.stl")
    fig, ax = plt.subplots(1, 1, figsize=(16, 6))
    lo, hi = m.bounds
    cx = (lo[0] + hi[0]) / 2
    s = m.section(plane_origin=[cx, 0, 0], plane_normal=[1, 0, 0])
    for e in s.discrete:
        e = np.asarray(e); ax.plot(e[:, 1], e[:, 2], "k-", lw=0.8)
    ax.set_aspect("equal"); ax.grid(True, lw=0.3); ax.set_title(f"{n} YZ section at x={cx:.1f}")
    fig.tight_layout(); fig.savefig(OUT / f"side_{n}.png", dpi=70)
print("ok")
