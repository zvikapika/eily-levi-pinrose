// Scene lighting: ambient + a few ceiling track spots with colour temperature.
import * as THREE from 'three';
import { CM } from './room.js';
import { zoneOf } from './grid.js';

// Tanner Helland's blackbody approximation, 1000-40000 K -> linear-ish sRGB colour
export function kelvinToColor(k) {
  const t = k / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.4708025861 * Math.log(t) - 161.1195681661; }
  else { r = 329.698727446 * Math.pow(t - 60, -0.1332047592); g = 288.1221695283 * Math.pow(t - 60, -0.0755148492); }
  if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const c = (v) => Math.max(0, Math.min(255, v)) / 255;
  return new THREE.Color().setRGB(c(r), c(g), c(b), THREE.SRGBColorSpace);
}

// default track spots (plan cm; aim point on the floor/wall, cm)
const S = { aimH: 170, intensity: 35, kelvin: 3500, angle: 60, penumbra: 0.7 };
export const DEFAULT_SPOTS = [
  { on: true, x: 430, y: 430, aimX: 60, aimY: 330, ...S },
  { on: true, x: 560, y: 320, aimX: 560, aimY: 0, ...S },
  { on: true, x: 1300, y: 330, aimX: 1300, aimY: 0, ...S },
  { on: true, x: 1550, y: 430, aimX: 1854, aimY: 420, ...S },
  { on: true, x: 1550, y: 680, aimX: 1620, aimY: 930, ...S, aimH: 150, intensity: 25 },
  { on: true, x: 330, y: 560, aimX: 330, aimY: 860, ...S, aimH: 150, intensity: 25 },
];

export class Lighting {
  constructor(scene, renderer, room) {
    this.scene = scene;
    this.renderer = renderer;
    this.room = room;
    this.ambient = new THREE.AmbientLight(0xffffff, 0.8);
    this.hemi = new THREE.HemisphereLight(0xfff6ea, 0x6b6660, 0.48);
    scene.add(this.ambient, this.hemi);
    this.shadows = true;
    this.exposure = 1.0;
    this.spots = [];
    // two separate lighting systems (inner / outer space): master switch, dimmer, optional common colour temperature
    this.zones = { inner: { on: true, dim: 1, kelvin: 0 }, outer: { on: true, dim: 1, kelvin: 0 } };
    this.fixtureGeo = new THREE.CylinderGeometry(0.04, 0.05, 0.14, 16);
    this.fixtureMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4, metalness: 0.6 });
    this.setSpots(DEFAULT_SPOTS);
  }

  setSpots(list) {
    for (const s of this.spots) { this.scene.remove(s.light, s.light.target, s.fixture); s.light.dispose(); }
    this.spots = list.map((p) => {
      const light = new THREE.SpotLight(0xffffff, 1, 0, 0.6, 0.5, 2);
      light.castShadow = true;
      light.shadow.mapSize.set(1024, 1024);
      light.shadow.camera.near = 0.2;
      light.shadow.camera.far = 30;
      light.shadow.bias = -0.0004;
      light.shadow.normalBias = 0.01;
      const fixture = new THREE.Mesh(this.fixtureGeo, this.fixtureMat);
      this.scene.add(light, light.target, fixture);
      const s = { p: { ...p }, light, fixture };
      this.apply(s);
      return s;
    });
    this.applyShadows();
  }

  apply(s) {
    const p = s.p, H = this.room.wallHeight - 20;
    p.zone = zoneOf(this.room, p.x, p.y);
    const z = this.zones[p.zone] ?? { on: true, dim: 1, kelvin: 0 };
    s.light.visible = p.on && z.on;
    s.light.position.set(p.x * CM, H * CM, p.y * CM);
    s.light.target.position.set(p.aimX * CM, p.aimH * CM, p.aimY * CM);
    s.light.intensity = p.intensity * z.dim;
    s.light.color.copy(kelvinToColor(z.kelvin > 0 ? z.kelvin : p.kelvin));
    s.light.angle = THREE.MathUtils.degToRad(p.angle / 2); // UI angle = full beam angle
    s.light.penumbra = p.penumbra;
    s.fixture.position.copy(s.light.position);
    s.fixture.lookAt(s.light.target.position);
    s.fixture.rotateX(Math.PI / 2);
    s.fixture.visible = true;
  }
  applyAll() { this.spots.forEach((s) => this.apply(s)); }
  setZone(id, patch) { Object.assign(this.zones[id], patch); this.applyAll(); }
  addSpot(zone) {
    const c = zone === 'inner' ? { x: 430, y: 430, aimX: 430, aimY: 0 } : { x: 1350, y: 430, aimX: 1350, aimY: 0 };
    this.setSpots([...this.spots.map((s) => s.p), { on: true, ...c, aimH: 170, intensity: 35, kelvin: 3500, angle: 60, penumbra: 0.7 }]);
  }
  removeSpot(i) { this.setSpots(this.spots.filter((_, k) => k !== i).map((s) => s.p)); }

  setAmbient(v) { this.ambient.intensity = v; this.hemi.intensity = v * 0.6; }
  setExposure(v) { this.exposure = v; this.renderer.toneMappingExposure = v; }

  applyShadows() {
    this.renderer.shadowMap.enabled = this.shadows;
    for (const s of this.spots) s.light.castShadow = this.shadows;
    this.scene.traverse((o) => { if (o.material) [].concat(o.material).forEach((m) => (m.needsUpdate = true)); });
  }
  setShadows(v) { this.shadows = v; this.applyShadows(); }

  toJSON() {
    return {
      ambient: this.ambient.intensity,
      exposure: this.exposure,
      shadows: this.shadows,
      wallColor: '#' + this.room.wallMat.color.getHexString(),
      floorColor: '#' + this.room.floorMat.color.getHexString(),
      spots: this.spots.map((s) => ({ ...s.p })),
      zones: JSON.parse(JSON.stringify(this.zones)),
    };
  }
  fromJSON(d) {
    if (!d) return;
    if (d.ambient !== undefined) this.setAmbient(d.ambient);
    if (d.exposure !== undefined) this.setExposure(d.exposure);
    if (d.wallColor) { this.room.wallMat.color.set(d.wallColor); this.room.excludedMat.color.set(d.wallColor).multiplyScalar(0.94); }
    if (d.floorColor) this.room.floorMat.color.set(d.floorColor);
    if (d.zones) for (const k of Object.keys(this.zones)) Object.assign(this.zones[k], d.zones[k] ?? {});
    if (Array.isArray(d.spots)) this.setSpots(d.spots);
    if (d.shadows !== undefined) this.setShadows(d.shadows);
  }
}
