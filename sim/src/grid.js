// Ceiling grid (existing 4x4 cm metal profile) + white 17x17 mm wall profiles (electric channel) that the units mount on.
import * as THREE from 'three';
import { CM } from './room.js';

// ---- 2D helpers (plan cm)
export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// clip the infinite line through p along d to a polygon -> list of [a, b] segments inside
function clipLine(p, d, poly) {
  const ts = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const den = d[0] * ey - d[1] * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((a[0] - p[0]) * ey - (a[1] - p[1]) * ex) / den;
    const u = ((a[0] - p[0]) * d[1] - (a[1] - p[1]) * d[0]) / den;
    if (u >= -1e-9 && u <= 1 + 1e-9) ts.push(t);
  }
  ts.sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i + 1 < ts.length; i++) {
    const tm = (ts[i] + ts[i + 1]) / 2;
    if (ts[i + 1] - ts[i] > 1 && pointInPoly(p[0] + d[0] * tm, p[1] + d[1] * tm, poly))
      out.push([[p[0] + d[0] * ts[i], p[1] + d[1] * ts[i]], [p[0] + d[0] * ts[i + 1], p[1] + d[1] * ts[i + 1]]]);
  }
  return out;
}

// Sutherland-Hodgman: keep the part of polygon P with a*x + b*y >= c
function clipHalf(P, a, b, c) {
  const out = [];
  const f = (p) => a * p[0] + b * p[1] - c;
  for (let i = 0; i < P.length; i++) {
    const p = P[i], q = P[(i + 1) % P.length], fp = f(p), fq = f(q);
    if (fp >= 0) out.push(p);
    if ((fp >= 0) !== (fq >= 0)) { const t = fp / (fp - fq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
  }
  return out;
}

export function zoneOf(room, x, y) {
  for (const z of room.data.zones ?? []) if (pointInPoly(x, y, z.polygon)) return z.id;
  return (room.data.zones?.[1]?.id) ?? 'outer';
}

export class Grid {
  constructor(room) {
    this.room = room;
    this.cfg = room.data.ceilingGrid ?? { zones: {} };
    this.pcfg = room.data.wallProfiles ?? { sizeCm: 1.7, topRunBelowCeilingCm: 50 };
    this.group = new THREE.Group();
    this.group.name = 'grid';
    this.ceilMat = new THREE.MeshStandardMaterial({ color: this.cfg.colour ?? 0x3a3a3c, roughness: 0.45, metalness: 0.7 });
    this.profMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    this.profSelMat = new THREE.MeshStandardMaterial({ color: 0xff8a3d, roughness: 0.5 });
    this.lines = [];
    this.selected = null;
    this.preview = null;
    this.ceilingVisible = true;
    this.profilesVisible = true;
    this.build();
  }

  // ceiling grid of one zone: polygon (rectangle cut by half-planes) + its x and y grid lines (plan cm)
  zoneGrid(id) {
    const g = this.cfg.zones?.[id];
    if (!g || g.x0 === undefined) return null;
    let poly = [[g.x0, g.y0], [g.x1, g.y0], [g.x1, g.y1], [g.x0, g.y1]];
    for (const [A, B, C] of g.keep ?? []) poly = clipHalf(poly, A, B, C);
    const xs = Array.from({ length: g.nx + 1 }, (_, i) => g.x0 + ((g.x1 - g.x0) * i) / g.nx);
    const ys = Array.from({ length: g.ny + 1 }, (_, i) => g.y0 + ((g.y1 - g.y0) * i) / g.ny);
    return { poly, xs, ys };
  }

  ceilingSegments() {
    const segs = [];
    for (const z of this.room.data.zones ?? []) {
      const G = this.zoneGrid(z.id);
      if (!G) continue;
      for (const x of G.xs.slice(1, -1)) segs.push(...clipLine([x, -1e4], [0, 1], G.poly).map((s) => ({ s, zone: z.id })));
      for (const y of G.ys.slice(1, -1)) segs.push(...clipLine([-1e4, y], [1, 0], G.poly).map((s) => ({ s, zone: z.id })));
      const P = G.poly;
      for (let i = 0; i < P.length; i++) segs.push({ s: [P[i], P[(i + 1) % P.length]], zone: z.id });
    }
    return segs;
  }

  build() {
    for (const c of [...this.group.children]) { this.group.remove(c); c.geometry?.dispose(); }
    const H = this.room.wallHeight;
    const t = (this.cfg.profileCm ?? 4) * CM;
    this.ceil = new THREE.Group();
    for (const { s: [a, b] } of this.ceilingSegments()) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const m = new THREE.Mesh(new THREE.BoxGeometry(len * CM, t, t), this.ceilMat);
      m.position.set(((a[0] + b[0]) / 2) * CM, H * CM - t / 2, ((a[1] + b[1]) / 2) * CM);
      m.rotation.y = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
      m.castShadow = true;
      this.ceil.add(m);
    }
    this.ceil.visible = this.ceilingVisible;
    this.group.add(this.ceil);
    this.prof = new THREE.Group();
    this.group.add(this.prof);
    this.buildLines();
  }

  // ------------------------------------------------------------ grid lines (white 17x17 profile)
  // line: {id, surf: wallId | 'FLOOR', a: [u, v], b: [u, v]}; wall: u = cm along the wall, v = cm above the floor;
  // floor: u, v = plan x, y (cm). Lines can run in any direction on their surface.
  defaultLines() {
    // the wall grid continues the ceiling grid: every ceiling-grid line (edges included) is extended to the walls;
    // where it meets a mountable wall it becomes a vertical line from the floor to the ceiling, and a short ceiling
    // line (white profile) joins the wall line to the ceiling grid (~80 cm)
    const room = this.room, H = room.wallHeight, out = [];
    let k = 1;
    const id = () => `L${String(k++).padStart(3, '0')}`;
    const walls = room.walls.filter((w) => w.kind === 'target' || w.kind === 'optional');
    for (const z of room.data.zones ?? []) {
      const G = this.zoneGrid(z.id);
      if (!G) continue;
      const nudge = (v, i, arr) => (i === 0 ? v + 0.05 : i === arr.length - 1 ? v - 0.05 : v); // edge lines: clip just inside
      const lines = [...G.xs.map((x, i, A) => ({ p: [nudge(x, i, A), 0], d: [0, 1] })), ...G.ys.map((y, i, A) => ({ p: [0, nudge(y, i, A)], d: [1, 0] }))];
      for (const L of lines) {
        const inside = clipLine([L.p[0] - L.d[0] * 1e4, L.p[1] - L.d[1] * 1e4], L.d, G.poly)[0];
        if (!inside) continue;
        for (const w of walls) for (const g2 of w.segs) {
          const ex = g2.b[0] - g2.a[0], ey = g2.b[1] - g2.a[1];
          const den = L.d[0] * ey - L.d[1] * ex;
          if (Math.abs(den) < 1e-9) continue;
          const u = ((g2.a[0] - L.p[0]) * L.d[1] - (g2.a[1] - L.p[1]) * L.d[0]) / den;
          if (u <= 0.01 || u >= 0.99) continue;
          const px = g2.a[0] + ex * u, py = g2.a[1] + ey * u;
          if (!pointInPoly(px + g2.n[0] * 5, py + g2.n[1] * 5, z.polygon)) continue;
          // the wall must be reached from the grid without leaving the zone: nearest grid end -> wall point
          const near = [inside[0], inside[1]].sort((A, B) => Math.hypot(A[0] - px, A[1] - py) - Math.hypot(B[0] - px, B[1] - py))[0];
          const mid = [(near[0] + px) / 2, (near[1] + py) / 2];
          if (!pointInPoly(mid[0], mid[1], z.polygon)) continue;
          const sv = Math.round(g2.s0 + u * g2.len);
          if (out.some((l) => l.surf === w.id && Math.abs(l.a[0] - sv) < 2)) continue;
          out.push({ id: id(), surf: w.id, a: [sv, 0], b: [sv, H] });
          out.push({ id: id(), surf: 'CEIL', a: [Math.round(px + g2.n[0] * 1), Math.round(py + g2.n[1] * 1)], b: [Math.round(near[0]), Math.round(near[1])] });
        }
      }
    }
    return out;
  }

  setLines(list) {
    // accept the round-2 profile format ({wall, dir, s0, s1, h0, h1}) too
    this.lines = (list ?? []).map((p) => (p.type === 'curve' ? { ...p, pts: p.pts.map((q) => [...q]) } : p.surf ? { ...p, a: [...p.a], b: [...p.b] }
      : { id: p.id, surf: p.wall, a: [p.s0, p.h0], b: p.dir === 'v' ? [p.s0, p.h1] : [p.s1, p.h0] }));
    this.nextId = 1 + Math.max(0, ...this.lines.map((p) => +String(p.id).replace(/\D/g, '') || 0));
    if (this.selected && !this.lines.some((l) => l.id === this.selected)) this.selected = null;
    this.buildLines();
  }
  newId() { return `L${String(this.nextId++).padStart(3, '0')}`; }

  // surface coordinates -> world point (metres), sitting half a profile off the surface
  toWorld(surf, uv, out = new THREE.Vector3()) {
    const sz = this.pcfg.sizeCm ?? 1.7;
    if (surf === 'AIR') return out.set(uv[0] * CM, uv[2] * CM, uv[1] * CM); // free 3D point: plan x, plan y, height
    if (surf === 'FLOOR') return out.set(uv[0] * CM, (sz / 2) * CM, uv[1] * CM);
    if (surf === 'CEIL') return out.set(uv[0] * CM, (this.room.wallHeight - sz / 2) * CM, uv[1] * CM);
    const w = this.room.wall(surf);
    const p = this.room.pointAt(w, uv[0]);
    return out.set((p.x + p.n[0] * (sz / 2 + 0.05)) * CM, uv[1] * CM, (p.y + p.n[1] * (sz / 2 + 0.05)) * CM);
  }
  // world point -> surface coordinates
  toSurf(surf, v) {
    if (surf === 'AIR') return [v.x / CM, v.z / CM, v.y / CM];
    if (surf === 'FLOOR' || surf === 'CEIL') return [v.x / CM, v.z / CM];
    const w = this.room.wall(surf);
    return [this.room.projectOnWall(w, v.x / CM, v.z / CM).s, v.y / CM];
  }
  surfNormal(surf, dir) {
    if (surf === 'AIR') {
      // free line: keep the square section upright (one face up) unless the line is vertical
      const up = Math.abs(dir?.y ?? 0) > 0.95 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      return up;
    }
    if (surf === 'FLOOR') return new THREE.Vector3(0, 1, 0);
    if (surf === 'CEIL') return new THREE.Vector3(0, -1, 0);
    const n = this.room.wall(surf).segs[0].n;
    return new THREE.Vector3(n[0], 0, n[1]);
  }

  clampLine(l) {
    const w = this.room.wall(l.surf);
    if (!w) return;
    if (l.surf === 'FLOOR' || l.surf === 'CEIL' || l.surf === 'AIR') return;
    const H = this.room.wallHeight;
    for (const p of [l.a, l.b]) { p[0] = Math.max(0, Math.min(w.length, p[0])); p[1] = Math.max(0, Math.min(H, p[1])); }
  }

  lineMesh(l, mat) {
    const sz = (this.pcfg.sizeCm ?? 1.7) * CM;
    const A = this.toWorld(l.surf, l.a), B = this.toWorld(l.surf, l.b);
    const len = A.distanceTo(B);
    if (len < 1e-4) return null;
    const X = B.clone().sub(A).normalize();
    const N = this.surfNormal(l.surf, X);
    const Y = new THREE.Vector3().crossVectors(N, X).normalize();
    const Z = new THREE.Vector3().crossVectors(X, Y);
    const m = new THREE.Mesh(new THREE.BoxGeometry(len + sz, sz, sz), mat); // + sz: square ends meet at the joints
    m.matrixAutoUpdate = false;
    m.matrix.makeBasis(X, Y, Z).setPosition(A.clone().add(B).multiplyScalar(0.5));
    m.castShadow = true; m.receiveShadow = true;
    m.userData.lineId = l.id;
    return m;
  }

  buildLines() {
    for (const c of [...this.prof.children]) { this.prof.remove(c); c.geometry?.dispose(); }
    this.lineMeshes = [];
    for (const l of this.lines) {
      const mat = this.selected === l.id ? this.profSelMat : this.profMat;
      if (l.type === 'curve') { const m = this.curveMesh(l, mat); if (m) { this.prof.add(m); this.lineMeshes.push(m); } continue; }
      this.clampLine(l);
      if (l.surf !== 'CEIL' && l.surf !== 'AIR' && !this.room.wall(l.surf)) continue;
      const m = this.lineMesh(l, mat);
      if (!m) continue;
      this.prof.add(m);
      this.lineMeshes.push(m);
    }
    this.setPreview(this.preview);
    this.prof.visible = this.profilesVisible;
  }

  // dashed-looking preview of the line being drawn
  setPreview(l) {
    this.preview = l;
    if (this.previewMesh) { this.prof.remove(this.previewMesh); this.previewMesh.geometry.dispose(); this.previewMesh = null; }
    if (!l) return;
    this.previewMat ??= new THREE.MeshBasicMaterial({ color: 0xff8a3d, transparent: true, opacity: 0.75 });
    const m = l.type === 'curve' ? this.curveMesh(l, this.previewMat) : this.lineMesh(l, this.previewMat);
    if (m) { this.previewMesh = m; this.prof.add(m); }
  }

  select(id) { this.selected = id; this.buildLines(); }
  remove(id) { this.lines = this.lines.filter((l) => l.id !== id); if (this.selected === id) this.selected = null; this.buildLines(); }
  setCeilingGridVisible(v) { this.ceilingVisible = v; this.ceil.visible = v; }
  setProfilesVisible(v) { this.profilesVisible = v; this.prof.visible = v; }

  lengthCm(l) {
    if (l.type === 'curve') return this.curveOf(l).getLength() / CM;
    return this.toWorld(l.surf, l.a).distanceTo(this.toWorld(l.surf, l.b)) / CM;
  }
  totalLengthCm() { return this.lines.reduce((a, l) => a + this.lengthCm(l), 0); }
  toJSON() { return this.lines.map((l) => (l.type === 'curve' ? { id: l.id, type: 'curve', pts: l.pts.map((p) => [...p]) } : { id: l.id, surf: l.surf, a: [...l.a], b: [...l.b] })); }

  // ------------------------------------------------------------ curves (printed rails): pts = [[x, y, h], ...] plan cm
  curveOf(l) { return new THREE.CatmullRomCurve3(l.pts.map((p) => new THREE.Vector3(p[0] * CM, p[2] * CM, p[1] * CM)), false, 'centripetal'); }
  // square section swept along the curve; hollow = printable channel (outer 17, wall `wallMm`) in mm for export
  curveGeometry(l, { mm = false, hollow = false, wallMm = 2 } = {}) {
    const sz = (this.pcfg.sizeCm ?? 1.7) * CM, k = mm ? 1000 : 1;
    const curve = this.curveOf(l);
    const h = (sz / 2) * k;
    const shape = new THREE.Shape([new THREE.Vector2(-h, -h), new THREE.Vector2(h, -h), new THREE.Vector2(h, h), new THREE.Vector2(-h, h)]);
    if (hollow) {
      const i = h - (wallMm / 1000) * k;
      shape.holes.push(new THREE.Path([new THREE.Vector2(-i, -i), new THREE.Vector2(-i, i), new THREE.Vector2(i, i), new THREE.Vector2(i, -i)]));
    }
    const path = mm ? new THREE.CatmullRomCurve3(curve.points.map((p) => p.clone().multiplyScalar(1000)), false, 'centripetal') : curve;
    const steps = Math.max(8, Math.round(curve.getLength() / 0.01));
    return new THREE.ExtrudeGeometry(shape, { steps, bevelEnabled: false, extrudePath: path });
  }
  curveMesh(l, mat) {
    if (!l.pts || l.pts.length < 2) return null;
    const m = new THREE.Mesh(this.curveGeometry(l), mat);
    m.castShadow = true; m.receiveShadow = true;
    m.userData.lineId = l.id;
    return m;
  }
  curveSizeCm(l) {
    const b = new THREE.Box3().setFromPoints(this.curveOf(l).getPoints(100));
    const s = b.getSize(new THREE.Vector3());
    return [s.x / CM + 1.7, s.z / CM + 1.7, s.y / CM + 1.7];
  }

  // ------------------------------------------------------------ junctions (where line ends meet) -> printable connectors
  junctions(tolCm = 1.5) {
    const ends = [];
    for (const l of this.lines) {
      if (l.type === 'curve') {
        const c = this.curveOf(l), n = l.pts.length;
        for (const [t, i] of [[0, 0], [1, n - 1]]) {
          const P = c.getPointAt(t), T = c.getTangentAt(t).multiplyScalar(t === 0 ? 1 : -1);
          ends.push({ line: l.id, p: P, dir: T, surf: 'AIR', i });
        }
        continue;
      }
      const A = this.toWorld(l.surf, l.a), B = this.toWorld(l.surf, l.b);
      const d = B.clone().sub(A).normalize();
      ends.push({ line: l.id, p: A, dir: d, surf: l.surf }, { line: l.id, p: B, dir: d.clone().negate(), surf: l.surf });
    }
    const nodes = [];
    for (const e of ends) {
      let n = nodes.find((q) => q.p.distanceTo(e.p) < tolCm * CM);
      if (!n) { n = { p: e.p.clone(), arms: [] }; nodes.push(n); }
      n.arms.push(e);
    }
    return nodes.filter((n) => n.arms.length >= 2).map((n, k) => ({
      id: `J${String(k + 1).padStart(2, '0')}`,
      at_cm: [n.p.x / CM, n.p.z / CM, n.p.y / CM].map((v) => Math.round(v * 10) / 10),
      arms: n.arms.map((a) => ({ line: a.line, surface: a.surf, dir: [a.dir.x, a.dir.z, a.dir.y].map((v) => Math.round(v * 1000) / 1000),
        back: a.surf === 'AIR' ? null : (() => { const N = this.surfNormal(a.surf); return [-N.x, -N.z, -N.y]; })() })),
    }));
  }
}
