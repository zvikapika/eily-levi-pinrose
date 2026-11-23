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

  // ceiling grid segments (plan cm) for every zone: interior lines + optional perimeter of the zone polygon
  ceilingSegments() {
    const segs = [];
    for (const z of this.room.data.zones ?? []) {
      const g = this.cfg.zones?.[z.id];
      if (!g) continue;
      for (const x of g.x ?? []) segs.push(...clipLine([x, -1e4], [0, 1], z.polygon).map((s) => ({ s, zone: z.id, axis: 'x' })));
      for (const y of g.y ?? []) segs.push(...clipLine([-1e4, y], [1, 0], z.polygon).map((s) => ({ s, zone: z.id, axis: 'y' })));
      if (this.cfg.perimeter) {
        const P = z.polygon;
        for (let i = 0; i < P.length; i++) segs.push({ s: [P[i], P[(i + 1) % P.length]], zone: z.id, axis: 'perim' });
      }
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
    const room = this.room, H = room.wallHeight, out = [];
    let k = 1;
    const id = () => `L${String(k++).padStart(3, '0')}`;
    const walls = room.walls.filter((w) => w.kind === 'target' || w.kind === 'optional');
    const cell = 290;
    for (const w of walls) {
      const sg = w.segs[0];
      // 1) vertical lines where a ceiling-grid line meets this wall (the grid continues down the wall)
      const ss = [];
      for (const z of room.data.zones ?? []) {
        const g = this.cfg.zones?.[z.id];
        if (!g) continue;
        const lines = [...(g.x ?? []).map((x) => ({ p: [x, 0], d: [0, 1] })), ...(g.y ?? []).map((y) => ({ p: [0, y], d: [1, 0] }))];
        for (const L of lines) for (const g2 of w.segs) {
          const ex = g2.b[0] - g2.a[0], ey = g2.b[1] - g2.a[1];
          const den = L.d[0] * ey - L.d[1] * ex;
          if (Math.abs(den) < 1e-9) continue;
          const u = ((g2.a[0] - L.p[0]) * L.d[1] - (g2.a[1] - L.p[1]) * L.d[0]) / den;
          if (u <= 0.02 || u >= 0.98) continue;
          const px = g2.a[0] + ex * u, py = g2.a[1] + ey * u;
          if (!pointInPoly(px + g2.n[0] * 5, py + g2.n[1] * 5, z.polygon)) continue;
          ss.push(Math.round(g2.s0 + u * g2.len));
        }
      }
      // 2) fill so no gap on the wall is wider than one grid cell (walls the ceiling lines don't reach get lines too)
      const pts = [0, ...ss.sort((a, b) => a - b), Math.round(w.length)];
      const all = [];
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i], b = pts[i + 1], n = Math.ceil((b - a) / cell);
        for (let j = 1; j < n; j++) all.push(Math.round(a + ((b - a) * j) / n));
        if (i + 1 < pts.length - 1) all.push(b);
      }
      for (const sv of [...new Set(all)]) out.push({ id: id(), surf: w.id, a: [sv, 0], b: [sv, H] });
      // 3) one horizontal line under the ceiling (the grid's edge frame comes down to the wall)
      const hh = H - (this.pcfg.topRunBelowCeilingCm ?? 50);
      out.push({ id: id(), surf: w.id, a: [0, hh], b: [Math.round(w.length), hh] });
    }
    return out;
  }

  setLines(list) {
    // accept the round-2 profile format ({wall, dir, s0, s1, h0, h1}) too
    this.lines = (list ?? []).map((p) => (p.surf ? { ...p, a: [...p.a], b: [...p.b] }
      : { id: p.id, surf: p.wall, a: [p.s0, p.h0], b: p.dir === 'v' ? [p.s0, p.h1] : [p.s1, p.h0] }));
    this.nextId = 1 + Math.max(0, ...this.lines.map((p) => +String(p.id).replace(/\D/g, '') || 0));
    if (this.selected && !this.lines.some((l) => l.id === this.selected)) this.selected = null;
    this.buildLines();
  }
  newId() { return `L${String(this.nextId++).padStart(3, '0')}`; }

  // surface coordinates -> world point (metres), sitting half a profile off the surface
  toWorld(surf, uv, out = new THREE.Vector3()) {
    const sz = this.pcfg.sizeCm ?? 1.7;
    if (surf === 'FLOOR') return out.set(uv[0] * CM, (sz / 2) * CM, uv[1] * CM);
    const w = this.room.wall(surf);
    const p = this.room.pointAt(w, uv[0]);
    return out.set((p.x + p.n[0] * (sz / 2 + 0.05)) * CM, uv[1] * CM, (p.y + p.n[1] * (sz / 2 + 0.05)) * CM);
  }
  // world point -> surface coordinates
  toSurf(surf, v) {
    if (surf === 'FLOOR') return [v.x / CM, v.z / CM];
    const w = this.room.wall(surf);
    return [this.room.projectOnWall(w, v.x / CM, v.z / CM).s, v.y / CM];
  }
  surfNormal(surf) {
    if (surf === 'FLOOR') return new THREE.Vector3(0, 1, 0);
    const n = this.room.wall(surf).segs[0].n;
    return new THREE.Vector3(n[0], 0, n[1]);
  }

  clampLine(l) {
    const w = this.room.wall(l.surf);
    if (!w) return;
    if (l.surf === 'FLOOR') return;
    const H = this.room.wallHeight;
    for (const p of [l.a, l.b]) { p[0] = Math.max(0, Math.min(w.length, p[0])); p[1] = Math.max(0, Math.min(H, p[1])); }
  }

  lineMesh(l, mat) {
    const sz = (this.pcfg.sizeCm ?? 1.7) * CM;
    const A = this.toWorld(l.surf, l.a), B = this.toWorld(l.surf, l.b);
    const len = A.distanceTo(B);
    if (len < 1e-4) return null;
    const X = B.clone().sub(A).normalize();
    const N = this.surfNormal(l.surf);
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
      this.clampLine(l);
      if (!this.room.wall(l.surf)) continue;
      const m = this.lineMesh(l, this.selected === l.id ? this.profSelMat : this.profMat);
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
    const m = this.lineMesh(l, this.previewMat);
    if (m) { this.previewMesh = m; this.prof.add(m); }
  }

  select(id) { this.selected = id; this.buildLines(); }
  remove(id) { this.lines = this.lines.filter((l) => l.id !== id); if (this.selected === id) this.selected = null; this.buildLines(); }
  setCeilingGridVisible(v) { this.ceilingVisible = v; this.ceil.visible = v; }
  setProfilesVisible(v) { this.profilesVisible = v; this.prof.visible = v; }

  lengthCm(l) { return Math.hypot(l.b[0] - l.a[0], l.b[1] - l.a[1]); }
  totalLengthCm() { return this.lines.reduce((a, l) => a + this.lengthCm(l), 0); }
  toJSON() { return this.lines.map((l) => ({ id: l.id, surf: l.surf, a: [...l.a], b: [...l.b] })); }
}
