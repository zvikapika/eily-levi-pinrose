# Pinrose unit v2 — CAD (build123d + trimesh/manifold)

Parametric source: `pinrose_v2.py`. All dimensions sit in one PARAMETERS block at the top. Pipeline: `bash scripts/run_all.sh`
(build → `checks_v2.py` → `render_v2.py` → `step_v2.py` → zips, ~1 min). Venv: `bash scripts/setup_venv.sh` creates `cad/.venv`
(gitignored). It reuses the shared CAD stack through a `.pth` file, because a fresh `uv pip install build123d` times out on this host.
Reference probes are in `scripts/`: `probe_refs.py`, `probe2.py` and `fit_bracket.py`, which fits the bracket into the cover.

## How the parts mate (from the STLs + media/)
- **Cover `pinrus`** is the main part. Its 3 mm floor (z 0..3) is the visible FRONT face, with the Ø41 opening for the funnel. The open back
  (z = 50) faces the wall. Cup: ID Ø41.01 at (-43.27, 15.49), OD Ø44.5, back rim z 40.2. It has 2 crank slits (2.68 wide) on the long axis,
  which are the crank journals.
- **Bracket `pinruswall`** = the back face. Its 3 mm plate outline is the cover's inner rim outline (0.000-0.003 mm, rotated 3° in the
  file). It plugs into the open back flush with the rim (wall face z_b = 0 → cover z = 50). Mapping: flip 180° about X, rotate -3°, then
  centroid-align (matrix in `out/build_log.json`).
- **Ring `pinruso`**: OD 40.3 / ID 35.56 / 3 thick. Modelled in the cup bore, flush with the back rim (z 37.2-40.2).

## Decisions
1. **Motor housing in the cover** (narrow half, axis on the teardrop's long axis x = -43, shaft toward the cup):
   - **Bulkhead** (3 mm, wall to wall) at y 54-57. The gearbox face shoulders on it, which locates the motor axially. Its U-slot
     (Ø10.4, open to the back) takes the flange boss, so the motor drops in from the open back.
   - **2 saddles** (y 65 and 100) carry the motor line-to-line on its lower half, leaving 1.0 mm to the front face.
   - **Rear stop rib** 0.5 mm behind the motor end. It stays low (to z 10) so it is clear of the end-cap terminals.
   - **Strap**: a separate print over the gearbox. 2× M3 go into heat-set inserts in 2 floor bosses. The ears stand 0.5 mm proud of the
     bosses, so tightening clamps the motor against rotation.
   - **Service**: pull the cover off the bracket, undo 2 screws, lift the motor out.
2. **Crank journals raised**: the slit bottoms go from z 11.2 to 14.1 (= axis 15.0 − wire r 0.8 − 0.1), so the crank runs COAXIAL with the
   shaft. In v1 the shaft (motor on the floor, axis ≈ 14) sat ~2 mm above the slit bottoms, so the wire needed a jog.
3. **Closing: the bracket is the back face.** It already plugs into the rim with 0 clearance, so a separate lid would add a seam and a
   part for nothing. v2 bracket changes:
   - The 54×43 opening behind the cup is filled (`FILL_BIG_HOLE`), so the crank path is closed. The small 14×17 hole near the tip is
     filled too; the wire gate replaces it.
   - The 2 v1 centre hold-down tabs are removed. They would hit the strap and the motor; the strap does their job now.
   - 2 countersunk wall-screw holes are added (Ø4.5, csk Ø8.5, heads flush on the inner face) at y 15.5 and 95.
   - 2 detent snap tabs are added (see 5).
4. **Wire exit gate**:
   - **Cover**: 2 strain-relief fins near the tip (y 119.5 / 125.5, 8 high). Each has a 1.4 wide × 4 deep notch, offset ±2.5 from the
     axis, so the lead (2 × 1.5, i.e. 3.0 × 1.5, on edge) sits in an S-bend with 0.1 grip. A tug on the lead never reaches the motor tabs.
   - **Bracket**: rounded gate slot 3.4 × 1.9 at y 132, chamfered 0.6 on both faces (grommet-like). The lead goes straight back into the
     wall, hidden. Width parameters: `LEAD_W`, `LEAD_T`, `GATE_CLR`.
5. **Cover ↔ bracket attachment**: the existing friction plug and the v1 side ribs, plus 2 detent snaps at the widest point (y 19):
   - Bracket tab: 8 wide × 1.6 × 13, with a 45/45° bump (0.8 engagement).
   - Cover: a catch block 1.0 proud on the wall, ramped both ways, so the cover pulls off by hand for service.
   - Tab strain at full deflection ≈ 1.1 % (OK for PLA/PETG).

## Measured clearances (`out/checks.json`, all checks pass)
| item | value |
|---|---|
| motor ↔ v1 shell (walls + front face), min | 1.005 mm (motor end: interior 24.63 wide → 1.04/side) |
| motor ↔ bracket | 15.9 mm (motor top 21.0 below the bracket face) |
| coupler sweep Ø9 ↔ cover (cup OD / bulkhead) | 1.0 / 1.0 mm axial |
| shaft engagement in the coupler | 8.5 mm |
| crank throw sweep: corner radius in the cup plan | 14.49 → **5.75 mm radial to the cup ID** |
| crank wire ↔ cup wall near the journals | 1.14 mm |
| crank sweep z range | 8.2 … 21.8 (front opening is at z < 3, so it is clear of the front face) |
| journal play | 0.54 mm/side across the slit, 0.1 mm under the wire |
| ring ↔ cup bore (radial) | **0.355 mm/side** (Ø41.01 vs Ø40.3) |
| axial stack-up in the cup | front face 0-3 · crank sweep 8.2-21.8 · 15.4 free · ring 37.2-40.2 · 6.8 free · bracket 47-50 |
| strap top ↔ bracket | 5.5 mm |
| pairwise interference (cover, bracket, strap, ring, motor + flange + shaft, coupler sweep, crank sweep) | 0 (contacts < 0.05 mm sliver: saddles, strap, bulkhead face, bracket plug) |
| motor + coupler + crank lowered in from the back | no clash |
| every printable STL | watertight, 1 body, 0 non-manifold edges |

## Hardware per unit (x60)
- 2× M3 × 8 socket/pan head (strap), 2× M3 heat-set insert, M3 × 5.7 × OD 4.6 (hole Ø4.0 × 6.5). For self-tappers, set `INSERT_HOLE_D = 2.5`.
- 2× wall screws Ø4 countersunk + wall plugs (bracket).

## Print orientation
- `pinrus_v2.stl`: front face down (as v1). All new features grow up from the floor. The catch blocks have 45° undersides. No supports.
- `pinruswall_v2.stl`: wall face down. The snap tabs stand up; countersinks and the gate chamfer are on top. No supports.
- `motor_strap_v2.stl`: written lying on its side (arch profile on the bed). No supports.
- `pinruso.stl`: unchanged, flat.

## Assumptions to confirm (defaults in the PARAMETERS block)
1. Motor gearbox face: boss Ø10 × 2.5, shaft Ø4 × 10 beyond the boss (`FLANGE_D/L`, `SHAFT_D/L`). Any face screw holes?
2. Brass coupler Ø7 × 14, set screws ≤ 1 mm proud (`COUPLER_*`). 14 mm is the longest that fits with 1 mm gaps, because the motor
   can't move further toward the tip without dropping below 1 mm side clearance.
3. Crank wire Ø1.6, throw 6 mm over 24 mm (`WIRE_D`, `CRANK_THROW*`). Raising the journals moves the crank 2.9 mm further from the front
   face than in v1. Check that the funnel tail still reaches it.
4. Ring position (in the bore, flush with the cup rim) and what holds it axially (it has 0.35 mm radial play and 6.8 mm free to the bracket).
5. Attachment: snaps + friction plug OK, or does he want screws? Wall screws Ø4 countersunk? Should the big bracket hole stay filled?
6. Lead size 3.0 × 1.5 (2 × Ø1.5) and the route straight into the wall behind the gate.

## v3 — Eily's changes on the printed v2 sample (`pinrose_v3.py`, output `out_v3/`, `bash scripts/run_all_v3.sh`)
Letters refer to her marked screenshot of the cover seen from the open back.
- **A** shell +3 % in plan only: outer 80 × 161 → 82.4 × 165.83, height stays 50. Local wall thickness is kept exactly (each
  inner-wall point moves with its nearest outer point; v1 walls vary 0.62–2.10 mm and still do). Front face 3 mm and bracket
  plate 3 mm unchanged. Scale origin = cup centre, so the cup, motor, saddles, bosses, journals and crank don't move.
  The bracket (back face) plate = the new inner rim outline (both holes still filled); its snap tabs follow the new walls.
- **B** cup: same Ø, total height 20 mm from the front face including the slits (journals still at z 14.1).
- **C** bulkhead removed. The motor is now located axially only by the strap clamp + saddles.
- **D** rear stop rib + both strain-relief fins removed (the bracket's wire gate stays).
- **E** strap saddle + M3 bosses kept, **F** second saddle kept. Strap and ring unchanged.
- Ring `pinruso` is a separate part that sits at the front face, in the opening (z 0–3).
- `checks_v3.py`: all printables watertight / 1 body, no clashes, motor ≥ 1.0 mm to the walls, ALL_OK.
