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
    this.profiles = [];
    this.selected = null;
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
    this.buildProfiles();
  }

  // ------------------------------------------------------------ wall profiles
  // profile: {id, wall, dir:'v'|'h', s0, s1, h0, h1}  (v: s0 == s1; h: h0 == h1), cm along wall / above floor
  defaultProfiles() {
    const room = this.room, H = room.wallHeight, out = [];
    let k = 1;
    const id = () => `P${String(k++).padStart(2, '0')}`;
    const walls = room.walls.filter((w) => w.kind === 'target' || w.kind === 'optional');
    // vertical runs where a ceiling-grid line meets a wall face
    for (const z of room.data.zones ?? []) {
      const g = this.cfg.zones?.[z.id];
      if (!g) continue;
      const lines = [...(g.x ?? []).map((x) => ({ p: [x, 0], d: [0, 1] })), ...(g.y ?? []).map((y) => ({ p: [0, y], d: [1, 0] }))];
      for (const L of lines) for (const w of walls) for (const sg of w.segs) {
        const ex = sg.b[0] - sg.a[0], ey = sg.b[1] - sg.a[1];
        const den = L.d[0] * ey - L.d[1] * ex;
        if (Math.abs(den) < 1e-9) continue;
        const u = ((sg.a[0] - L.p[0]) * L.d[1] - (sg.a[1] - L.p[1]) * L.d[0]) / den;
        if (u <= 0.02 || u >= 0.98) continue;
        const px = sg.a[0] + ex * u, py = sg.a[1] + ey * u;
        if (!pointInPoly(px + sg.n[0] * 5, py + sg.n[1] * 5, z.polygon)) continue;
        const s = Math.round(sg.s0 + u * sg.len);
        if (out.some((p) => p.wall === w.id && p.dir === 'v' && Math.abs(p.s0 - s) < 3)) continue;
        out.push({ id: id(), wall: w.id, dir: 'v', s0: s, s1: s, h0: 0, h1: H });
      }
    }
    // one horizontal run under the ceiling on every mountable wall
    const hh = H - (this.pcfg.topRunBelowCeilingCm ?? 50);
    for (const w of walls) out.push({ id: id(), wall: w.id, dir: 'h', s0: 0, s1: Math.round(w.length), h0: hh, h1: hh });
    return out;
  }

  setProfiles(list) {
    this.profiles = list;
    this.nextId = 1 + Math.max(0, ...list.map((p) => +String(p.id).replace(/\D/g, '') || 0));
    this.buildProfiles();
  }
  newId() { return `P${String(this.nextId++).padStart(2, '0')}`; }

  clampProfile(p) {
    const w = this.room.wall(p.wall);
    if (!w) return;
    const H = this.room.wallHeight;
    const cl = (v, a, b) => Math.max(a, Math.min(b, v));
    p.s0 = cl(p.s0, 0, w.length); p.s1 = cl(p.s1, 0, w.length);
    p.h0 = cl(p.h0, 0, H); p.h1 = cl(p.h1, 0, H);
    if (p.dir === 'v') { p.s1 = p.s0; if (p.h1 < p.h0) [p.h0, p.h1] = [p.h1, p.h0]; }
    else { p.h1 = p.h0; if (p.s1 < p.s0) [p.s0, p.s1] = [p.s1, p.s0]; }
  }

  buildProfiles() {
    for (const c of [...this.prof.children]) { this.prof.remove(c); c.geometry?.dispose(); }
    const sz = (this.pcfg.sizeCm ?? 1.7);
    this.profMeshes = [];
    for (const p of this.profiles) {
      this.clampProfile(p);
      const w = this.room.wall(p.wall);
      if (!w) continue;
      const pieces = [];
      if (p.dir === 'v') pieces.push([p.s0, p.s0]);
      else {
        // split a horizontal run at the wall's polyline corners
        for (const g of w.segs) {
          const a = Math.max(p.s0, g.s0), b = Math.min(p.s1, g.s0 + g.len);
          if (b - a > 0.5) pieces.push([a, b]);
        }
      }
      for (const [a, b] of pieces) {
        const pa = this.room.pointAt(w, a), pb = this.room.pointAt(w, b);
        const n = pa.n, u = pa.u;
        const len = p.dir === 'v' ? p.h1 - p.h0 : b - a;
        const geo = p.dir === 'v' ? new THREE.BoxGeometry(sz * CM, len * CM, sz * CM) : new THREE.BoxGeometry(len * CM, sz * CM, sz * CM);
        const m = new THREE.Mesh(geo, this.selected === p.id ? this.profSelMat : this.profMat);
        const cx = (pa.x + pb.x) / 2 + n[0] * (sz / 2 + 0.05), cy = (pa.y + pb.y) / 2 + n[1] * (sz / 2 + 0.05);
        const ch = p.dir === 'v' ? (p.h0 + p.h1) / 2 : p.h0;
        m.position.set(cx * CM, ch * CM, cy * CM);
        m.rotation.y = Math.atan2(-u[1], u[0]);
        m.castShadow = true; m.receiveShadow = true;
        m.userData.profileId = p.id;
        this.prof.add(m);
        this.profMeshes.push(m);
      }
    }
    this.prof.visible = this.profilesVisible;
  }

  select(id) { this.selected = id; this.buildProfiles(); }
  setCeilingGridVisible(v) { this.ceilingVisible = v; this.ceil.visible = v; }
  setProfilesVisible(v) { this.profilesVisible = v; this.prof.visible = v; }

  // nearest profile on the same wall to a unit position -> snapped pose {s, h, rot, profile, dist}
  // the teardrop TIP (wire exit) touches the profile: tip is TIP_CM from the funnel axis
  snap(u, maxDistCm = Infinity) {
    const TIP_CM = 13.4 + (this.pcfg.sizeCm ?? 1.7) / 2 + 0.3;
    let best = null;
    for (const p of this.profiles) {
      if (p.wall !== u.wall) continue;
      let c;
      if (p.dir === 'v') {
        const side = u.s >= p.s0 ? 1 : -1; // unit on the +s or -s side of the profile
        const h = Math.max(p.h0 + 10, Math.min(p.h1 - 10, u.h));
        // unit frame X (viewer's right, facing the wall) = (n.y, -n.x) in plan; +s is +X or -X depending on the wall side.
        // roll is CCW facing the wall; tip (frame +Y rotated by roll) = -X at +90, +X at -90; it must point back at the profile.
        const pt = this.room.pointAt(this.room.wall(p.wall), p.s0);
        const sgn = Math.sign(pt.n[1] * pt.u[0] - pt.n[0] * pt.u[1]) || 1;
        c = { s: p.s0 + side * TIP_CM, h, rot: -side * sgn > 0 ? -90 : 90, d: Math.abs(u.s - p.s0) };
      } else {
        const side = u.h <= p.h0 ? -1 : 1; // below (tip up) or above (tip down)
        const s = Math.max(p.s0 + 10, Math.min(p.s1 - 10, u.s));
        c = { s, h: p.h0 + side * TIP_CM, rot: side < 0 ? 0 : 180, d: Math.abs(u.h - p.h0) };
      }
      c.profile = p.id;
      if (c.d <= maxDistCm && (!best || c.d < best.d)) best = c;
    }
    return best;
  }
  // is unit u attached to a profile (tip within 2 cm of one)?
  attachedTo(u) {
    const c = this.snap(u);
    if (!c) return null;
    return Math.abs(c.s - u.s) < 2 && Math.abs(c.h - u.h) < 2 ? c.profile : null;
  }

  totalLengthCm() {
    return this.profiles.reduce((a, p) => a + (p.dir === 'v' ? p.h1 - p.h0 : p.s1 - p.s0), 0);
  }
  toJSON() { return this.profiles.map((p) => ({ ...p })); }
}
