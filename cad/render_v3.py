"""Renders for Pinrose v3: assembled (front + see-through back), exploded, section through the motor axis."""
import sys
import numpy as np, trimesh, pyvista as pv
from pathlib import Path
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon as MPoly
sys.path.insert(0, str(Path(__file__).resolve().parent))
import pinrose_v2 as P
import pinrose_v3 as P3

pv.OFF_SCREEN = True
A = P3.OUT / "asm"
L = {n: trimesh.load(A / f"{n}.stl") for n in
     ["cover", "bracket", "strap", "ring", "motor", "flange", "shaft", "coupler", "crank"]}
COL = dict(cover="#f4f1ea", bracket="#e9e4da", strap="#f7f5f0", ring="#efe9dc", motor="#9ea4ab", flange="#8a9097",
           shaft="#6d7279", coupler="#c9a23a", crank="#3a3a3a")


def pvm(m):
    f = np.hstack([np.full((len(m.faces), 1), 3), m.faces]).astype(np.int64)
    return pv.PolyData(np.asarray(m.vertices), f)


def add(pl, name, m, opacity=1.0, offset=(0, 0, 0)):
    mm = m.copy(); mm.apply_translation(offset)
    plastic = name in ("cover", "bracket", "strap", "ring")
    pl.add_mesh(pvm(mm), color=COL[name], opacity=opacity, smooth_shading=False, specular=0.25 if plastic else 0.6,
                specular_power=20, ambient=0.25, diffuse=0.8, metallic=0.0)


def cam(pl, pos, focal, up):
    pl.camera_position = [pos, focal, up]
    pl.reset_camera(); pl.camera.zoom(1.25)


C = np.array([-43, 65, 25.0])
# ---------------- assembled
pl = pv.Plotter(off_screen=True, shape=(1, 2), window_size=(2000, 1100), border=False)
pl.set_background("white")
pl.subplot(0, 0)
for n in ["cover", "ring", "crank"]:
    add(pl, n, L[n])
cam(pl, C + [140, -120, -260], C, (0, 1, 0))
pl.add_text("Assembled - front (visible side): only the cup opening shows", font_size=11, color="black")
pl.subplot(0, 1)
for n in L:
    add(pl, n, L[n], opacity=0.28 if n in ("cover", "bracket") else 1.0)
cam(pl, C + [-170, -110, 230], C, (0, 1, 0))
pl.add_text("Assembled - from the wall side, cover + bracket see-through", font_size=11, color="black")
pl.screenshot(P3.OUT / "pinrose_v3_assembled.png"); pl.close()

# ---------------- exploded (along +z = toward the wall)
off = dict(cover=0, crank=55, coupler=55, shaft=55, flange=55, motor=55, strap=95, ring=125, bracket=150)
pl = pv.Plotter(off_screen=True, window_size=(1600, 1400), border=False)
pl.set_background("white")
for n in L:
    add(pl, n, L[n], offset=(0, 0, off[n]))
cam(pl, C + [-260, -190, 120] + [0, 0, 75], C + [0, 0, 75], (0, 0, 1))
pl.add_text("Exploded (toward the wall): cover | motor + coupler + crank | strap + 2x M3 | ring | wall bracket", font_size=10, color="black")
pl.screenshot(P3.OUT / "pinrose_v3_exploded.png"); pl.close()

# ---------------- detail of the motor housing (no bracket, no motor)
pl = pv.Plotter(off_screen=True, window_size=(1600, 1100), border=False)
pl.set_background("white")
add(pl, "cover", L["cover"])
add(pl, "crank", L["crank"])
cam(pl, np.array([-43, 70, 10]) + [-70, -60, 190], np.array([-43, 70, 10]), (0, 1, 0))
pl.add_text("Cover v3 inside: +3% shell, cup 20 mm, 2 saddles, M3 insert bosses, raised journals, snap catches",
            font_size=9, color="black")
pl.screenshot(P3.OUT / "pinrose_v3_cover_inside.png"); pl.close()

# ---------------- section through the motor axis (plane x = AXIS_X), matplotlib
fig, ax = plt.subplots(figsize=(16, 6.5))
order = ["cover", "bracket", "ring", "strap", "motor", "flange", "shaft", "coupler", "crank"]
for n in order:
    m = L[n]
    s = m.section(plane_origin=[P.AXIS_X, 0, 0], plane_normal=[1, 0, 0])
    if s is None:
        continue
    for e in s.discrete:
        e = np.asarray(e)
        ax.add_patch(MPoly(np.c_[e[:, 1], e[:, 2]], closed=True, facecolor=COL[n], edgecolor="#333", lw=0.6, alpha=0.95))
# crank sweep outline
sw = trimesh.load(A / "crank_sweep.stl").section(plane_origin=[P.AXIS_X, 0, 0], plane_normal=[1, 0, 0])
for e in sw.discrete:
    e = np.asarray(e); ax.plot(e[:, 1], e[:, 2], "--", color="#c0392b", lw=0.8)
cs = trimesh.load(A / "coupler_sweep.stl").section(plane_origin=[P.AXIS_X, 0, 0], plane_normal=[1, 0, 0])
for e in cs.discrete:
    e = np.asarray(e); ax.plot(e[:, 1], e[:, 2], "--", color="#c0392b", lw=0.8)
d = P.derived()
ann = [((d["y_rear"] + 2, P.MOTOR_AXIS_Z + 12), f"motor Ø{P.MOTOR_D:g} x {P.MOTOR_L:g}\naxis z={P.MOTOR_AXIS_Z:g}"),
       ((P.Y_FACE + P.STRAP_Y, 31), "strap + 2x M3 into inserts"),
       ((P.CUP_ID_C[1], 24), "cup 20 mm"),
       ((P.CUP_ID_C[1], 6), "ring at the front"),
       ((P.CUP_ID_C[1], -4), "front opening (funnel)"),
       ((P.GATE_Y, 53), "wire gate")]
for (y, z), t in ann:
    ax.annotate(t, (y, z), fontsize=8, ha="center")
ax.set_xlim(-20, 150); ax.set_ylim(-8, 58); ax.set_aspect("equal")
ax.set_xlabel("y (mm, tip ->)"); ax.set_ylabel("z (mm, front face = 0, wall = 50)")
ax.set_title("Section through the motor axis (x = %.1f). Red dashed = coupler and crank swept envelopes" % P.AXIS_X)
ax.grid(True, lw=0.3)
fig.tight_layout(); fig.savefig(P3.OUT / "pinrose_v3_section.png", dpi=130)
# second section: across the motor at the strap (plane y = strap centre)
fig, ax = plt.subplots(figsize=(9, 6))
ys = P.Y_FACE + P.STRAP_Y
for n in order:
    s = L[n].section(plane_origin=[0, ys, 0], plane_normal=[0, 1, 0])
    if s is None:
        continue
    for e in s.discrete:
        e = np.asarray(e)
        ax.add_patch(MPoly(np.c_[e[:, 0], e[:, 2]], closed=True, facecolor=COL[n], edgecolor="#333", lw=0.6))
ax.set_xlim(-87, 1); ax.set_ylim(-3, 53); ax.set_aspect("equal"); ax.grid(True, lw=0.3)
ax.set_title(f"Cross-section at the strap (y = {ys:g}): saddle, bosses + inserts, strap, bracket")
ax.set_xlabel("x"); ax.set_ylabel("z")
fig.tight_layout(); fig.savefig(P3.OUT / "pinrose_v3_section_strap.png", dpi=130)
print("renders ok")

pl = pv.Plotter(off_screen=True, window_size=(1000, 1500), border=False)
pl.set_background("white")
add(pl, "cover", L["cover"])
pl.camera_position = [(-43, 67, 400), (-43, 67, 25), (0, 1, 0)]; pl.reset_camera(); pl.camera.zoom(1.2)
pl.add_text("Cover v3 from the open back", font_size=10, color="black")
pl.screenshot(P3.OUT / "pinrose_v3_cover_top.png"); pl.close()
