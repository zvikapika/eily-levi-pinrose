"""Pinrose unit v2 - motor housing in the cover, closed back, wire exit gate (build123d + trimesh/manifold).

Frames
- COVER frame = world = the frame of 3d/pinrus.stl: front face (visible, funnel side) on z=0, open back at z=50
  (toward the wall), tip at +Y (y~146), round end at -Y, cup (crank + funnel) at (~-43, 15.5).
- The wall bracket (3d/pinruswall.stl) plugs into the open back: its wall face z_b=0 lies in the cover rim plane z=50.
  Its file frame is mapped with BRACKET_TO_COVER (flip 180 deg about X, rotate -3 deg, centroid-align; fitted by
  scripts/fit_bracket.py: the plate outline equals the cover's inner rim outline within 0.003 mm).
- Print STLs are written in their original file frames (cover, bracket, ring) so the slicer setup does not change;
  the new strap is written flat in its print orientation. The assembly STEP is in the cover frame.

Run:  cad/.venv/bin/python cad/pinrose_v2.py        (build + export STL to cad/out)
Then: cad/.venv/bin/python cad/checks_v2.py ; cad/.venv/bin/python cad/render_v2.py ; cad/.venv/bin/python cad/step_v2.py
"""
from pathlib import Path
import json
import numpy as np
import trimesh
from shapely.geometry import Polygon
from build123d import Box, Cylinder, Pos, Rot, Part, Polyline, make_face, extrude, Plane, Location

# ============================== PARAMETERS (mm) ==============================
# --- motor (Zvika, caliper): cylindrical DC motor + gearbox
MOTOR_D = 22.0          # body diameter
MOTOR_L = 55.0          # body length excluding the flange
# ASSUMED (confirm): output-end flange/boss and shaft
FLANGE_D = 10.0         # bearing boss diameter on the gearbox face
FLANGE_L = 2.5          # boss length
SHAFT_D = 4.0           # output shaft diameter
SHAFT_L = 10.0          # shaft length beyond the boss
# ASSUMED (confirm): brass coupler + bent wire crank
COUPLER_D = 7.0
COUPLER_L = 14.0
COUPLER_SCREW = 1.0     # set-screw protrusion beyond the coupler OD (sweep envelope)
WIRE_D = 1.6            # crank wire diameter
CRANK_THROW = 6.0       # offset of the throw from the shaft axis
CRANK_THROW_LEN = 24.0  # length of the offset segment along the axis, centred in the cup
CRANK_TAIL = 2.0        # wire beyond the far journal (bent-over end)

# --- cover datums (measured from 3d/pinrus.stl, do not change unless the cover changes)
FLOOR_T = 3.0           # front face thickness (z 0..3)
RIM_Z = 50.0            # open back plane
AXIS_X = -43.0          # long axis of the teardrop / centre of the cup slits
CUP_ID_C = (-43.265, 15.485); CUP_ID_R = 20.505   # fitted from the z=5 section
CUP_OD_C = (-43.0, 15.75);    CUP_OD_R = 22.25
CUP_TOP_Z = 40.2        # cup back rim
SLIT_W = 2.68           # measured slit width (both journals)
SLIT_BOTTOM_V1 = 11.2   # v1 slit bottom z

# --- motor housing (design choices)
CLR = 1.0               # min clearance around the motor/coupler (task requirement)
CRADLE_UNDER = 1.0      # gap motor <-> front face; the saddles carry the motor
MOTOR_AXIS_Z = FLOOR_T + CRADLE_UNDER + MOTOR_D / 2      # = 15.0
Y_FACE = 57.0           # gearbox face (shoulder on the bulkhead); motor body runs +Y from here
BH_T = 3.0              # bulkhead thickness (y), motor face rests on its +Y side
BH_SLOT_CLR = 0.2       # radial clearance flange boss <-> U-slot
SADDLE_T = 3.0          # transverse saddle ribs
SADDLE_HALF_W = 14.0    # half width of a saddle (clipped by the walls)
SADDLE_Y = (8.0, 43.0)  # saddle centres measured from Y_FACE
REAR_STOP_GAP = 0.5     # motor end <-> rear stop rib
REAR_STOP_T = 2.0
REAR_STOP_TOP = MOTOR_AXIS_Z - 5.0   # stays below the end-cap terminals
# strap (separate print) + 2 M3 screws into heat-set inserts in 2 floor bosses
STRAP_Y = 9.0           # strap centre from Y_FACE
STRAP_W = 10.0          # strap width along Y
STRAP_T = 2.5           # arch thickness
STRAP_EAR_T = 3.0
STRAP_CLAMP_GAP = 0.5   # ear underside above boss top before tightening (= clamp travel)
BOSS_X = 16.0           # boss centre offset from the axis
BOSS_D = 8.0
M3_CLEAR_D = 3.4
INSERT_HOLE_D = 4.0     # M3 x 5.7 heat-set insert (OD 4.6): hole 4.0; use 2.5 for self-tapping M3 instead
INSERT_HOLE_DEPTH = 6.5
# crank journals: slit bottoms raised so the crank runs coaxial with the motor shaft
JOURNAL_CLR = 0.1

# --- wire exit gate (2-wire motor lead ~2 x 1.5 flat, i.e. 3.0 x 1.5)
LEAD_W = 3.0
LEAD_T = 1.5
GATE_GRIP = 0.1         # interference of the strain-relief notches on the lead thickness
FIN_T = 2.0
FIN_H = 8.0             # above the front face
FIN_Y = (119.5, 125.5)  # strain-relief fins (cover), S-bend
FIN_NOTCH_X = 2.5       # notch offset from the axis, alternating sign
GATE_Y = 132.0          # bracket gate (cover-frame y) - lead goes out the back into the wall
GATE_CLR = 0.2          # gate slot = lead + 2*clr
GATE_CHAMFER = 0.6

# --- cover <-> bracket attachment: existing friction plug + 2 detent snaps
SNAP_Y = None           # None -> at the widest point of the round end
SNAP_TAB_W = 8.0
SNAP_TAB_T = 1.6
SNAP_TAB_L = 13.0       # from the bracket's inner face (z_c=47) toward the front
SNAP_ENGAGE = 0.8       # radial overlap bump <-> catch
SNAP_GAP = 0.2          # tab outer face <-> catch inner face
CATCH_PROUD = 1.0       # catch block standing proud of the cover wall
CATCH_H = 3.0
CATCH_Z0 = 37.5         # catch block bottom (cover frame)

# --- bracket v2
BRACKET_T = 3.0
FILL_BIG_HOLE = True    # close the 54 x 43 opening behind the cup (encloses the crank)
FILL_SMALL_HOLE = True  # replaced by the wire gate
REMOVE_CENTRE_TABS = True   # v1 motor hold-down tabs; they would hit the strap and the motor
WALL_SCREW_Y = (15.5, 95.0)  # cover-frame y of 2 wall screws on the axis
WALL_SCREW_D = 4.5      # for 4 mm wood / plug screws
WALL_SCREW_CSK_D = 8.5  # 90 deg countersink on the inner face (head flush toward the cover)

# --- ring (unchanged part): sits in the cup bore flush with the back rim
RING_Z_TOP = CUP_TOP_Z
# ============================================================================

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
REF = REPO / "3d"
OUT = HERE / "out"
OUT.mkdir(exist_ok=True)


def b2t(part, tol=0.01, ang=0.1):
    v, t = part.tessellate(tol, ang)
    m = trimesh.Trimesh(np.array([[p.X, p.Y, p.Z] for p in v]), np.array(t), process=True)
    m.merge_vertices(digits_vertex=5)
    m.fix_normals()
    return m


def U(*ms):
    return trimesh.boolean.union(list(ms), engine="manifold")


def D(a, *bs):
    return trimesh.boolean.difference([a, *bs], engine="manifold")


def I(a, b):
    return trimesh.boolean.intersection([a, b], engine="manifold")


def ybox(x0, x1, y0, y1, z0, z1):
    return Pos((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2) * Box(abs(x1 - x0), abs(y1 - y0), abs(z1 - z0))


def ycyl(x, z, d, y0, y1):
    return Pos(x, (y0 + y1) / 2, z) * Cylinder(d / 2, abs(y1 - y0), rotation=(90, 0, 0))


def zcyl(x, y, d, z0, z1):
    return Pos(x, y, (z0 + z1) / 2) * Cylinder(d / 2, z1 - z0)


def loops(m, z):
    s = m.section(plane_origin=[0, 0, z], plane_normal=[0, 0, 1])
    return [Polygon(np.asarray(e)[:, :2]) for e in s.discrete]


def prism(poly, z0, z1):
    m = trimesh.creation.extrude_polygon(poly, z1 - z0)
    m.apply_translation([0, 0, z0])
    return m


def load_refs():
    return (trimesh.load(REF / "pinrus.stl"), trimesh.load(REF / "pinruswall.stl"), trimesh.load(REF / "pinruso.stl"))


def inner_rim(cov):
    ls = sorted(loops(cov, 45.0), key=lambda p: -p.area)
    return Polygon(ls[1].exterior)


def bracket_to_cover(cov, br):
    """4x4 matrix bracket file frame -> cover frame (see scripts/fit_bracket.py, theta = -3 deg)."""
    rim = inner_rim(cov)
    plate = Polygon(max(loops(br, 1.5), key=lambda p: p.area).exterior)
    from shapely import affinity
    pf = affinity.scale(plate, 1, -1, origin=(0, 0))
    c0 = np.array(pf.centroid.coords[0]); tgt = np.array(rim.centroid.coords[0])
    F = np.diag([1.0, -1.0, -1.0, 1.0])
    T0 = np.eye(4); T0[:2, 3] = -c0
    t = np.radians(-3.0)
    Rz = np.eye(4); Rz[:2, :2] = [[np.cos(t), -np.sin(t)], [np.sin(t), np.cos(t)]]
    T1 = np.eye(4); T1[:3, 3] = [tgt[0], tgt[1], RIM_Z]
    return T1 @ Rz @ T0 @ F


def half_width(rim, y, z=None):
    """interior x-extent at y (walls are vertical)."""
    from shapely.geometry import LineString
    seg = rim.intersection(LineString([(-200, y), (100, y)]))
    return seg.bounds[0], seg.bounds[2]


# ---------------------------------------------------------------- geometry

def derived():
    zA = MOTOR_AXIS_Z
    y_bh0 = Y_FACE - BH_T
    cpl1 = y_bh0 - CLR            # coupler end toward the motor
    cpl0 = cpl1 - COUPLER_L
    y_rear = Y_FACE + MOTOR_L
    near_j = CUP_OD_C[1] + CUP_OD_R   # outer face of the near journal (+Y side of the cup)
    far_j = CUP_OD_C[1] - CUP_OD_R
    return dict(zA=zA, y_bh0=y_bh0, cpl0=cpl0, cpl1=cpl1, y_rear=y_rear, near_j=near_j, far_j=far_j,
                journal_z=zA - WIRE_D / 2 - JOURNAL_CLR)


def cover_features(rim):
    d = derived(); zA = d["zA"]
    clip = prism(rim.buffer(0.5), FLOOR_T - 0.5, RIM_Z - 1.0)   # fuses 0.5 into the walls and floor
    feats = []
    # bulkhead with U-slot for the flange boss (motor drops in from the open back)
    bh = ybox(AXIS_X - 30, AXIS_X + 30, d["y_bh0"], Y_FACE, FLOOR_T - 0.5, zA + MOTOR_D / 2)
    slot_r = FLANGE_D / 2 + BH_SLOT_CLR
    bh = bh - ycyl(AXIS_X, zA, 2 * slot_r, d["y_bh0"] - 1, Y_FACE + 1) \
            - ybox(AXIS_X - slot_r, AXIS_X + slot_r, d["y_bh0"] - 1, Y_FACE + 1, zA, RIM_Z)
    feats.append(("bulkhead", bh))
    # saddles (line-to-line on the motor's lower half)
    for i, sy in enumerate(SADDLE_Y):
        yc = Y_FACE + sy
        s = ybox(AXIS_X - SADDLE_HALF_W, AXIS_X + SADDLE_HALF_W, yc - SADDLE_T / 2, yc + SADDLE_T / 2, FLOOR_T - 0.5, zA)
        s = s - ycyl(AXIS_X, zA, MOTOR_D, yc - SADDLE_T, yc + SADDLE_T)
        feats.append((f"saddle{i}", s))
    # rear stop rib
    yr = d["y_rear"] + REAR_STOP_GAP
    feats.append(("rear_stop", ybox(AXIS_X - 20, AXIS_X + 20, yr, yr + REAR_STOP_T, FLOOR_T - 0.5, REAR_STOP_TOP)))
    # strap bosses
    ys = Y_FACE + STRAP_Y
    for sx in (-1, 1):
        b = zcyl(AXIS_X + sx * BOSS_X, ys, BOSS_D, FLOOR_T - 0.5, zA)
        b = b - zcyl(AXIS_X + sx * BOSS_X, ys, INSERT_HOLE_D, zA - INSERT_HOLE_DEPTH, zA + 1)
        feats.append((f"boss{sx:+d}", b))
    # strain-relief fins (S-bend for the lead), lead stands on edge in the notches
    nw = LEAD_T - GATE_GRIP; nd = LEAD_W + 1.0
    for i, fy in enumerate(FIN_Y):
        f = ybox(AXIS_X - 15, AXIS_X + 15, fy - FIN_T / 2, fy + FIN_T / 2, FLOOR_T - 0.5, FLOOR_T + FIN_H)
        nx = AXIS_X + (FIN_NOTCH_X if i % 2 else -FIN_NOTCH_X)
        f = f - ybox(nx - nw / 2, nx + nw / 2, fy - 2, fy + 2, FLOOR_T + FIN_H - nd, FLOOR_T + FIN_H + 1)
        feats.append((f"fin{i}", f))
    meshes = [(n, I(b2t(p), clip)) for n, p in feats]
    # notches must stay open after the clip: re-cut handled by geometry (cut before clip)
    # raised crank journals (fill v1 slit bottoms up to the journal height); confined to the cup wall ring
    jz = d["journal_z"]
    ring = D(b2t(zcyl(CUP_OD_C[0], CUP_OD_C[1], 2 * CUP_OD_R - 0.1, SLIT_BOTTOM_V1 - 0.5, jz)),
             b2t(zcyl(CUP_ID_C[0], CUP_ID_C[1], 2 * CUP_ID_R + 0.1, SLIT_BOTTOM_V1 - 1, jz + 1)))
    for side in (1, -1):
        cy = CUP_ID_C[1] + side * 21.4
        blk = b2t(ybox(AXIS_X - SLIT_W / 2 - 0.5, AXIS_X + SLIT_W / 2 + 0.5, cy - 2.5, cy + 2.5, SLIT_BOTTOM_V1 - 0.5, jz))
        meshes.append((f"journal{side:+d}", I(blk, ring)))
    return meshes


def snap_geometry(rim):
    """returns (cover catch meshes, bracket tab meshes) in the cover frame."""
    ys = SNAP_Y
    if ys is None:
        best = max(np.arange(0, 40, 0.25), key=lambda y: np.subtract(*half_width(rim, y)[::-1]))
        ys = float(best)
    xl, xr = half_width(rim, ys)
    catches, tabs = [], []
    z_in = RIM_Z - BRACKET_T
    for side, xw in ((-1, xl), (1, xr)):
        # local u = inward distance from the wall (toward the axis)
        def X(u):
            return xw - side * u
        # catch block: trapezoid in (u, z): 45 deg ramps both ways
        cz0, cz1 = CATCH_Z0, CATCH_Z0 + CATCH_H
        pts = [(X(-0.5), cz0 - 0.5), (X(0.0), cz0 - 0.5), (X(CATCH_PROUD), cz0 + CATCH_PROUD - 0.5),
               (X(CATCH_PROUD), cz1 - CATCH_PROUD + 0.5), (X(0.0), cz1 + 0.5), (X(-0.5), cz1 + 0.5)]
        catches.append(xz_prism(pts, ys - (SNAP_TAB_W + 2) / 2, ys + (SNAP_TAB_W + 2) / 2))
        # tab: outer face at u = CATCH_PROUD + SNAP_GAP, thickness SNAP_TAB_T, from z_in down to z_in - SNAP_TAB_L
        u0 = CATCH_PROUD + SNAP_GAP; u1 = u0 + SNAP_TAB_T
        zt = z_in - SNAP_TAB_L
        tab = [(X(u0), z_in + 0.5), (X(u0), zt + 3.6), (X(u0 - SNAP_ENGAGE - SNAP_GAP), zt + 2.8),
               (X(u0 - SNAP_ENGAGE - SNAP_GAP), zt + 2.0), (X(u0), zt + 0.8), (X(u0), zt), (X(u1), zt), (X(u1), z_in + 0.5)]
        tabs.append(xz_prism(tab, ys - SNAP_TAB_W / 2, ys + SNAP_TAB_W / 2))
    return catches, tabs, ys


def xz_prism(pts, y0, y1):
    """polygon in (x, z) extruded along y0..y1 -> trimesh."""
    poly = Polygon(pts)
    if not poly.exterior.is_ccw:
        poly = Polygon(pts[::-1])
    m = trimesh.creation.extrude_polygon(poly, y1 - y0)   # polygon in XY, extruded +Z
    # map (X, Y, Z) -> (x=X, y=y0+Z, z=Y)
    M = np.array([[1, 0, 0, 0], [0, 0, 1, y0], [0, 1, 0, 0], [0, 0, 0, 1.0]])
    m.apply_transform(M)
    if m.volume < 0:
        m.invert()
    return m


def strap_part():
    """strap in the cover frame (assembly position)."""
    d = derived(); zA = d["zA"]; ys = Y_FACE + STRAP_Y
    r_in = MOTOR_D / 2; r_out = r_in + STRAP_T
    z_ear0 = zA + STRAP_CLAMP_GAP
    arch = ycyl(AXIS_X, zA, 2 * r_out, ys - STRAP_W / 2, ys + STRAP_W / 2) - ycyl(AXIS_X, zA, 2 * r_in, ys - STRAP_W, ys + STRAP_W)
    arch = arch & ybox(AXIS_X - r_out - 1, AXIS_X + r_out + 1, ys - STRAP_W, ys + STRAP_W, z_ear0, zA + r_out + 1)
    ears = ybox(AXIS_X - BOSS_X - BOSS_D / 2, AXIS_X + BOSS_X + BOSS_D / 2, ys - STRAP_W / 2, ys + STRAP_W / 2, z_ear0, z_ear0 + STRAP_EAR_T)
    ears = ears - ycyl(AXIS_X, zA, 2 * r_in, ys - STRAP_W, ys + STRAP_W)
    s = arch + ears
    for sx in (-1, 1):
        s = s - zcyl(AXIS_X + sx * BOSS_X, ys, M3_CLEAR_D, z_ear0 - 1, z_ear0 + STRAP_EAR_T + 1)
    return s


def placeholders():
    """motor, coupler sweep, crank sweep (cover frame) as trimesh."""
    d = derived(); zA = d["zA"]
    motor = b2t(ycyl(AXIS_X, zA, MOTOR_D, Y_FACE, d["y_rear"]))
    flange = b2t(ycyl(AXIS_X, zA, FLANGE_D, Y_FACE - FLANGE_L, Y_FACE + 0.5))
    shaft = b2t(ycyl(AXIS_X, zA, SHAFT_D, Y_FACE - FLANGE_L - SHAFT_L, Y_FACE - FLANGE_L + 0.5))
    coupler = b2t(ycyl(AXIS_X, zA, COUPLER_D, d["cpl0"], d["cpl1"]))
    coupler_sweep = b2t(ycyl(AXIS_X, zA, COUPLER_D + 2 * COUPLER_SCREW, d["cpl0"], d["cpl1"]))
    # crank: straight from inside the coupler to the throw, throw, back, far journal, tail; swept = revolve
    yc = CUP_ID_C[1]
    ya, yb = yc + CRANK_THROW_LEN / 2, yc - CRANK_THROW_LEN / 2
    r = WIRE_D / 2; e = CRANK_THROW + r
    y_start = d["cpl0"] + COUPLER_L / 2
    y_end = d["far_j"] - CRANK_TAIL
    sweep = U(b2t(ycyl(AXIS_X, zA, WIRE_D, y_end, y_start)),
              b2t(ycyl(AXIS_X, zA, 2 * e, yb - r, ya + r)))
    # crank wire itself at angle 0 (throw toward -z = toward the front/funnel) for the assembly view
    zt = zA - CRANK_THROW
    segs = [ycyl(AXIS_X, zA, WIRE_D, ya, y_start), ycyl(AXIS_X, zt, WIRE_D, yb - r, ya + r),
            ycyl(AXIS_X, zA, WIRE_D, y_end, yb),
            zcyl(AXIS_X, ya, WIRE_D, zt, zA + r), zcyl(AXIS_X, yb, WIRE_D, zt, zA + r)]
    wire = U(*[b2t(s) for s in segs])
    return dict(motor=motor, flange=flange, shaft=shaft, coupler=coupler, coupler_sweep=coupler_sweep,
                crank_sweep=sweep, crank=wire)


def build():
    cov, br, ring = load_refs()
    rim = inner_rim(cov)
    M = bracket_to_cover(cov, br)
    Minv = np.linalg.inv(M)
    log = {}
    # ---------------- cover v2
    feats = cover_features(rim)
    catches, tabs, snap_y = snap_geometry(rim)
    cover = U(cov, *[m for _, m in feats], *[I(c, prism(rim.buffer(0.5), 0, RIM_Z)) for c in catches])
    log["cover_features"] = [n for n, _ in feats] + ["catch-1", "catch+1"]
    # ---------------- bracket v2: booleans done in the bracket's FILE frame (its plate faces z=0/3 are exact there;
    # doing them in the rotated cover frame left float32 slivers in the exported STL). Cover-frame tools -> Minv.
    def tf(m):
        m = m.copy(); m.apply_transform(Minv); return m
    brf = br.copy()
    if REMOVE_CENTRE_TABS:
        # v1 centre tabs: everything of the bracket below its inner face (z_c < 47) within |x-axis|<9, 55<y<110
        cut = b2t(ybox(AXIS_X - 9, AXIS_X + 9, 55, 110, 0, RIM_Z - BRACKET_T))
        brf = D(brf, tf(cut))
    if FILL_BIG_HOLE or FILL_SMALL_HOLE:
        secs = loops(brf, BRACKET_T / 2)
        outer = max(secs, key=lambda p: p.area)
        inner_loops = [p for p in secs if p is not outer and outer.contains(p.representative_point())]
        patch = []
        for p in inner_loops:
            big = p.area > 1000
            if (big and FILL_BIG_HOLE) or ((not big) and FILL_SMALL_HOLE):
                patch.append(prism(p.buffer(0.3), 0.0, BRACKET_T))
                cc = M @ np.r_[p.centroid.x, p.centroid.y, 1.5, 1.0]
                log.setdefault("filled_holes", []).append(dict(area=round(p.area, 1), centroid_cover_frame=np.round(cc[:2], 2).tolist()))
        if patch:
            brf = U(brf, *patch)
    brf = U(brf, *[tf(t) for t in tabs])
    # wall screws (countersunk from the inner face z_c=47 so the heads sit flush toward the cover)
    cuts = []
    for wy in WALL_SCREW_Y:
        cuts.append(b2t(zcyl(AXIS_X, wy, WALL_SCREW_D, RIM_Z - BRACKET_T - 1, RIM_Z + 1)))
        h = (WALL_SCREW_CSK_D - WALL_SCREW_D) / 2
        cone = trimesh.creation.cone(radius=WALL_SCREW_CSK_D / 2 + 1.0, height=WALL_SCREW_CSK_D / 2 + 1.0, sections=64)
        cone.apply_transform(trimesh.transformations.rotation_matrix(np.pi, [1, 0, 0]))  # apex toward +z (wall)
        cone.apply_translation([AXIS_X, wy, RIM_Z - BRACKET_T - 1.0])  # base 1 mm in front of the inner face
        cuts.append(cone)
    # wire gate: rounded slot (lead + clearance), chamfered both faces like a grommet
    gw, gt = LEAD_W + 2 * GATE_CLR, LEAD_T + 2 * GATE_CLR
    from shapely.geometry import LineString
    slot = LineString([(AXIS_X - (gw - gt) / 2, GATE_Y), (AXIS_X + (gw - gt) / 2, GATE_Y)]).buffer(gt / 2, 32)
    cuts.append(prism(slot, RIM_Z - BRACKET_T - 1, RIM_Z + 1))
    for zf, sgn in ((RIM_Z - BRACKET_T, 1), (RIM_Z, -1)):
        # chamfer = frustum: slot grown by GATE_CHAMFER at the face, back to the slot 0.6 inside
        hull = trimesh.convex.convex_hull(np.vstack([
            np.c_[np.asarray(slot.buffer(GATE_CHAMFER, 32).exterior.coords), np.full(len(slot.buffer(GATE_CHAMFER, 32).exterior.coords), zf - sgn * 0.3)],
            np.c_[np.asarray(slot.exterior.coords), np.full(len(slot.exterior.coords), zf + sgn * GATE_CHAMFER)]]))
        cuts.append(hull)
    brf = D(brf, *[tf(c) for c in cuts])
    brc = brf.copy(); brc.apply_transform(M)
    parts_file = dict(bracket=brf)
    # ---------------- strap
    strap = b2t(strap_part())
    # ---------------- ring (unchanged) placed in the cup bore, flush with the back rim
    rc = ring.bounds.mean(0)
    ringc = ring.copy(); ringc.apply_translation([CUP_ID_C[0] - rc[0], CUP_ID_C[1] - rc[1], RING_Z_TOP - ring.bounds[1][2]])
    ph = placeholders()
    parts = dict(cover=cover, bracket=brc, strap=strap, ring=ringc)
    log.update(dict(snap_y=snap_y, derived=derived(), bracket_to_cover=M.round(6).tolist()))
    log["_bracket_file_frame"] = brf
    return parts, ph, M, log


def clean(m):
    """make the mesh float32-exact (what an STL stores) and re-manifold it, so a reload is identical."""
    m = trimesh.Trimesh(np.asarray(m.vertices, dtype=np.float32).astype(np.float64), m.faces, process=True)
    import manifold3d as mf
    mm = mf.Manifold(mf.Mesh(vert_properties=np.asarray(m.vertices, dtype=np.float32), tri_verts=np.asarray(m.faces, dtype=np.uint32)))
    out = mm.to_mesh()
    r = trimesh.Trimesh(np.asarray(out.vert_properties[:, :3], dtype=np.float64), np.asarray(out.tri_verts), process=True)
    bodies = r.split(only_watertight=False)
    if len(bodies) > 1:
        bodies = [b for b in bodies if abs(b.volume) > 1e-3]
        r = trimesh.util.concatenate(bodies)
    return r


def save(m, path):
    """write, reload (float32 STL), clean, write again until stable."""
    m = clean(m)
    m.export(path)
    r = clean(trimesh.load(path))
    r.export(path)
    return r


def export(parts, ph, M, log):
    Minv = np.linalg.inv(M)
    asm = OUT / "asm"; asm.mkdir(exist_ok=True)
    for n, m in {**parts, **ph}.items():
        save(m, asm / f"{n}.stl")
    save(parts["cover"], OUT / "pinrus_v2.stl")
    save(log.pop("_bracket_file_frame"), OUT / "pinruswall_v2.stl")
    import shutil
    shutil.copyfile(REF / "pinruso.stl", OUT / "pinruso.stl")
    # strap print orientation: profile (XZ) on the bed -> rotate -90 about X, drop to z=0
    s = parts["strap"].copy()
    s.apply_transform(trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0]))
    s.apply_translation(-s.bounds[0] + [0, 0, 0])
    save(s, OUT / "motor_strap_v2.stl")
    (OUT / "build_log.json").write_text(json.dumps(log, indent=1, default=float))


if __name__ == "__main__":
    import time
    t = time.time()
    parts, ph, M, log = build()
    export(parts, ph, M, log)
    for n, m in parts.items():
        print(f"{n:8s} wt={m.is_watertight} bodies={len(m.split(only_watertight=False))} vol={m.volume:.0f} bounds={np.round(m.bounds, 2).tolist()}")
    print(json.dumps({k: v for k, v in log.items() if k != 'bracket_to_cover'}, indent=1, default=float))
    print(f"done {time.time() - t:.1f}s")
