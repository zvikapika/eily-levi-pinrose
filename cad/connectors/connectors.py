"""Printable connectors (junction sleeves) for the 17x17 snap-lid cable trunking that carries the power to the units.

Design (Eily): the connectors sit OUTSIDE over the trunking ends - so they also hide cuts that came out less than
perfect - they look delicate (thin walls, short sockets), and a sleeve has NO wall facing the wall/floor: it is a
U that sits flat on the surface with the trunking inside it, and its open back lets the cable pass the corner freely.
A 3D (through-the-space) arm has no surface, so it gets a closed square sleeve.

Every connector = union of arm sleeves (each from the junction centre out along its direction) minus the union of the
arm cavities, so the inside is one continuous hollow for the cable.

Usage:
  cad/.venv/bin/python cad/connectors/connectors.py                 # the starter set -> cad/out_connectors/
  cad/.venv/bin/python cad/connectors/connectors.py junctions.json  # one exact connector per junction exported from the sim
"""
import json
import sys
from pathlib import Path
import numpy as np
import trimesh

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from pinrose_v2 import U, D, save  # noqa: E402

# ------------------------------------------------------------------ parameters (mm) - CONFIRM with the real trunking
PROFILE_W = 17.0        # trunking width (along the wall surface)
PROFILE_H = 17.0        # trunking height (off the wall, lid on top)
CLR = 0.25              # play around the trunking (per side)
T = 1.2                 # sleeve wall - thin = delicate
SOCKET = 12.0           # how far each sleeve goes over the trunking, beyond the hub
OUT = Path(__file__).resolve().parent.parent / "out_connectors"


def _box(x0, x1, y0, y1, z0, z1):
    b = trimesh.creation.box(extents=[x1 - x0, y1 - y0, z1 - z0])
    b.apply_translation([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2])
    return b


def _frame(d, back):
    """arm frame: X = arm direction, Z = away from the surface (or 'up' for a free arm), Y = Z x X."""
    X = np.asarray(d, float); X /= np.linalg.norm(X)
    if back is None:
        up = np.array([0, 0, 1.0]) if abs(X[2]) < 0.95 else np.array([1.0, 0, 0])
        Z = up - X * up.dot(X)
    else:
        Z = -np.asarray(back, float)
        Z = Z - X * Z.dot(X)
    Z /= np.linalg.norm(Z)
    Y = np.cross(Z, X)
    M = np.eye(4); M[:3, 0], M[:3, 1], M[:3, 2] = X, Y, Z
    return M


def hub(d, back):
    """root of an arm (the part over the junction centre) - the convex hull of all roots closes any corner."""
    w2, h2 = PROFILE_W / 2 + CLR, PROFILE_H / 2 + CLR
    x0 = -(w2 + T)
    zs = -(h2 + T) if back is None else -PROFILE_H / 2
    b = _box(x0, w2 + T, -(w2 + T), w2 + T, zs, h2 + T)
    b.apply_transform(_frame(d, back))
    return b


def arm(d, back, end_cap=False):
    """outer sleeve + cavity of one arm, in junction coordinates (origin = trunking centre line at the junction)."""
    w2, h2 = PROFILE_W / 2 + CLR, PROFILE_H / 2 + CLR
    L = w2 + T + SOCKET
    x0 = -(w2 + T)                      # reach back over the centre so corners close
    if back is None:                    # free (3D) arm: closed sleeve
        outer = _box(x0, L, -(w2 + T), w2 + T, -(h2 + T), h2 + T)
        cav = _box(-w2, L + 1, -w2, w2, -h2, h2)
    else:                               # on a surface: U open toward the surface (z = -PROFILE_H/2 is the surface)
        zs = -PROFILE_H / 2
        outer = _box(x0, L, -(w2 + T), w2 + T, zs, h2 + T)
        cav = _box(-w2, L + 1, -w2, w2, zs - 1, h2)   # starts at -w2: a single arm is closed at its end (end cap)
    M = _frame(d, back)
    outer.apply_transform(M); cav.apply_transform(M)
    return outer, cav


def connector(arms, end_cap=False):
    """arms: list of (direction, back) with back = unit vector toward the surface the arm lies on, or None."""
    parts = [arm(d, b, end_cap and len(arms) == 1) for d, b in arms]
    solids = [p[0] for p in parts]
    if len(arms) > 1:
        # convex hub over the junction: keeps odd angles (e.g. a 45 deg wall meeting the ceiling) in one piece.
        # every root lies on the room side of its own surface, so the hull never pokes into a wall or the floor
        solids.append(trimesh.convex.convex_hull(np.vstack([hub(d, b).vertices for d, b in arms])))
    m = D(U(*solids), *[p[1] for p in parts])
    return m


def to_print(m, back=None):
    """lay the connector with its open back on the bed when there is one; otherwise on its lowest side."""
    m = m.copy()
    if back is not None:
        z = -np.asarray(back, float); z /= np.linalg.norm(z)
        R = trimesh.geometry.align_vectors(z, [0, 0, 1])
        m.apply_transform(R)
    m.apply_translation(-m.bounds[0])
    return m


def rot(deg):
    a = np.radians(deg)
    return [np.cos(a), np.sin(a), 0.0]


WALL = [0, 0, -1.0]   # starter set: lying on a surface whose normal is +z (back = -z)

STARTER = {
    "straight_coupler": [(rot(0), WALL), (rot(180), WALL)],
    "elbow_90": [(rot(0), WALL), (rot(90), WALL)],
    "elbow_45": [(rot(0), WALL), (rot(135), WALL)],        # a 45 deg turn
    "elbow_135": [(rot(0), WALL), (rot(45), WALL)],        # a 135 deg turn (sharp)
    "tee": [(rot(0), WALL), (rot(180), WALL), (rot(90), WALL)],
    "cross": [(rot(0), WALL), (rot(90), WALL), (rot(180), WALL), (rot(270), WALL)],
    "y_120": [(rot(90), WALL), (rot(210), WALL), (rot(330), WALL)],
    "end_cap": [(rot(0), WALL)],
    # wall <-> floor inside corner: one arm runs up the wall (back = the wall, -y), one along the floor (back = down)
    "corner_wall_floor": [([0, 0, 1.0], [0, -1.0, 0]), ([0, 1.0, 0], [0, 0, -1.0])],
    # wall <-> ceiling inside corner
    "corner_wall_ceiling": [([0, 0, -1.0], [0, -1.0, 0]), ([0, 1.0, 0], [0, 0, 1.0])],
    # inside corner between two walls (both arms horizontal)
    "corner_wall_wall": [([1.0, 0, 0], [0, -1.0, 0]), ([0, 1.0, 0], [-1.0, 0, 0])],
}


def build_starter():
    OUT.mkdir(exist_ok=True)
    rows = []
    for name, arms in STARTER.items():
        m = connector(arms, end_cap=(name == "end_cap"))
        same_back = all(np.allclose(b, arms[0][1]) for _, b in arms if b is not None)
        p = to_print(m, arms[0][1] if same_back else None)
        r = save(p, OUT / f"conn_{name}.stl")
        rows.append((name, r.is_watertight, len(r.split(only_watertight=False)), np.round(r.extents, 1).tolist()))
    return rows


def build_from_json(path):
    d = json.loads(Path(path).read_text())
    OUT.mkdir(exist_ok=True)
    rows = []
    for j in d["junctions"]:
        arms = [(a["dir"], a["back"]) for a in j["arms"]]
        m = connector(arms)
        backs = [b for _, b in arms if b is not None]
        same = backs and all(np.allclose(b, backs[0], atol=1e-3) for b in backs) and len(backs) == len(arms)
        p = to_print(m, backs[0] if same else None)
        r = save(p, OUT / f"junction_{j['id']}.stl")
        rows.append((j["id"], r.is_watertight, len(r.split(only_watertight=False)), np.round(r.extents, 1).tolist()))
    return rows


if __name__ == "__main__":
    rows = build_from_json(sys.argv[1]) if len(sys.argv) > 1 else build_starter()
    for r in rows:
        print(*r)
