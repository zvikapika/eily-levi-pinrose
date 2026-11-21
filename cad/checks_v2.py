"""Checks for Pinrose v2: watertight, pairwise interference, clearances, insertion, openings. Writes out/checks.json."""
import json, sys
import numpy as np, trimesh
from pathlib import Path
from trimesh.proximity import ProximityQuery
sys.path.insert(0, str(Path(__file__).resolve().parent))
import pinrose_v2 as P

OUT = P.OUT; A = OUT / "asm"
L = {n: trimesh.load(A / f"{n}.stl") for n in
     ["cover", "bracket", "strap", "ring", "motor", "flange", "shaft", "coupler", "coupler_sweep", "crank_sweep", "crank"]}
cov1 = trimesh.load(P.REF / "pinrus.stl")
R = {}
ok = True


def ivol(a, b):
    try:
        r = trimesh.boolean.intersection([a, b], engine="manifold")
        if r.is_empty or len(r.faces) == 0:
            return 0.0, 0.0
        return float(r.volume), float(2 * r.volume / max(r.area, 1e-9))
    except Exception as e:
        return -1.0, -1.0


def mind(src, dst, n=20000):
    pts, _ = trimesh.sample.sample_surface_even(src, n, seed=1)
    d = ProximityQuery(dst).on_surface(pts)[1]
    i = int(np.argmin(d))
    return float(d[i]), pts[i].round(2).tolist()


# 1. printable STLs
R["stl"] = {}
for f in ["pinrus_v2.stl", "pinruswall_v2.stl", "motor_strap_v2.stl", "pinruso.stl"]:
    m = trimesh.load(OUT / f)
    nb = len(m.split(only_watertight=False))
    nm = int((np.bincount(m.edges_unique_inverse, minlength=len(m.edges_unique)) > 2).sum())
    R["stl"][f] = dict(watertight=bool(m.is_watertight), bodies=nb, non_manifold_edges=nm, volume=round(float(m.volume), 1),
                       size=np.round(m.extents, 2).tolist())
    ok &= m.is_watertight and nb == 1 and nm == 0

# 2. pairwise interference (printed parts + placeholders). Contact by design = sliver thickness < 0.05.
motor_all = trimesh.boolean.union([L["motor"], L["flange"], L["shaft"]], engine="manifold")
solids = dict(cover=L["cover"], bracket=L["bracket"], strap=L["strap"], ring=L["ring"], motor=motor_all,
              coupler_sweep=L["coupler_sweep"], crank_sweep=L["crank_sweep"])
allowed = {("motor", "coupler_sweep"), ("coupler_sweep", "crank_sweep"), ("motor", "crank_sweep")}  # shaft/wire inside the coupler
R["interference"] = {}
names = list(solids)
for i, a in enumerate(names):
    for b in names[i + 1:]:
        v, t = ivol(solids[a], solids[b])
        key = f"{a}x{b}"
        status = "allowed (part inside part by design)" if (a, b) in allowed else ("clear" if v <= 0.01 or (0 <= t < 0.05) else "CLASH")
        R["interference"][key] = dict(vol=round(v, 3), sliver=round(t, 3), status=status)
        if status == "CLASH":
            ok = False

# 3. clearances
C = {}
d, p = mind(L["motor"], cov1); C["motor_to_v1_shell(walls+front)"] = (round(d, 3), p)
d, p = mind(L["motor"], L["bracket"]); C["motor_to_bracket"] = (round(d, 3), p)
d, p = mind(L["coupler_sweep"], L["cover"]); C["coupler_sweep_to_cover_v2"] = (round(d, 3), p)
d, p = mind(L["coupler_sweep"], L["strap"]); C["coupler_sweep_to_strap"] = (round(d, 3), p)
# crank sweep vs cup wall WITHOUT the journals: use v1 cup with the slit region excluded
sw = L["crank_sweep"]
pts, _ = trimesh.sample.sample_surface_even(sw, 30000, seed=1)
dd = ProximityQuery(cov1).on_surface(pts)[1]
yj = np.abs(pts[:, 1] - P.CUP_ID_C[1])
far_from_journal = yj < (P.CUP_ID_R - 1.0)
C["crank_sweep_to_cup_wall(throw zone)"] = round(float(dd[far_from_journal].min()), 3)
dz = P.MOTOR_AXIS_Z
e = P.CRANK_THROW + P.WIRE_D / 2
yt = P.CRANK_THROW_LEN / 2 + P.WIRE_D / 2
C["throw_corner_radius_in_cup_plan"] = round(float(np.hypot(e, yt)), 3)
C["throw_radial_clearance_to_cup_ID(analytic)"] = round(float(P.CUP_ID_R - np.hypot(e, yt) - abs(P.AXIS_X - P.CUP_ID_C[0])), 3)
C["crank_sweep_z_range"] = [round(dz - e, 2), round(dz + e, 2)]
C["journal_bottom_z"] = round(P.derived()["journal_z"], 2)
C["journal_radial_play_each_side"] = round((P.SLIT_W - P.WIRE_D) / 2, 3)
C["coupler_axial_gap_to_cup_OD"] = round(P.derived()["cpl0"] - P.derived()["near_j"], 3)
C["coupler_axial_gap_to_bulkhead"] = round(P.derived()["y_bh0"] - P.derived()["cpl1"], 3)
C["shaft_engagement_in_coupler"] = round(P.derived()["cpl1"] - (P.Y_FACE - P.FLANGE_L - P.SHAFT_L), 3)
# motor rear: interior width at the motor's end
xl, xr = P.half_width(P.inner_rim(cov1), P.derived()["y_rear"])
C["interior_width_at_motor_end"] = round(xr - xl, 2)
C["motor_side_clearance_at_end"] = round(min(P.AXIS_X - P.MOTOR_D / 2 - xl, xr - P.AXIS_X - P.MOTOR_D / 2), 3)
C["motor_to_front_face"] = round(P.MOTOR_AXIS_Z - P.MOTOR_D / 2 - P.FLOOR_T, 3)
C["motor_top_to_bracket_inner_face"] = round(P.RIM_Z - P.BRACKET_T - (P.MOTOR_AXIS_Z + P.MOTOR_D / 2), 3)
C["strap_top_to_bracket"] = round(float(L["bracket"].bounds[0][2] - L["strap"].bounds[1][2]), 3)
d, p = mind(L["strap"], L["bracket"]); C["strap_to_bracket_min"] = (round(d, 3), p)
# ring
ring = L["ring"]
ring_od = float(ring.extents[0])
C["ring_OD_measured"] = round(ring_od, 3)
C["ring_radial_clearance_in_cup_bore"] = round(P.CUP_ID_R - ring_od / 2, 3)
C["ring_bottom_above_crank_sweep_top"] = round(float(ring.bounds[0][2] - (dz + e)), 3)
C["ring_top_to_bracket_inner_face"] = round(float(P.RIM_Z - P.BRACKET_T - ring.bounds[1][2]), 3)
d, p = mind(ring, L["crank"]); C["ring_to_crank_wire"] = (round(d, 3), p)
R["clearance"] = C
ok &= C["motor_to_v1_shell(walls+front)"][0] >= 0.99 and C["coupler_sweep_to_cover_v2"][0] >= 0.99

# 4. insertion: motor + coupler + crank as one unit lowered from the open back (+z) into place
unit = trimesh.boolean.union([motor_all, L["coupler"], L["crank"]], engine="manifold")
worst = 0.0
for dzz in [0.5, 1, 2, 3, 5, 8, 12, 16, 20, 25, 30, 36]:
    u = unit.copy(); u.apply_translation([0, 0, dzz])
    v, t = ivol(u, L["cover"])
    if not (v <= 0.01 or 0 <= t < 0.05):
        worst = max(worst, v)
R["insertion_motor_unit_from_back"] = dict(max_clash_vol=round(worst, 3), status="clear" if worst == 0 else "CLASH")
ok &= worst == 0
# bracket pushed in (cover moved onto the wall-mounted bracket): bracket lifted +dz vs cover, excluding the snap ride-over
worst = {}
for dzz in [0.3, 1, 2, 4, 6, 10, 14]:
    b = L["bracket"].copy(); b.apply_translation([0, 0, dzz])
    v, t = ivol(b, L["cover"])
    worst[dzz] = round(v, 3)
R["bracket_insertion_overlap_by_dz(snap ride-over expected while dz < bump travel)"] = worst

# 5. openings by ray
def first_hits(mesh, o, dvec):
    loc, _, _ = mesh.ray.intersects_location([o], [dvec])
    return sorted(np.round(np.asarray(loc).reshape(-1, 3) @ np.asarray(dvec), 2).tolist())
Rr = {}
Rr["gate_slot_through_bracket"] = first_hits(L["bracket"], [P.AXIS_X, P.GATE_Y, 30], [0, 0, 1])
for wy in P.WALL_SCREW_Y:
    Rr[f"wall_screw_hole_y{wy}"] = first_hits(L["bracket"], [P.AXIS_X, wy, 30], [0, 0, 1])
for sx in (-1, 1):
    Rr[f"insert_hole_{sx:+d}_hits_from_top(z)"] = [-h for h in first_hits(L["cover"], [P.AXIS_X + sx * P.BOSS_X, P.Y_FACE + P.STRAP_Y, 49], [0, 0, -1])][:4]
Rr["front_opening_at_cup_centre(z hits cover)"] = first_hits(L["cover"], [P.CUP_ID_C[0], P.CUP_ID_C[1], -5], [0, 0, 1])
Rr["back_closed_behind_cup(z hits bracket, 8 mm off the screw hole)"] = first_hits(L["bracket"], [P.CUP_ID_C[0] + 8, P.CUP_ID_C[1], 20], [0, 0, 1])
Rr["back_closed_behind_cup_tip_side"] = first_hits(L["bracket"], [P.CUP_ID_C[0], P.CUP_ID_C[1] + 10, 20], [0, 0, 1])
Rr["back_closed_at_old_small_hole"] = first_hits(L["bracket"], [P.AXIS_X, 118.7, 20], [0, 0, 1])
for i, fy in enumerate(P.FIN_Y):
    nx = P.AXIS_X + (P.FIN_NOTCH_X if i % 2 else -P.FIN_NOTCH_X)
    Rr[f"fin{i}_notch_open_along_y"] = first_hits(L["cover"], [nx, fy - 3, P.FLOOR_T + P.FIN_H - 1.0], [0, 1, 0])[:2]
# journal height: from the top inside the slit
for side in (1, -1):
    Rr[f"journal{side:+d}_bottom_z"] = [-h for h in first_hits(L["cover"], [P.AXIS_X, P.CUP_ID_C[1] + side * 21.4, 45], [0, 0, -1])][:1]
R["rays"] = Rr
R["ALL_OK"] = bool(ok)
(OUT / "checks.json").write_text(json.dumps(R, indent=1))
print(json.dumps(R, indent=1))
