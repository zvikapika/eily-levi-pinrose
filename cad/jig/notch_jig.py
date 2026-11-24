"""Cutting jig for a square cable notch in the Pinrose cover wall (Eily, field installation).

Purpose: cut an 18 x 17.5 mm U-notch from the cover's rim anywhere along the wall, so a 17x17 mm electric channel
(white profile) can come in under the rim at any angle/position. PLA wall 1.6 mm.

Use (one jig per wall shape):
  - notch_jig_straight.stl : the straight sides of the teardrop (and near the tip)
  - notch_jig_round.stl    : the round end (inner radius ~41.5 mm)
  1. Slide the jig over the wall from the rim (wall in the slot, the top plate resting on the rim), centre mark on your
     pencil mark.
  2. Drill the 2 corner holes through the jig guides (Ø2.5 drill): the round corners stop the PLA from cracking.
  3. Saw down both saw slots (fine saw, blade <= 0.9 mm) until the blade stops on the slot bottom (17.5 mm).
  4. Score the bottom line with a knife along the window edge (both faces), bend the tab out, file clean.

Print: top plate on the bed (file orientation), no supports, 100 % infill or 6 walls.
Run: cad/.venv/bin/python cad/jig/notch_jig.py  -> cad/out_jig/
"""
from pathlib import Path
import sys
import numpy as np
import trimesh
from shapely.geometry import Polygon, box
from shapely import affinity

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from pinrose_v2 import U, D, prism, save  # noqa: E402

# ------------------------------------------------------------------ parameters (mm)
WALL_T = 1.6
NOTCH_W = 18.0          # notch width (17 mm profile + 1 mm play)
NOTCH_D = 17.5          # notch depth from the rim
KERF = 1.0              # saw slot width (fine saw / razor saw)
CORNER_D = 2.5          # corner relief holes (drill)
TOP_T = 3.0             # top plate resting on the rim
CHEEK_OUT = 4.0         # outer cheek thickness
CHEEK_IN = 3.0          # inner cheek thickness (inside the cover)
DEPTH = 25.0            # cheeks reach this far below the rim
JIG_L = 40.0            # length along the wall (straight)
GAP_STRAIGHT = 0.3      # play on the wall thickness
GAP_ROUND = 0.8         # more play on the round end (its arc is not a perfect circle, +-0.6 mm)
R_INNER = 41.5          # inner radius of the cover's round end (fitted on v4-v6)
JIG_L_ROUND = 34.0

OUT = Path(__file__).resolve().parent.parent / "out_jig"
OUT.mkdir(exist_ok=True)


def zprism(poly, z0, z1):
    parts = list(poly.geoms) if hasattr(poly, "geoms") else [poly]
    ms = [prism(p, z0, z1) for p in parts if p.area > 1e-6]
    return ms[0] if len(ms) == 1 else U(*ms)


def hole_along_v(u, z, d, length=40.0, angle=0.0, centre=(0.0, 0.0)):
    """cylinder whose axis runs across the wall (v direction), at along-position u, height z."""
    c = trimesh.creation.cylinder(radius=d / 2, height=length, sections=48)
    c.apply_transform(trimesh.transformations.rotation_matrix(np.pi / 2, [1, 0, 0]))  # axis z -> y (= v)
    c.apply_translation([u, 0, z])
    if angle:
        c.apply_transform(trimesh.transformations.rotation_matrix(angle, [0, 0, 1], [centre[0], centre[1], 0]))
    return c


def build(round_end=False):
    # local plan frame: x = along the wall, y = across (y = 0 inner wall face, y = WALL_T outer face)
    # print frame z: top plate z 0..TOP_T (bed), cheeks up to TOP_T + DEPTH; depth below the rim = z - TOP_T
    gap = GAP_ROUND if round_end else GAP_STRAIGHT
    zt, zb = TOP_T, TOP_T + DEPTH
    z_slot = TOP_T + NOTCH_D                         # slot bottom = saw stop
    z_hole = z_slot - CORNER_D / 2                   # hole bottom tangent to the notch bottom line
    u_hole = NOTCH_W / 2 - CORNER_D / 2              # hole side tangent to the saw line
    if not round_end:
        foot = box(-JIG_L / 2, -gap / 2 - CHEEK_IN, JIG_L / 2, WALL_T + gap / 2 + CHEEK_OUT)
        wall = box(-JIG_L, -gap / 2, JIG_L, WALL_T + gap / 2)
        slots = [box(s * NOTCH_W / 2, -20, s * (NOTCH_W / 2 + KERF), 20) for s in (1, -1)]
        window = box(-u_hole, -20, u_hole, 20)
        holes = [hole_along_v(s * u_hole, z_hole, CORNER_D) for s in (1, -1)]
        mark = Polygon([(-0.8, WALL_T + gap / 2 + CHEEK_OUT + 0.01), (0.8, WALL_T + gap / 2 + CHEEK_OUT + 0.01), (0, WALL_T + gap / 2 + CHEEK_OUT - 1.2)])
    else:
        # wall = annulus around (0, R): inner face radius R_INNER, the jig centred at angle -90 deg (point (0, 0))
        C = (0.0, R_INNER)
        from shapely.geometry import Point
        half = JIG_L_ROUND / 2 / R_INNER
        sector = Polygon([C] + [(C[0] + 200 * np.sin(a), C[1] - 200 * np.cos(a)) for a in np.linspace(-half, half, 40)])
        ring = lambda r0, r1: Point(C).buffer(r1, 256).difference(Point(C).buffer(r0, 256))
        foot = ring(R_INNER - gap / 2 - CHEEK_IN, R_INNER + WALL_T + gap / 2 + CHEEK_OUT).intersection(sector)
        wall = ring(R_INNER - gap / 2, R_INNER + WALL_T + gap / 2)
        # saw slots are straight (a saw cuts a plane): radial strips through the wall at +-NOTCH_W/2 (chord at the wall)
        a_cut = np.arcsin(NOTCH_W / 2 / R_INNER)
        slots = []
        for s in (1, -1):
            st = box(0, -30, KERF, 30)
            st = affinity.translate(st, NOTCH_W / 2 if s > 0 else -NOTCH_W / 2 - KERF, 0)
            slots.append(affinity.rotate(st, 0, origin=(0, 0)))
        window = box(-u_hole, -30, u_hole, 30)
        holes = [hole_along_v(s * u_hole, z_hole, CORNER_D, 60) for s in (1, -1)]
        ro = R_INNER + WALL_T + gap / 2 + CHEEK_OUT
        mark = Polygon([(-0.8, R_INNER - ro - 0.01), (0.8, R_INNER - ro - 0.01), (0, R_INNER - ro + 1.2)])
        # flip so the outside of the cover is at +y like the straight jig: the ring is centred at (0, R): outer = -y side
        _ = a_cut
    top = zprism(foot, 0, zt)
    cheeks = zprism(foot.difference(wall), zt - 0.01, zb)
    jig = U(top, cheeks)
    cuts = [zprism(s.intersection(foot.buffer(1)), -1, z_slot) for s in slots]
    cuts.append(zprism(window.intersection(foot.buffer(1)), z_slot, zb + 1))
    cuts += holes
    cuts.append(zprism(mark, -1, 0.8))              # centre mark, printed into the top plate's outer edge
    jig = D(jig, *cuts)
    return jig


if __name__ == "__main__":
    for name, rnd in (("notch_jig_straight", False), ("notch_jig_round", True)):
        m = build(rnd)
        r = save(m, OUT / f"{name}.stl")
        nb = len(r.split(only_watertight=False))
        print(name, "watertight", r.is_watertight, "bodies", nb, "size", np.round(r.extents, 2).tolist(), "vol", round(r.volume, 1))
