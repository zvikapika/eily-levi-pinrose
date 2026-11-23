"""Pinrose unit v4 = v3 + Eily round 2 (2026-11-23):
- every shell wall a uniform 1.6 mm, grown OUTWARD from the v3 inner wall (the inner size is the one that matters;
  bracket, snaps and every inner feature therefore stay exactly as v3).
- anti-rotation: a 2nd motor strap (same part) + M3 boss pair + saddle at y = 81 (no room for bosses at F, y 100:
  interior half-width there is ~17 mm vs 20 needed).

--- v3 notes ---
Pinrose unit v3 - Eily's changes on the printed v2 sample (2026-11-22).

A  shell (walls + front face + the bracket that closes the back) +3 % in plan (length/width), height stays 50,
   local wall thickness and the 3 mm front face / 3 mm bracket plate are kept exactly. Scale origin = cup centre,
   so the cup, motor, saddles, bosses, journals and crank stay where they are.
B  cup: same diameter, total height 20 mm from the front face (slits included).
C  bulkhead removed.
D  rear stop rib + both strain-relief fins removed.
E  strap saddle + M3 boss pair kept.   F  second saddle kept.
Ring (pinruso, unchanged) sits at the front face, in the opening.
Everything else (strap, snaps, journals, wall screws, wire gate, filled bracket holes) as v2.

Run: cad/.venv/bin/python cad/pinrose_v3.py ; then checks_v3.py / render_v3.py / step_v3.py
"""
import json
import numpy as np
import trimesh
from shapely.geometry import Polygon
import pinrose_v2 as V
from pinrose_v2 import (b2t, U, D, I, ybox, zcyl, prism, loops, load_refs, inner_rim, bracket_to_cover,
                        snap_geometry, strap_part, placeholders, derived, save, xz_prism)

# ============================== v3 PARAMETERS ==============================
SCALE_XY = 1.03                       # A: plan growth of the shell
SCALE_ORIGIN = V.CUP_ID_C             # cup centre stays put
CUP_H = 20.0                          # B: cup total height from the front face
RING_AT_FRONT = True                  # ring sits in the front opening, z 0..3
REMOVE = ("bulkhead", "rear_stop", "fin0", "fin1")   # C + D
WALL_T = 1.6                          # v4: uniform wall, grown outward from the v3 inner wall
STRAP2_Y = 81.0                       # v4: 2nd strap centre (cover-frame y)
# ===========================================================================
from pinrose_v2 import (AXIS_X, FLOOR_T, RIM_Z, CUP_OD_C, CUP_OD_R, CUP_ID_C, BRACKET_T, WALL_SCREW_Y, WALL_SCREW_D,
                        WALL_SCREW_CSK_D, LEAD_W, LEAD_T, GATE_CLR, GATE_Y, GATE_CHAMFER, REF)
OUT = V.HERE / "out_v4"
OUT.mkdir(exist_ok=True)
V.CUP_TOP_Z = CUP_H


def grow(outer, inner, k=SCALE_XY, o=SCALE_ORIGIN):
    """outer scaled by k about o; every inner vertex moves with its closest outer point -> local thickness kept."""
    o = np.asarray(o)
    so = Polygon((np.asarray(outer.exterior.coords) - o) * k + o)
    from shapely.ops import nearest_points
    pts = []
    ib = Polygon(inner.exterior).segmentize(0.5).exterior
    for q in np.asarray(ib.coords)[:-1]:
        p = np.asarray(nearest_points(outer.exterior, __import__("shapely").geometry.Point(q))[0].coords[0])
        pts.append(q + (k - 1) * (p - o))
    si = Polygon(pts).buffer(0)
    return so, si


def shell_outlines(cov):
    ls = sorted(loops(cov, 25.0), key=lambda p: -p.area)
    return Polygon(ls[0].exterior), Polygon(ls[1].exterior)


def wall_thickness(outer, inner, n=600):
    b = outer.exterior
    return np.array([inner.exterior.distance(b.interpolate(s)) for s in np.linspace(0, b.length, n, endpoint=False)])


def build():
    cov, br, ring = load_refs()
    out0, in0 = shell_outlines(cov)
    _o3, in1 = grow(out0, in0)
    out1 = in1.buffer(WALL_T, 64)
    log = dict(scale_xy=SCALE_XY, scale_origin=list(SCALE_ORIGIN))
    t0, t1 = wall_thickness(out0, in0), wall_thickness(out1, in1, 1200)
    log["wall_thickness_v2_min_max"] = [round(t0.min(), 3), round(t0.max(), 3)]
    log["wall_thickness_v4_min_max"] = [round(t1.min(), 3), round(t1.max(), 3)]
    log["outer_v2_extents"] = np.round(np.subtract(out0.bounds[2:], out0.bounds[:2]), 2).tolist()
    log["outer_v4_extents"] = np.round(np.subtract(out1.bounds[2:], out1.bounds[:2]), 2).tolist()
    # ---------------- cover shell: walls + front face, then the v1 cup (with its slits) cut at CUP_H
    cx, cy = CUP_OD_C; rr = CUP_OD_R + 0.65
    shell = D(prism(out1, 0, RIM_Z), prism(in1, FLOOR_T, RIM_Z + 1), b2t(zcyl(cx, cy, 2 * rr, -1, FLOOR_T + 1)))
    cup = I(cov, b2t(zcyl(cx, cy, 2 * rr, -1, CUP_H)))
    base = U(shell, cup)
    # ---------------- features (v2 minus C + D), clipped to the new inner rim
    rim = in1
    feats = [(n, m) for n, m in V.cover_features(rim) if n not in REMOVE]
    s0, sd0 = V.STRAP_Y, V.SADDLE_Y
    V.STRAP_Y = STRAP2_Y - V.Y_FACE; V.SADDLE_Y = (STRAP2_Y - V.Y_FACE,)
    feats += [(n + "_2", m) for n, m in V.cover_features(rim) if n.startswith(("boss", "saddle0"))]
    strap2 = b2t(strap_part())
    V.STRAP_Y, V.SADDLE_Y = s0, sd0
    catches, tabs, snap_y = snap_geometry(rim)
    cover = U(base, *[m for _, m in feats], *[I(c, prism(rim.buffer(0.5), 0, RIM_Z)) for c in catches])
    log["cover_features"] = [n for n, _ in feats] + ["catch-1", "catch+1"]
    log["snap_y"] = snap_y
    # ---------------- bracket: plate = new inner rim (holes filled as in v2) + v1 side ribs + snap tabs, cuts
    M = bracket_to_cover(cov, br); Minv = np.linalg.inv(M)

    def tf(m):
        m = m.copy(); m.apply_transform(Minv); return m
    plate_v1 = Polygon(max(loops(br, V.BRACKET_T / 2), key=lambda p: p.area).exterior)
    ribs = D(br, prism(plate_v1.buffer(5), -1, V.BRACKET_T - 0.5))   # ribs + 0.5 of the old plate (overlap, fuses)
    ribs = D(ribs, tf(b2t(ybox(AXIS_X - 9, AXIS_X + 9, 55, 110, 0, RIM_Z - V.BRACKET_T))))   # v1 centre tabs out
    plate = tf(prism(in1, RIM_Z - V.BRACKET_T, RIM_Z))
    plate.vertices[:, 2] = np.where(np.abs(plate.vertices[:, 2]) < 1e-3, 0.0, plate.vertices[:, 2])
    plate.vertices[:, 2] = np.where(np.abs(plate.vertices[:, 2] - V.BRACKET_T) < 1e-3, V.BRACKET_T, plate.vertices[:, 2])
    brf = U(plate, ribs, *[tf(t) for t in tabs])
    cuts = []
    for wy in WALL_SCREW_Y:
        cuts.append(b2t(zcyl(AXIS_X, wy, WALL_SCREW_D, RIM_Z - V.BRACKET_T - 1, RIM_Z + 1)))
        cone = trimesh.creation.cone(radius=WALL_SCREW_CSK_D / 2 + 1.0, height=WALL_SCREW_CSK_D / 2 + 1.0, sections=64)
        cone.apply_transform(trimesh.transformations.rotation_matrix(np.pi, [1, 0, 0]))
        cone.apply_translation([AXIS_X, wy, RIM_Z - V.BRACKET_T - 1.0])
        cuts.append(cone)
    gw, gt = LEAD_W + 2 * GATE_CLR, LEAD_T + 2 * GATE_CLR
    from shapely.geometry import LineString
    slot = LineString([(AXIS_X - (gw - gt) / 2, GATE_Y), (AXIS_X + (gw - gt) / 2, GATE_Y)]).buffer(gt / 2, 32)
    cuts.append(prism(slot, RIM_Z - V.BRACKET_T - 1, RIM_Z + 1))
    for zf, sgn in ((RIM_Z - V.BRACKET_T, 1), (RIM_Z, -1)):
        big = np.asarray(slot.buffer(GATE_CHAMFER, 32).exterior.coords); sm = np.asarray(slot.exterior.coords)
        cuts.append(trimesh.convex.convex_hull(np.vstack([np.c_[big, np.full(len(big), zf - sgn * 0.3)],
                                                          np.c_[sm, np.full(len(sm), zf + sgn * GATE_CHAMFER)]])))
    brf = D(brf, *[tf(c) for c in cuts])
    brc = brf.copy(); brc.apply_transform(M)
    # ---------------- strap (unchanged), ring at the front
    strap = b2t(strap_part())
    rc = ring.bounds.mean(0)
    ringc = ring.copy()
    zt = (V.FLOOR_T if RING_AT_FRONT else CUP_H)
    ringc.apply_translation([CUP_ID_C[0] - rc[0], CUP_ID_C[1] - rc[1], zt - ring.bounds[1][2]])
    ph = placeholders()
    parts = dict(cover=cover, bracket=brc, strap=strap, strap2=strap2, ring=ringc)
    log.update(dict(derived=derived(), bracket_to_cover=M.round(6).tolist()))
    return parts, ph, M, brf, log, (out0, in0, out1, in1)


def export(parts, ph, brf, log):
    asm = OUT / "asm"; asm.mkdir(exist_ok=True)
    for n, m in {**parts, **ph}.items():
        save(m, asm / f"{n}.stl")
    save(parts["cover"], OUT / "pinrus_v4.stl")
    save(brf, OUT / "pinruswall_v4.stl")
    import shutil
    shutil.copyfile(REF / "pinruso.stl", OUT / "pinruso.stl")
    s = parts["strap"].copy()
    s.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))
    s.apply_translation(-s.bounds[0])
    save(s, OUT / "motor_strap_v4.stl")
    (OUT / "build_log.json").write_text(json.dumps(log, indent=1, default=float))


if __name__ == "__main__":
    import time
    t = time.time()
    parts, ph, M, brf, log, _ = build()
    export(parts, ph, brf, log)
    for n, m in parts.items():
        print(f"{n:8s} wt={m.is_watertight} bodies={len(m.split(only_watertight=False))} vol={m.volume:.0f} bounds={np.round(m.bounds, 2).tolist()}")
    print(json.dumps({k: v for k, v in log.items() if k != 'bracket_to_cover'}, indent=1, default=float))
    print(f"done {time.time() - t:.1f}s")
