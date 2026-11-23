// The 60 wall units: shared geometry, instanced meshes, per-frame funnel animation.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CM } from './room.js';
import { zoneOf } from './grid.js';

export const UNIT_PARAMS = {
  // funnel pivot on the unit axis, metres from the wall plane; overwritten on load from the ring's back face (43.5 mm in v1)
  pivotZ: 0.0435,
  // crank throw seen as a tilt of the funnel axis (deg) - assumption, not measured
  wobbleDeg: 7,
  // funnel bend (mm at the lip) so the rotation is visible - assumption
  bendMm: 3,
  // clearances used to keep units on the wall (cm)
  edgeMarginCm: 15,
  // gap between wall surface and the unit's back (mm), avoids z-fighting
  wallGapMm: 1.5,
};

const COLORS = {
  normal: new THREE.Color(0xf6f4ef),
  selected: new THREE.Color(0xff8a3d),
  off: new THREE.Color(0xf6f4ef), // units stay white when their motor is off (Eily); the locator dots show on/off
  markerNormal: new THREE.Color(0x1f6fd1),
  markerSelected: new THREE.Color(0xff6a00),
  markerOff: new THREE.Color(0x888888),
};

// Procedural soft "Penrose drain" funnel: a short rounded bell with a drain hole, revolved about Z.
function makeFunnelGeometry() {
  // [radius mm, z mm] relative to the pivot; the cover's outer face is at +6.5 mm
  const prof = [
    [16.5, -1], [18.2, 1.5], [19.0, 6], [19.3, 11], [19.1, 16], [18.2, 21], [16.4, 25.2],
    [13.8, 28.2], [10.8, 29.6], [8.2, 29.3], [6.6, 27.6], [5.7, 24.5], [5.0, 20.5], [4.4, 15],
  ];
  const pts = prof.map(([r, z]) => new THREE.Vector2(r / 1000, z / 1000));
  const g = new THREE.LatheGeometry(pts, 40);
  g.rotateX(Math.PI / 2); // lathe axis Y -> Z (out of the wall)
  // bend toward +X proportionally to z^2 so spinning shows as a nodding / orbiting tip
  const p = g.attributes.position;
  const zmax = 0.03, k = UNIT_PARAMS.bendMm / 1000 / (zmax * zmax);
  for (let i = 0; i < p.count; i++) {
    const z = Math.max(0, p.getZ(i));
    p.setX(i, p.getX(i) + k * z * z);
  }
  g.computeVertexNormals();
  // two darker seams so the rotation reads even from across the room
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const a = Math.atan2(p.getY(i), p.getX(i));
    const seam = Math.abs(Math.sin(a)) > 0.93 ? 0.62 : 1;
    col.set([seam, seam, seam], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export class Units {
  constructor(room, capacity = 240) {
    this.room = room;
    this.capacity = capacity;
    this.group = new THREE.Group();
    this.group.name = 'units';
    this.units = [];
    this.selected = new Set();
    this.baseMatrices = [];
    this.angles = new Float32Array(capacity);
    this.time = 0;
    this._m = new THREE.Matrix4();
    this._m2 = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this.led = { on: false, colour: '#ffd9a0', intensity: 0.8, zone: 'inner' };
  }

  async load(url) {
    const gltf = await new GLTFLoader().loadAsync(url);
    gltf.scene.updateMatrixWorld(true);
    const geos = {};
    gltf.scene.traverse((o) => {
      if (o.isMesh) {
        const g = o.geometry.clone();
        g.applyMatrix4(o.matrixWorld);
        // node may be named after the mesh or the node; normalise
        const key = ['bracket', 'cover', 'ring'].find((k) => o.name.includes(k) || o.parent?.name?.includes(k));
        geos[key ?? o.name] = g;
      }
    });
    for (const k of ['bracket', 'cover', 'ring']) if (!geos[k]) throw new Error(`unit.glb is missing node "${k}"`);
    // funnel pivot = back face of the clamp ring (so a v2 GLB with a moved ring needs no code change)
    geos.ring.computeBoundingBox();
    UNIT_PARAMS.pivotZ = geos.ring.boundingBox.min.z;
    this.geos = { ...geos, funnel: makeFunnelGeometry() };

    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0 });
    const tan = new THREE.MeshStandardMaterial({ color: 0xead6aa, roughness: 0.7, side: THREE.DoubleSide, vertexColors: true });
    const ringMat = new THREE.MeshStandardMaterial({ color: 0xf0ede6, roughness: 0.5 });
    const mk = (geo, mat, name) => {
      const m = new THREE.InstancedMesh(geo, mat, this.capacity);
      m.name = name;
      m.count = 0;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(m);
      return m;
    };
    this.bracket = mk(this.geos.bracket, white, 'bracket');
    this.cover = mk(this.geos.cover, white.clone(), 'cover');
    this.ring = mk(this.geos.ring, ringMat, 'ring');
    this.funnel = mk(this.geos.funnel, tan, 'funnel');
    for (let i = 0; i < this.capacity; i++) this.cover.setColorAt(i, COLORS.normal);

    // plan-view markers (discs above the wall tops) and selection halos (rings on the wall)
    const disc = new THREE.CircleGeometry(0.11, 20).rotateX(-Math.PI / 2);
    this.markers = new THREE.InstancedMesh(disc, new THREE.MeshBasicMaterial({ color: 0xffffff }), this.capacity);
    this.markers.count = 0;
    this.markers.frustumCulled = false;
    this.markers.visible = false;
    for (let i = 0; i < this.capacity; i++) this.markers.setColorAt(i, COLORS.markerNormal);
    this.group.add(this.markers);
    const halo = new THREE.RingGeometry(0.115, 0.135, 40);
    this.halos = new THREE.InstancedMesh(halo, new THREE.MeshBasicMaterial({ color: 0xff6a00, side: THREE.DoubleSide, depthTest: true }), this.capacity);
    this.halos.count = 0;
    this.halos.frustumCulled = false;
    this.group.add(this.halos);
    // overview "locator" dots on the wall behind each unit (units are tiny from across the room)
    this.dots = new THREE.InstancedMesh(new THREE.CircleGeometry(0.11, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }), this.capacity);
    this.dots.count = 0;
    this.dots.frustumCulled = false;
    this.dots.visible = false;
    for (let i = 0; i < this.capacity; i++) this.dots.setColorAt(i, COLORS.markerNormal);
    this.group.add(this.dots);
    // LED inside the unit (inner space only): bright core in the funnel + soft additive halo on the wall
    const core = new THREE.CircleGeometry(0.012, 20).translate(0, 0, UNIT_PARAMS.pivotZ + 0.026);
    this.ledCore = new THREE.InstancedMesh(core, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), this.capacity);
    this.ledHalo = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.6, 0.6).translate(0, 0, 0.003),
      new THREE.MeshBasicMaterial({ map: haloTexture(), color: 0xffffff, toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), this.capacity);
    for (const m of [this.ledCore, this.ledHalo]) { m.count = 0; m.frustumCulled = false; this.group.add(m); for (let i = 0; i < this.capacity; i++) m.setColorAt(i, new THREE.Color(0)); }
  }

  setLed(p) { Object.assign(this.led, p); this.refresh(); }

  setUnits(units) {
    this.units = units;
    this.selected = new Set([...this.selected].filter((i) => i < units.length));
    this.refresh();
  }

  clampUnit(u) {
    const w = this.room.wall(u.wall);
    if (!w) return;
    u.rot = ((((u.rot + 180) % 360) + 360) % 360) - 180;
    u.rpm = Math.max(0, u.rpm);
    if (w.kind === 'floor') {
      // keep floor units inside the gallery floor polygon (fall back: leave as is if outside)
      const b = this.room.bounds();
      u.s = Math.max(b.minX + 10, Math.min(b.maxX - 10, u.s));
      u.h = Math.max(b.minY + 10, Math.min(b.maxY - 10, u.h));
      return;
    }
    const m = UNIT_PARAMS.edgeMarginCm;
    u.s = Math.max(Math.min(m, w.length / 2), Math.min(Math.max(w.length - m, w.length / 2), u.s));
    u.h = Math.max(m, Math.min(this.room.wallHeight - m, u.h));
  }

  // world pose of a unit's frame (origin = funnel axis on the wall face)
  unitMatrix(u, out = new THREE.Matrix4()) {
    const gap0 = UNIT_PARAMS.wallGapMm / 1000;
    if (u.wall === 'FLOOR') {
      // lying on the floor, funnel up; roll 0 = tip toward plan north
      const base = new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0));
      out.multiplyMatrices(base, new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(u.rot)));
      out.setPosition(u.s * CM, gap0, u.h * CM);
      return out;
    }
    const w = this.room.wall(u.wall);
    const p = this.room.pointAt(w, u.s);
    const Z = new THREE.Vector3(p.n[0], 0, p.n[1]);
    const Y = new THREE.Vector3(0, 1, 0);
    const X = new THREE.Vector3().crossVectors(Y, Z);
    const base = new THREE.Matrix4().makeBasis(X, Y, Z);
    const roll = new THREE.Matrix4().makeRotationZ(THREE.MathUtils.degToRad(u.rot));
    out.multiplyMatrices(base, roll);
    const gap = UNIT_PARAMS.wallGapMm / 1000;
    out.setPosition(p.x * CM + Z.x * gap, u.h * CM, p.y * CM + Z.z * gap);
    return out;
  }

  worldPosition(i, out = new THREE.Vector3()) {
    return out.setFromMatrixPosition(this.baseMatrices[i] ?? this._m.identity());
  }
  // centre of the funnel tip in world space (for screen-space picking)
  pickPoint(i, out = new THREE.Vector3()) {
    return out.set(0, 0.05, 0.06).applyMatrix4(this.baseMatrices[i]);
  }
  // world position of the teardrop tip (wire exit), used to snap grid lines onto units
  tipPoint(i, out = new THREE.Vector3()) {
    return out.set(0, 0.134, 0.01).applyMatrix4(this.baseMatrices[i]);
  }

  refresh() {
    const n = this.units.length;
    for (const mesh of [this.bracket, this.cover, this.ring, this.funnel, this.markers, this.dots, this.ledCore, this.ledHalo]) mesh.count = n;
    const H = this.room.wallHeight * CM + 0.04;
    for (let i = 0; i < n; i++) {
      const u = this.units[i];
      this.clampUnit(u);
      const m = (this.baseMatrices[i] = this.unitMatrix(u, this.baseMatrices[i] ?? new THREE.Matrix4()));
      const pz = this.room.unitPlan(u);
      u.zone = zoneOf(this.room, pz.x, pz.y);
      if (u.hidden) m.multiply(this._zero ??= new THREE.Matrix4().makeScale(1e-6, 1e-6, 1e-6));
      const glow = this.led.on && !u.hidden && u.zone === this.led.zone;
      const lc = glow ? new THREE.Color(this.led.colour).multiplyScalar(this.led.intensity) : new THREE.Color(0);
      this.ledCore.setMatrixAt(i, m); this.ledCore.setColorAt(i, glow ? lc.clone().multiplyScalar(2.5) : lc);
      this.ledHalo.setMatrixAt(i, m); this.ledHalo.setColorAt(i, lc);
      this.bracket.setMatrixAt(i, m);
      this.cover.setMatrixAt(i, m);
      const sel = this.selected.has(i);
      this.cover.setColorAt(i, sel ? COLORS.selected : u.on ? COLORS.normal : COLORS.off);
      const p = this.room.unitPlan(u);
      this._m2.makeTranslation((p.x + p.n[0] * 14) * CM, H, (p.y + p.n[1] * 14) * CM);
      if (u.hidden) this._m2.multiply(this._zero);
      this.markers.setMatrixAt(i, this._m2);
      this.markers.setColorAt(i, sel ? COLORS.markerSelected : u.on ? COLORS.markerNormal : COLORS.markerOff);
      this._m2.copy(m).multiply(this._dotOffset ??= new THREE.Matrix4().makeTranslation(0, 0.05, 0.0008));
      this.dots.setMatrixAt(i, this._m2);
      this.dots.setColorAt(i, sel ? COLORS.markerSelected : u.on ? COLORS.markerNormal : COLORS.markerOff);
    }
    // halos for the selection
    let k = 0;
    for (const i of this.selected) {
      if (i >= n || this.units[i].hidden) continue;
      this._m2.copy(this.baseMatrices[i]);
      this._m2.multiply(new THREE.Matrix4().makeTranslation(0, 0.05, 0.002));
      this._m2.multiply(new THREE.Matrix4().makeScale(1.0, 1.0, 1));
      this.halos.setMatrixAt(k++, this._m2);
    }
    this.halos.count = k;
    for (const mesh of [this.bracket, this.cover, this.markers, this.halos, this.dots, this.ledCore, this.ledHalo]) {
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    this.animate(0);
    for (const mesh of [this.bracket, this.cover, this.ring, this.funnel, this.markers]) mesh.computeBoundingSphere();
  }

  animate(dt) {
    const n = this.units.length;
    const wob = new THREE.Matrix4().makeRotationX(THREE.MathUtils.degToRad(UNIT_PARAMS.wobbleDeg));
    const piv = new THREE.Matrix4().makeTranslation(0, 0, UNIT_PARAMS.pivotZ);
    const spin = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      const u = this.units[i];
      if (u.on && u.rpm > 0) this.angles[i] += (u.dir === 'cw' ? -1 : 1) * (u.rpm / 60) * Math.PI * 2 * dt;
      spin.makeRotationZ(this.angles[i]);
      // funnel spins with the crank about the cup axis; its own axis is tilted by the crank throw
      // ring geometry is already in the unit frame (on the cup axis): spin it in place
      this._m.copy(this.baseMatrices[i]).multiply(spin);
      this.ring.setMatrixAt(i, this._m);
      this._m.copy(this.baseMatrices[i]).multiply(piv).multiply(spin).multiply(wob);
      this.funnel.setMatrixAt(i, this._m);
    }
    this.ring.instanceMatrix.needsUpdate = true;
    this.funnel.instanceMatrix.needsUpdate = true;
    this.time += dt;
  }

  setPlanMarkersVisible(v) {
    this.markers.visible = v;
  }
}

function haloTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)');
  gr.addColorStop(0.12, 'rgba(255,255,255,0.5)');
  gr.addColorStop(0.4, 'rgba(255,255,255,0.12)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
