// Room geometry: wall polylines (cm, plan frame x=east, y=south) -> meshes + wall math.
// World frame: metres, X = plan x, Z = plan y, Y = up.
import * as THREE from 'three';

export const CM = 0.01;

export class Room {
  constructor(data) {
    this.data = data;
    this.wallHeight = data.wallHeightCm ?? 350;
    this.optionalEnabled = false;
    this.walls = data.walls.map((w) => prepWall(w, data.defaultThicknessCm ?? 20));
    this.byId = new Map(this.walls.map((w) => [w.id, w]));
    this.group = new THREE.Group();
    this.group.name = 'room';
    this.wallMat = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.92, metalness: 0 });
    this.excludedMat = new THREE.MeshStandardMaterial({ color: 0xe6e3dc, roughness: 0.92 });
    this.floorMat = new THREE.MeshStandardMaterial({ color: 0x8d8a85, roughness: 0.8 });
    this.ceilMat = new THREE.MeshStandardMaterial({ color: 0xdedbd5, roughness: 1, side: THREE.DoubleSide });
    this.build();
  }

  mountable(w) {
    return w.kind === 'target' || (w.kind === 'optional' && this.optionalEnabled);
  }
  mountableWalls() {
    return this.walls.filter((w) => this.mountable(w));
  }
  wall(id) {
    return this.byId.get(id);
  }

  // point on the mounting face at distance s (cm) from the wall's first point
  pointAt(w, s) {
    s = Math.max(0, Math.min(w.length, s));
    let seg = w.segs[w.segs.length - 1];
    for (const g of w.segs) if (s <= g.s0 + g.len) { seg = g; break; }
    const t = s - seg.s0;
    return { x: seg.a[0] + seg.u[0] * t, y: seg.a[1] + seg.u[1] * t, n: seg.n, u: seg.u };
  }

  // nearest point on a wall (plan cm) -> {wall, s, dist}
  projectOnWall(w, x, y) {
    let best = null;
    for (const g of w.segs) {
      const dx = x - g.a[0], dy = y - g.a[1];
      let t = dx * g.u[0] + dy * g.u[1];
      t = Math.max(0, Math.min(g.len, t));
      const px = g.a[0] + g.u[0] * t, py = g.a[1] + g.u[1] * t;
      const d = Math.hypot(x - px, y - py);
      if (!best || d < best.dist) best = { wall: w, s: g.s0 + t, dist: d };
    }
    return best;
  }
  nearestMountable(x, y) {
    let best = null;
    for (const w of this.mountableWalls()) {
      const p = this.projectOnWall(w, x, y);
      if (!best || p.dist < best.dist) best = p;
    }
    return best;
  }

  setWallHeight(cm) {
    this.wallHeight = cm;
    this.build();
  }

  build() {
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      c.geometry?.dispose();
    }
    this.wallMeshes = [];
    const H = this.wallHeight * CM;
    for (const w of this.walls) {
      for (const g of w.segs) {
        const th = w.thickness * CM;
        const geo = new THREE.BoxGeometry(g.len * CM, H, th);
        const m = new THREE.Mesh(geo, w.kind === 'excluded' ? this.excludedMat : this.wallMat);
        // centre: face midpoint pushed back (away from the mount face) by half the thickness
        const mx = (g.a[0] + g.b[0]) / 2 - g.n[0] * w.thickness / 2;
        const my = (g.a[1] + g.b[1]) / 2 - g.n[1] * w.thickness / 2;
        m.position.set(mx * CM, H / 2, my * CM);
        m.rotation.y = Math.atan2(-g.u[1], g.u[0]);
        m.castShadow = true;
        m.receiveShadow = true;
        m.userData = { wallId: w.id, kind: w.kind, n: g.n, mid: [((g.a[0] + g.b[0]) / 2) * CM, ((g.a[1] + g.b[1]) / 2) * CM] };
        m.userData.solidMat = m.material;
        this.group.add(m);
        this.wallMeshes.push(m);
      }
    }
    // floor (gallery polygon) + a larger ground slab for everything outside it
    const shape = new THREE.Shape(this.data.floorPolygon.map(([x, y]) => new THREE.Vector2(x * CM, -y * CM)));
    const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.name = 'floor';
    this.group.add(floor);
    const b = this.bounds();
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry((b.maxX - b.minX) * CM + 20, (b.maxY - b.minY) * CM + 20),
      new THREE.MeshStandardMaterial({ color: 0x55534f, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(((b.minX + b.maxX) / 2) * CM, -0.01, ((b.minY + b.maxY) / 2) * CM);
    ground.receiveShadow = true;
    this.group.add(ground);
    this.ceiling = new THREE.Mesh(new THREE.ShapeGeometry(shape), this.ceilMat);
    this.ceiling.rotation.x = -Math.PI / 2;
    this.ceiling.position.y = H;
    this.ceiling.visible = this._ceilingVisible ?? false;
    this.group.add(this.ceiling);
    this.buildPlanOverlay();
  }

  setCeilingVisible(v) {
    this._ceilingVisible = v;
    if (this.ceiling) this.ceiling.visible = v;
  }

  // overview "cutaway": walls whose mounting face points away from the camera become see-through
  cutaway(cam, enabled) {
    if (!this.ghostMat) {
      this.ghostMat = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.14, depthWrite: false, roughness: 0.9 });
      this.ghostMat.color = this.wallMat.color; // share the colour object so the wall colour picker applies
    }
    for (const m of this.wallMeshes) {
      const { n, mid, solidMat } = m.userData;
      const behind = enabled && (cam.x - mid[0]) * n[0] + (cam.z - mid[1]) * n[1] < -0.05 && m.userData.kind !== 'excluded';
      m.material = behind ? this.ghostMat : solidMat;
    }
  }

  // coloured wall-kind lines drawn above the walls (visible from the plan camera)
  buildPlanOverlay() {
    const H = this.wallHeight * CM + 0.02;
    const grp = new THREE.Group();
    grp.name = 'planOverlay';
    for (const w of this.walls) {
      const color = w.kind === 'target' ? 0x2f80ed : w.kind === 'optional' ? (this.optionalEnabled ? 0xf2994a : 0xc9a27a) : 0x9a9a9a;
      for (const g of w.segs) {
        const len = g.len * CM;
        const strip = new THREE.Mesh(
          new THREE.PlaneGeometry(len, (w.kind === 'excluded' ? 0.06 : 0.12)),
          new THREE.MeshBasicMaterial({ color, transparent: w.kind !== 'target', opacity: w.kind === 'optional' && !this.optionalEnabled ? 0.55 : 1 })
        );
        strip.rotation.x = -Math.PI / 2;
        strip.rotation.z = Math.atan2(-g.u[1], g.u[0]);
        const mx = (g.a[0] + g.b[0]) / 2 + g.n[0] * 6, my = (g.a[1] + g.b[1]) / 2 + g.n[1] * 6;
        strip.position.set(mx * CM, H, my * CM);
        grp.add(strip);
      }
    }
    for (const d of this.data.dividers ?? []) {
      const pts = d.points.map(([x, y]) => new THREE.Vector3(x * CM, H, y * CM));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: 0x777777, dashSize: 0.2, gapSize: 0.15 }));
      line.computeLineDistances();
      grp.add(line);
    }
    if (this.planOverlay) this.group.remove(this.planOverlay);
    this.planOverlay = grp;
    grp.visible = this._overlayVisible ?? false;
    this.group.add(grp);
  }
  setOverlayVisible(v) {
    this._overlayVisible = v;
    if (this.planOverlay) this.planOverlay.visible = v;
  }

  setOptionalEnabled(v) {
    this.optionalEnabled = v;
    this.buildPlanOverlay();
  }

  bounds() {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const w of this.walls) for (const [x, y] of w.points) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    return { minX, minY, maxX, maxY };
  }

  // keep a walker at least r cm from every wall segment (simple push-out)
  collide(x, y, r = 25) {
    for (let iter = 0; iter < 3; iter++) {
      for (const w of this.walls) for (const g of w.segs) {
        // wall body spans from the face (offset 0) back to -thickness along n; use its centre line
        const cx = -g.n[0] * w.thickness / 2, cy = -g.n[1] * w.thickness / 2;
        const ax = g.a[0] + cx, ay = g.a[1] + cy;
        let t = (x - ax) * g.u[0] + (y - ay) * g.u[1];
        t = Math.max(0, Math.min(g.len, t));
        const px = ax + g.u[0] * t, py = ay + g.u[1] * t;
        const dx = x - px, dy = y - py, d = Math.hypot(dx, dy);
        const lim = r + w.thickness / 2;
        if (d < lim && d > 1e-6) { x = px + (dx / d) * lim; y = py + (dy / d) * lim; }
      }
    }
    return [x, y];
  }
}

function prepWall(w, defTh) {
  const segs = [];
  let s0 = 0;
  for (let i = 0; i < w.points.length - 1; i++) {
    const a = w.points[i], b = w.points[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    // plan is y-down: 'right' of travel = (-uy, ux)
    const n = w.side === 'left' ? [u[1], -u[0]] : [-u[1], u[0]];
    segs.push({ a, b, len, u, n, s0 });
    s0 += len;
  }
  return { ...w, thickness: w.thickness ?? defTh, segs, length: s0 };
}
