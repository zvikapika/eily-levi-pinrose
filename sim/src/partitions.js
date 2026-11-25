// Rotating partitions on the inner/outer divider + the linkage that swings them all together between minDeg and maxDeg.
//
// Mechanism (design, see docs/partitions-mechanism.md):
//   every partition pivots on a vertical shaft at its centre; at the top each shaft carries a lever of length L,
//   fixed on the shaft so that at mid-swing it points straight into the inner space. All lever tips are pinned to one tie bar, so the levers form a parallelogram and all
//   panels always share the same angle. A gear motor hung from the inner-room ceiling turns a crank (radius r) that drives
//   the first lever through a connecting rod (length c): a crank-rocker four-bar. The crank centre sits on the line
//   through the lever-tip positions at minDeg and maxDeg, so r = L*sin((max-min)/2) and the panels swing exactly
//   minDeg..maxDeg while the motor turns continuously one way - they can never reach 0 deg (all closed).
import * as THREE from 'three';
import { CM } from './room.js';

const rotU = (u, deg) => { const a = THREE.MathUtils.degToRad(deg), c = Math.cos(a), s = Math.sin(a); return [u[0] * c - u[1] * s, u[0] * s + u[1] * c]; };

export class Partitions {
  constructor(room) {
    this.room = room;
    const d = room.data.partitions;
    this.cfg = d;
    this.group = new THREE.Group();
    this.group.name = 'partitions';
    this.panelMat = new THREE.MeshStandardMaterial({ color: 0xa8784c, roughness: 0.95 }); // cork (Eily's photos)
    this.aluMat = new THREE.MeshStandardMaterial({ color: 0xc9ccd0, roughness: 0.35, metalness: 0.8 });
    this.metalMat = new THREE.MeshStandardMaterial({ color: 0x55595f, roughness: 0.4, metalness: 0.8 });
    this.motorMat = new THREE.MeshStandardMaterial({ color: 0x202226, roughness: 0.5, metalness: 0.4 });
    this.state = { count: d?.count ?? 5, widthCm: d?.widthCm ?? 100, mechanism: true, running: true,
      minDeg: d?.mechanism?.minDeg ?? 45, maxDeg: d?.mechanism?.maxDeg ?? 90, periodS: d?.mechanism?.periodS ?? 60,
      leverCm: d?.mechanism?.leverCm ?? 20, manual: [], visible: true };
    this.phase = 0;
    this.angle = this.state.minDeg;
    if (d) this.build();
  }

  get enabled() { return !!this.cfg; }

  pivots() {
    const [a, b] = this.cfg.line;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    const n = this.state.count;
    return { u, L, pts: Array.from({ length: n }, (_, i) => [a[0] + u[0] * L * (i + 0.5) / n, a[1] + u[1] * L * (i + 0.5) / n]) };
  }

  // lever fixed on the shaft at this angle to the panel: at mid-swing it points straight into the inner space
  // (perpendicular to the divider), so the tie bar stays >= L*cos(swing/2) away from the pivot shafts
  leverOffset() { return 90 - (this.state.minDeg + this.state.maxDeg) / 2; }

  // four-bar design numbers (plan cm)
  design() {
    const { u, pts } = this.pivots();
    const s = this.state, Lv = s.leverCm;
    const O = pts[0];
    const off = this.leverOffset();
    const tip = (deg) => { const d = rotU(u, deg + off); return [O[0] + d[0] * Lv, O[1] + d[1] * Lv]; };
    const B1 = tip(s.minDeg), B2 = tip(s.maxDeg);
    // crank centre: from B1 go t cm in a direction turned `rodAngleDeg` away from the tie-bar line into the inner space,
    // so the motor is clear of the tie bar. Then rod - crank = |C0 B1| and rod + crank = |C0 B2| (rocker dead points).
    const span = Math.hypot(B2[0] - B1[0], B2[1] - B1[1]);
    const e = [(B1[0] - B2[0]) / span, (B1[1] - B2[1]) / span];
    const inward = rotU(u, off + (s.minDeg + s.maxDeg) / 2); // lever direction at mid-swing = into the inner space
    const t = s.rodStartCm ?? 50, beta = s.rodAngleDeg ?? 55;
    const sgn = Math.sign(e[0] * inward[1] - e[1] * inward[0]) || 1;
    const dir = rotU(e, sgn * beta);
    const C0 = [B1[0] + dir[0] * t, B1[1] + dir[1] * t];
    const d2 = Math.hypot(C0[0] - B2[0], C0[1] - B2[1]);
    const r = (d2 - t) / 2, c = (d2 + t) / 2;
    return { u, pts, O, Lv, r, c, C0, B1, B2, spacing: pts.length > 1 ? Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) : 0 };
  }

  build() {
    for (const c of [...this.group.children]) { this.group.remove(c); c.geometry?.dispose(); }
    const H = this.room.wallHeight, s = this.state, cfg = this.cfg;
    const ph = H - (cfg.gapTopCm ?? 3) - (cfg.gapBottomCm ?? 3);
    const D = this.design();
    this.D = D;
    this.panels = D.pts.map(([x, y]) => {
      const g = new THREE.Group();
      g.position.set(x * CM, 0, y * CM);
      const panel = new THREE.Mesh(new THREE.BoxGeometry(s.widthCm * CM, ph * CM, (cfg.thicknessCm ?? 2) * CM), this.panelMat);
      panel.position.y = ((cfg.gapBottomCm ?? 3) + ph / 2) * CM;
      panel.castShadow = true; panel.receiveShadow = true;
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, H * CM, 12), this.metalMat);
      shaft.position.y = (H / 2) * CM;
      const lever = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.008, s.leverCm * CM), this.metalMat);
      lever.position.set(0, (H - 1.5) * CM, 0);
      // aluminium edge profiles on both vertical edges (as in the photos)
      const th = (cfg.thicknessCm ?? 4) * CM;
      for (const sx of [-1, 1]) {
        const e = new THREE.Mesh(new THREE.BoxGeometry(0.02, ph * CM, th + 0.004), this.aluMat);
        e.position.set(sx * (s.widthCm * CM / 2 - 0.01), panel.position.y, 0);
        e.castShadow = true;
        g.add(e);
      }
      g.add(panel, shaft);
      this.group.add(g);
      return { g, panel, lever };
    });
    this.linkage = new THREE.Group();
    this.tieBar = new THREE.Mesh(new THREE.BoxGeometry(1, 0.008, 0.015), this.metalMat);
    this.levers = D.pts.map(() => new THREE.Mesh(new THREE.BoxGeometry(1, 0.008, 0.02), this.metalMat));
    this.rod = new THREE.Mesh(new THREE.BoxGeometry(1, 0.008, 0.012), this.metalMat);
    this.crank = new THREE.Mesh(new THREE.BoxGeometry(1, 0.01, 0.02), this.metalMat);
    this.motor = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.10, 0.12), this.motorMat);
    this.motor.position.set(D.C0[0] * CM, (H - 8) * CM, D.C0[1] * CM);
    const hanger = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.03, 0.02), this.motorMat);
    hanger.position.set(D.C0[0] * CM, (H - 1.5) * CM, D.C0[1] * CM);
    this.linkage.add(this.tieBar, ...this.levers, this.rod, this.crank, this.motor, hanger);
    this.group.add(this.linkage);
    this.group.visible = s.visible;
    this.apply();
  }

  bar(mesh, a, b, yCm) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    mesh.scale.x = Math.max(1e-3, len * CM);
    mesh.position.set(((a[0] + b[0]) / 2) * CM, yCm * CM, ((a[1] + b[1]) / 2) * CM);
    mesh.rotation.set(0, Math.atan2(-(b[1] - a[1]), b[0] - a[0]), 0);
  }

  // solve the four-bar for crank angle psi -> panel angle (deg)
  solve(psi) {
    const D = this.D;
    const C = [D.C0[0] + D.r * Math.cos(psi), D.C0[1] + D.r * Math.sin(psi)];
    // intersection of circle(O, Lv) and circle(C, c)
    const dx = C[0] - D.O[0], dy = C[1] - D.O[1], d = Math.hypot(dx, dy);
    const a = (D.Lv * D.Lv - D.c * D.c + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, D.Lv * D.Lv - a * a));
    const mx = D.O[0] + (a * dx) / d, my = D.O[1] + (a * dy) / d;
    const cands = [[mx + (h * dy) / d, my - (h * dx) / d], [mx - (h * dy) / d, my + (h * dx) / d]];
    // lever angle of each candidate; keep the one inside the design range
    const ang = (B) => {
      const v = [(B[0] - D.O[0]) / D.Lv, (B[1] - D.O[1]) / D.Lv];
      const base = D.u; // panel angle = lever angle - 90 measured from the divider direction
      let deg = THREE.MathUtils.radToDeg(Math.atan2(base[0] * v[1] - base[1] * v[0], base[0] * v[0] + base[1] * v[1])) - this.leverOffset();
      return ((deg % 360) + 360) % 360;
    };
    const mid = (this.state.minDeg + this.state.maxDeg) / 2;
    const A = cands.map(ang);
    const dist = (x) => Math.abs(((x - mid + 540) % 360) - 180);
    const k = dist(A[0]) <= dist(A[1]) ? 0 : 1;
    return { deg: A[k], B: cands[k], C };
  }

  update(dt) {
    if (!this.enabled) return;
    const s = this.state;
    if (s.mechanism) {
      if (s.running && s.periodS > 0) this.phase += (dt / s.periodS) * Math.PI * 2;
      const r = this.solve(this.phase);
      this.angle = r.deg;
      this._BC = r;
    }
    this.apply();
  }

  panelAngle(i) {
    const s = this.state;
    return s.mechanism ? this.angle : (s.manual[i] ?? s.minDeg);
  }

  apply() {
    if (!this.panels) return;
    const D = this.D, H = this.room.wallHeight, s = this.state;
    const base = Math.atan2(-D.u[1], D.u[0]);
    this.panels.forEach((p, i) => { p.g.rotation.y = base - THREE.MathUtils.degToRad(this.panelAngle(i)); });
    this.linkage.visible = s.mechanism;
    if (!s.mechanism) return;
    const y = H - 1.5;
    const tips = D.pts.map((O) => { const d = rotU(D.u, this.angle + this.leverOffset()); return [O[0] + d[0] * D.Lv, O[1] + d[1] * D.Lv]; });
    D.pts.forEach((O, i) => this.bar(this.levers[i], O, tips[i], y));
    this.bar(this.tieBar, tips[0], tips[tips.length - 1], y + 0.6);
    const r = this._BC ?? this.solve(this.phase);
    this.bar(this.rod, r.C, tips[0], y - 0.8);
    this.bar(this.crank, D.C0, r.C, y - 1.6);
  }

  // closed-ness check: is there any pose where every panel is closed (angle 0 / 180)?
  minGapToClosedDeg() {
    let m = Infinity;
    for (let k = 0; k < 720; k++) {
      const a = this.solve((k / 720) * Math.PI * 2).deg;
      m = Math.min(m, Math.abs(((a + 90) % 180) - 90));
    }
    return m;
  }

  setVisible(v) { this.state.visible = v; this.group.visible = v; }
  setCount(n) { this.state.count = Math.max(1, Math.min(10, Math.round(n))); this.build(); }
  setWidth(w) { this.state.widthCm = w; this.build(); }
  rebuild() { this.build(); }

  toJSON() { const { manual, ...rest } = this.state; return { ...rest, manual: [...manual], phase: this.phase }; }
  fromJSON(d) {
    if (!d) return;
    Object.assign(this.state, d);
    this.state.manual = [...(d.manual ?? [])];
    this.phase = d.phase ?? 0;
    this.build();
  }
}
