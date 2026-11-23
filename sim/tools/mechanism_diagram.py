#!/usr/bin/env python3
"""Plan diagram + numbers of the partition linkage (same maths as src/partitions.js). Writes docs/partitions-mechanism.png."""
import json, math
from pathlib import Path
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
R = Path(__file__).resolve().parent.parent
cfg = json.loads((R / "room.json").read_text())["partitions"]
(a, b), n, W = cfg["line"], cfg["count"], cfg["widthCm"]
mech = cfg["mechanism"]; amin, amax, Lv = mech["minDeg"], mech["maxDeg"], mech["leverCm"]
L = math.dist(a, b); u = ((b[0]-a[0])/L, (b[1]-a[1])/L)
rot = lambda v, d: (v[0]*math.cos(math.radians(d)) - v[1]*math.sin(math.radians(d)), v[0]*math.sin(math.radians(d)) + v[1]*math.cos(math.radians(d)))
P = [(a[0]+u[0]*L*(i+.5)/n, a[1]+u[1]*L*(i+.5)/n) for i in range(n)]
off = 90 - (amin + amax) / 2  # lever angle to the panel; points into the inner space at mid-swing
tip = lambda O, d: (O[0]+rot(u, d+off)[0]*Lv, O[1]+rot(u, d+off)[1]*Lv)
B1, B2 = tip(P[0], amin), tip(P[0], amax)
span = math.dist(B1, B2); e = ((B1[0]-B2[0])/span, (B1[1]-B2[1])/span)
inward = rot(u, off + (amin + amax) / 2); t, beta = mech.get("rodStartCm", 50), mech.get("rodAngleDeg", 55)
sgn = 1 if e[0]*inward[1] - e[1]*inward[0] >= 0 else -1
dr = rot(e, sgn * beta); C0 = (B1[0]+dr[0]*t, B1[1]+dr[1]*t)
d2 = math.dist(C0, B2); r, c = (d2 - t) / 2, (d2 + t) / 2
# simulate one crank turn -> actual swing
def solve(psi):
    C = (C0[0]+r*math.cos(psi), C0[1]+r*math.sin(psi)); O = P[0]
    dx, dy = C[0]-O[0], C[1]-O[1]; d = math.hypot(dx, dy)
    a_ = (Lv*Lv - c*c + d*d)/(2*d); h = math.sqrt(max(0, Lv*Lv - a_*a_))
    mx, my = O[0]+a_*dx/d, O[1]+a_*dy/d
    out = []
    for sg in (1, -1):
        B = (mx+sg*h*dy/d, my-sg*h*dx/d); v = ((B[0]-O[0])/Lv, (B[1]-O[1])/Lv)
        out.append((math.degrees(math.atan2(u[0]*v[1]-u[1]*v[0], u[0]*v[0]+u[1]*v[1])) - off) % 360)
    mid = (amin+amax)/2
    return min(out, key=lambda x: abs((x-mid+540) % 360 - 180))
sw = [solve(k/720*2*math.pi) for k in range(720)]
print("simulated swing", round(min(sw), 2), round(max(sw), 2))
fig, ax = plt.subplots(figsize=(9, 11))
for deg, col, ls in ((amin, "#c0392b", "-"), (amax, "#2f80ed", "--")):
    for O in P:
        d = rot(u, deg); h = W/2
        ax.plot([O[0]-d[0]*h, O[0]+d[0]*h], [O[1]-d[1]*h, O[1]+d[1]*h], ls, color=col, lw=3, alpha=.8)
        T = tip(O, deg); ax.plot([O[0], T[0]], [O[1], T[1]], color="#333", lw=1.5)
    T0, Tn = tip(P[0], deg), tip(P[-1], deg)
    ax.plot([T0[0], Tn[0]], [T0[1], Tn[1]], ls, color="#555", lw=1)
ax.add_patch(plt.Circle(C0, r, fill=False, color="#27ae60", lw=1.5))
ax.plot(*C0, "s", color="#111", ms=9); ax.annotate("motor + crank\n(inner ceiling)", C0, (C0[0]-120, C0[1]+60), arrowprops=dict(arrowstyle="->"))
ax.plot([C0[0]+r*dr[0]*-1, B1[0]], [C0[1]+r*dr[1]*-1, B1[1]], color="#27ae60", lw=1.2)
for O in P: ax.plot(*O, "ko", ms=4)
ax.axvline(a[0], color="#aaa", lw=.8, ls=":")
ax.text(a[0]+8, 590, "divider line (0° = closed)", color="#777", fontsize=8)
ax.text(a[0]-250, -40, "INNER (68 m²)", fontsize=11, color="#555"); ax.text(a[0]+70, -40, "OUTER (85 m²)", fontsize=11, color="#555")
ax.set_aspect("equal"); ax.invert_yaxis(); ax.set_xlim(a[0]-260, a[0]+180); ax.set_ylim(620, -70)
ax.set_title(f"Partition linkage, plan (cm). red = {amin}°, blue dashed = {amax}°\n"
             f"{n} panels × {W} cm, pivots every {L/n:.0f} cm · lever {Lv} cm · crank r = {r:.1f} cm · rod {c:.0f} cm", fontsize=10)
ax.grid(True, lw=.3)
fig.tight_layout(); fig.savefig(R / "docs" / "partitions-mechanism.png", dpi=130)
print(dict(lever_offset_deg=off, tie_bar_min_clearance_to_shafts=round(Lv*math.cos(math.radians((amax-amin)/2)), 1), pivot_spacing=round(L/n, 1), crank_r=round(r, 2), rod=round(c, 1), motor_plan_xy=[round(C0[0], 1), round(C0[1], 1)]))
