"""Cutting jig for a square cable notch in the Pinrose cover wall (Eily, field installation).

Purpose: cut an 18 x 17.5 mm U-notch from the cover's rim anywhere along the wall, so a 17x17 mm electric channel
(white profile) can come in under the rim at any angle/position. PLA wall 1.6 mm.

Use (one jig per wall shape):
  - notch_jig_straight.stl : the straight sides of the teardrop (and near the tip)
  - notch_jig_round.stl    : the round end (inner radius ~41.5 mm)
  1. Slide the jig over the wall from the rim (wall in the slot, the top plate resting on the rim), centre mark on your
     pencil mark.
  2. (no drilling - rev 4)
  3. Saw down along both side faces of the opening (fine saw, blade against the face, on the opening side) until the
     blade stops on the band (17.5 mm).
  4. Score the bottom line with a knife along the band's top edge, several passes, right into both saw cuts;
     bend the tab out (pliers), file the corners clean.

Print: as in the file - top plate on the bed (the U upside down), no supports, brim, 100 % infill.
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
CORNER_HOLES = False     # rev 3 dog-bone drill guides (left visible holes outside the notch)
GUIDE_OFFSET = 0.5      # end-block face sits this far outside the notch edge (a 0.5 mm blade then cuts on the line)
CORNER_D = 2.5          # corner relief holes (drill)
TOP_T = 3.0             # top plate resting on the rim
CHEEK_OUT = 4.0         # outer cheek thickness
CHEEK_IN = 3.5          # inner cheek thickness (inside the cover)
DEPTH = 30.0            # cheeks reach this far below the rim (a solid band below the knife slit holds the jig together)
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
    """rev 3 (Eily: the middle part hung on a sliver above the drill hole): no middle part at all.
    Two end blocks (top plate + both cheeks) joined only by a full-width band BELOW the notch line. The opening between
    the blocks IS the notch: its side faces guide the saw, the band's top edge is the saw stop and the knife line,
    and a drill guide sits in each bottom corner (dog-bone relief, 3/4 of its circle in solid material)."""
    gap = GAP_ROUND if round_end else GAP_STRAIGHT
    zt, zb = TOP_T, TOP_T + DEPTH
    z_line = TOP_T + NOTCH_D                         # notch bottom: band top = saw stop = knife line
    u_face = NOTCH_W / 2 + GUIDE_OFFSET              # end-block faces: the blade runs on their inner side
    if not round_end:
        foot = box(-JIG_L / 2, -gap / 2 - CHEEK_IN, JIG_L / 2, WALL_T + gap / 2 + CHEEK_OUT)
        wall = box(-JIG_L, -gap / 2, JIG_L, WALL_T + gap / 2)
        hl = 40
    else:
        C = (0.0, R_INNER)
        from shapely.geometry import Point
        ring = lambda r0, r1: Point(C).buffer(r1, 256).difference(Point(C).buffer(r0, 256))
        # flat outer back (a chord, not an arc): the jig prints lying on it - thicker outer cheek at the ends
        y_flat = C[1] - (R_INNER + WALL_T + gap / 2 + CHEEK_OUT)
        foot = box(-JIG_L_ROUND / 2, y_flat, JIG_L_ROUND / 2, C[1]).difference(Point(C).buffer(R_INNER - gap / 2 - CHEEK_IN, 256))
        wall = ring(R_INNER - gap / 2, R_INNER + WALL_T + gap / 2)
        hl = 60
    top = zprism(foot, 0, zt)
    cheeks = zprism(foot.difference(wall), zt - 0.01, zb)
    jig = U(top, cheeks)
    opening = box(-u_face, -100, u_face, 100)        # straight-sided, so both cuts are parallel planes
    cuts = [zprism(opening.intersection(foot.buffer(1)), -1, z_line)]
    # rev 4 (Eily): no corner drill guides - a dog-bone hole straddling the corner left a visible round bite outside
    # the square after the tab was snapped out. The saw cuts end on the band and the knife score joins them.
    if CORNER_HOLES:
        cuts += [hole_along_v(sx * (NOTCH_W / 2 + GUIDE_OFFSET / 2), z_line, CORNER_D, hl) for sx in (1, -1)]
    return D(jig, *cuts)


def to_print(m, round_end):
    """print orientation: TOP PLATE ON THE BED (= the build frame). Rev 3 was saved band-down and stood on its two thin
    cheek strips, which came loose on Eily's first layer. Top-plate-down, each end block starts on a solid rectangle
    (the top plate spans the wall gap), and the only bridge is the band over the opening (19 mm, cheek strips 3.5-4 mm)."""
    m = m.copy()
    b = m.bounds
    m.apply_translation([-(b[0][0] + b[1][0]) / 2, -(b[0][1] + b[1][1]) / 2, -b[0][2]])
    return m


if __name__ == "__main__":
    for name, rnd in (("notch_jig_straight", False), ("notch_jig_round", True)):
        m = to_print(build(rnd), rnd)
        r = save(m, OUT / f"{name}.stl")
        nb = len(r.split(only_watertight=False))
        # weakest link: smallest cross-section between the middle part and an end (planes across the jig at the slots)
        secs = []
        for xp in np.linspace(9.05, 9.95, 4):
            for sgn in (1, -1):
                sec = r.section(plane_origin=[sgn * xp, 0, 0], plane_normal=[1, 0, 0])
                secs.append(0.0 if sec is None else sum(p.area for p in sec.to_2D()[0].polygons_full))
        print(name, "watertight", r.is_watertight, "bodies", nb, "size", np.round(r.extents, 2).tolist(), "vol", round(r.volume, 1),
              "min section at the saw slots mm2", round(min(secs), 1))
