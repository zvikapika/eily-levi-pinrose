import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import roomData from '../room.json';
import { Room, CM } from './room.js';
import { Units } from './units.js';
import { Lighting } from './lights.js';
import { Grid } from './grid.js';
import { Partitions } from './partitions.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { generateLayout, layoutToJSON, mulberry32 } from './layout.js';
import { buildUI } from './ui.js';
import './style.css';

const UNIT_GLB = new URL('../assets/unit.glb', import.meta.url).href;
const EYE_HEIGHT_CM = 160;
const WALK_SPEED = 1.4; // m/s

const viewEl = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.type = THREE.PCFShadowMap;
viewEl.append(renderer.domElement);
const labelRenderer = new CSS2DRenderer();
labelRenderer.domElement.className = 'labels';
viewEl.append(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x2b2d31);

const room = new Room(roomData);
scene.add(room.group);
const units = new Units(room);
scene.add(units.group);
const lighting = new Lighting(scene, renderer, room);
const grid = new Grid(room);
scene.add(grid.group);
grid.setLines(grid.defaultLines());
const partitions = new Partitions(room);
scene.add(partitions.group);

const b = room.bounds();
const center = new THREE.Vector3(((b.minX + b.maxX) / 2) * CM, 0, ((b.minY + b.maxY) / 2) * CM);

// ------------------------------------------------------------------ cameras
const persp = new THREE.PerspectiveCamera(60, 1, 0.02, 200);
persp.position.set(9.6, 12.5, 17.0);
const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
ortho.position.set(center.x, 30, center.z);
ortho.up.set(0, 0, -1); // plan north (−y) at the top of the screen, like the drawing
ortho.lookAt(center.x, 0, center.z);
ortho.zoom = 1;

const orbit = new OrbitControls(persp, renderer.domElement);
orbit.target.set(10.3, 0.3, 5.0);
orbit.enableDamping = true;
orbit.maxPolarAngle = Math.PI * 0.495;
orbit.zoomToCursor = true;          // the wheel zooms toward the point under the cursor (Eily: the view must not 'run away')
orbit.screenSpacePanning = true;
orbit.update();
const planCtl = new OrbitControls(ortho, renderer.domElement);
planCtl.target.set(center.x, 0, center.z);
planCtl.enableRotate = false;
planCtl.screenSpacePanning = true;
planCtl.mouseButtons = { LEFT: -1, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
planCtl.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
planCtl.enabled = false;
planCtl.update();
const walk = new PointerLockControls(persp, renderer.domElement);
// front (elevation) view of one wall: orthographic camera facing the wall; the near plane clips everything more than
// WALL_SLAB m in front of the wall, so only that wall, its units and its grid lines show
const WALL_SLAB = 0.7, WALL_CAM_D = 30;
const elev = new THREE.OrthographicCamera(-1, 1, 1, -1, WALL_CAM_D - WALL_SLAB, WALL_CAM_D + 0.4);
const elevCtl = new OrbitControls(elev, renderer.domElement);
elevCtl.enableRotate = false;
elevCtl.screenSpacePanning = true;
elevCtl.mouseButtons = { LEFT: -1, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN };
elevCtl.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
elevCtl.enabled = false;
let walkPose = { pos: new THREE.Vector3(9.3, EYE_HEIGHT_CM * CM, 6.8), yaw: Math.PI * 0.82, pitch: 0 };
let orbitPose = null;

// wall labels (plan view)
const labels = new THREE.Group();
for (const w of room.walls) {
  if (w.kind === 'excluded') continue;
  const g = w.segs[Math.floor(w.segs.length / 2)];
  const div = document.createElement('div');
  div.className = `wall-label ${w.kind}`;
  div.textContent = w.id;
  div.title = room.mountable(w) ? `${w.label} — click to work on this wall from the front` : w.label;
  if (room.mountable(w)) {
    div.style.pointerEvents = 'auto';
    div.style.cursor = 'pointer';
    div.addEventListener('click', (e) => { e.stopPropagation(); viewWall(w.id); });
  }
  const o = new CSS2DObject(div);
  const mx = (g.a[0] + g.b[0]) / 2 + g.n[0] * 55, my = (g.a[1] + g.b[1]) / 2 + g.n[1] * 55;
  o.position.set(mx * CM, room.wallHeight * CM, my * CM);
  labels.add(o);
}
scene.add(labels);
// CSS2DRenderer only checks each label's own .visible, not its parent's
function showLabels() { const v = (app.mode === 'plan' || app.mode === 'overview') && app.labelsOn; labels.children.forEach((o) => (o.visible = v)); }

// ------------------------------------------------------------------ app state
const app = {
  room, units, lighting, grid, partitions, seed: 1, mode: 'overview', labelsOn: true, cutaway: true, unitDots: true,
  draw: { on: false, kind: 'line', start: null, curve: null, step: 5, snapUnits: true }, setDraw, deleteSelectedLine, onLinesChanged: null,
  exportCurve, exportJunctions,
  setAllMotors, editProfiles, exportSTL,
  setUnitDots(v) { app.unitDots = v; units.dots.visible = v && app.mode === 'overview'; },
  setMode, select, editSelected, viewWall, wallList, currentWall: null, setUnits, loadLayout, autosave, toast,
  setCeiling(v) { ceilingUser = v; applyCeiling(); },
  setLabels(v) { app.labelsOn = v; showLabels(); },
  setWallHeight(v) {
    room.setWallHeight(v);
    labels.children.forEach((o) => (o.position.y = v * CM));
    lighting.applyAll();
    lighting.buildFills();
    lighting.applyShadows();
    grid.build();
    partitions.rebuild();
    applyCeiling();
    room.setOverlayVisible(app.mode === 'plan');
    units.refresh();
    ui.refreshSelection();
    autosave();
  },
  setOptionalWalls(v) {
    room.setOptionalEnabled(v);
    room.setOverlayVisible(app.mode === 'plan');
    const stranded = units.units.filter((u) => !room.mountable(room.wall(u.wall))).length;
    if (stranded) toast(`${stranded} unit(s) sit on walls that are now not mountable — move them or re-generate`, true);
    ui.refreshWalls();
    ui.refreshSelection();
    autosave();
  },
  setExcludedVisible(v) { room.wallMeshes.forEach((m) => { if (m.userData.kind === 'excluded') m.visible = v; }); },
  bulkRandomize, bulkDistribute,
};
let ceilingUser = false;
function applyCeiling() { room.setCeilingVisible(ceilingUser || app.mode === 'walk'); }

const ui = buildUI(app);

function setUnits(list) {
  units.selected.clear();
  units.setUnits(list);
  ui.refreshSelection();
  autosave();
}
function loadLayout(d) {
  if (d.room?.wallHeightCm) { app.setWallHeight(d.room.wallHeightCm); ui.wallHeight.set(d.room.wallHeightCm); }
  if (d.room?.optionalWallsEnabled !== undefined) { room.setOptionalEnabled(!!d.room.optionalWallsEnabled); ui.optional.checked = !!d.room.optionalWallsEnabled; ui.refreshWalls(); }
  if (d.seed !== undefined) app.seed = d.seed;
  const bad = d.units.filter((u) => !room.wall(u.wall));
  if (bad.length) throw new Error(`unknown wall id(s): ${[...new Set(bad.map((u) => u.wall))].join(', ')}`);
  lighting.fromJSON(d.lighting);
  ui.renderSpots();
  if (Array.isArray(d.lines)) grid.setLines(d.lines);
  else if (Array.isArray(d.profiles)) grid.setLines(d.profiles);
  if (d.partitions) partitions.fromJSON(d.partitions);
  if (d.led) units.led = { ...units.led, ...d.led };
  if (Array.isArray(d.wallFeatures)) { room.data.wallFeatures = { items: d.wallFeatures }; room.buildFeatures(); }
  // units left on walls that are no longer mountable (e.g. the glass facade) move to the nearest mountable wall
  let moved = 0;
  for (const u of d.units) {
    const w = room.wall(u.wall);
    if (room.mountable(w)) continue;
    const p = room.pointAt(w, u.s);
    const q = room.nearestMountable(p.x, p.y);
    u.wall = q.wall.id; u.s = q.s; moved++;
  }
  if (moved) toast(`${moved} unit(s) were on the glass / non-mountable walls and were moved to the nearest wall`, true);
  ui.refreshAll?.();
  const L = lighting.toJSON();
  ui.lighting.amb.set(L.ambient); ui.lighting.exp.set(L.exposure); ui.lighting.sh.checked = L.shadows;
  ui.lighting.wc.value = L.wallColor; ui.lighting.fc.value = L.floorColor;
  ui.wallTone?.set(room.wallTone);
  setUnits(d.units);
  room.setOverlayVisible(app.mode === 'plan');
}

let saveTimer = 0;
function autosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => localStorage.setItem('pinrose.autosave', layoutToJSON(app)), 400);
}

function select(idx, add = false) {
  if (!add) units.selected.clear();
  for (const i of idx) units.selected.add(i);
  units.refresh();
  ui.refreshSelection();
}
function toggle(i) {
  if (units.selected.has(i)) units.selected.delete(i); else units.selected.add(i);
  units.refresh();
  ui.refreshSelection();
}
function editSelected(fn) {
  for (const i of units.selected) {
    const u = units.units[i];
    fn(u);
    if (!room.mountable(room.wall(u.wall))) {
      // moved onto a non-mountable wall (shouldn't happen from the UI) -> snap back to nearest mountable
      const p = room.pointAt(room.wall(u.wall), u.s);
      const q = room.nearestMountable(p.x, p.y);
      u.wall = q.wall.id; u.s = q.s;
    }
  }
  units.refresh();
  ui.refreshSelection();
  autosave();
}
// selected units sorted along the walls (wall order in room.json, then distance)
function selectedOrdered() {
  const order = new Map(room.walls.map((w, i) => [w.id, i]));
  return [...units.selected].map((i) => units.units[i]).sort((a, b) => (order.get(a.wall) ?? 999) - (order.get(b.wall) ?? 999) || a.s - b.s);
}
function bulkRandomize(k, a, b) {
  if (!units.selected.size) return toast('Select some units first', true);
  const rnd = Math.random;
  editSelected((u) => {
    if (k === 'dir') { u.dir = rnd() < 0.5 ? 'cw' : 'ccw'; return; }
    if (k === 's') { const L = room.wall(u.wall).length; a ??= 0; b ??= L; }
    const lo = a ?? 0, hi = b ?? lo;
    const v = lo + rnd() * (hi - lo);
    u[k] = k === 'rpm' ? Math.round(v * 2) / 2 : Math.round(v);
  });
}
function bulkDistribute(k, a, b) {
  const sel = selectedOrdered();
  if (!sel.length) return toast('Select some units first', true);
  if (k === 's') {
    const byWall = {};
    sel.forEach((u) => (byWall[u.wall] ??= []).push(u));
    for (const [wid, list] of Object.entries(byWall)) {
      const L = room.wall(wid).length;
      const lo = a ?? 0, hi = b ?? L;
      // equal gaps, including half-gaps to the ends when using the whole wall
      list.forEach((u, i) => (u.s = a == null && b == null ? ((i + 0.5) / list.length) * L : list.length === 1 ? (lo + hi) / 2 : lo + (i / (list.length - 1)) * (hi - lo)));
    }
  } else {
    const lo = a ?? 0, hi = b ?? lo;
    sel.forEach((u, i) => { const v = sel.length === 1 ? lo : lo + (i / (sel.length - 1)) * (hi - lo); u[k] = k === 'rpm' ? Math.round(v * 2) / 2 : Math.round(v * 10) / 10; });
  }
  units.refresh();
  ui.refreshSelection();
  autosave();
}

function setAllMotors(on) {
  units.units.forEach((u) => (u.on = on));
  units.refresh(); ui.refreshSelection(); autosave();
}
function editProfiles() {
  grid.buildLines();
  autosave();
  app.onLinesChanged?.();
}
// ---- drawing grid lines on walls / floor
function setDraw(on, kind = app.draw.kind ?? 'line') {
  if (!on && app.draw.curve) finishCurve();
  app.draw.on = on;
  app.draw.kind = kind;
  app.draw.start = null;
  app.draw.curve = null;
  grid.setPreview(null);
  canvas.style.cursor = on ? 'crosshair' : '';
  ui.setDrawState?.(on);
}
function deleteSelectedLine() {
  if (!grid.selected) return toast('Click a line first (with drawing off)', true);
  grid.remove(grid.selected);
  editProfiles();
}
// surface under the cursor: a mountable wall face or the floor -> {surf, uv}
function surfaceHit(x, y) {
  ray.setFromCamera(toNDC(x, y), activeCam());
  const targets = app.mode === 'wall' ? [...room.wallMeshes.filter((m) => m.userData.wallId === app.currentWall), room.floorMesh]
    : [...room.wallMeshes.filter((m) => m.visible && m.material !== room.ghostMat && room.mountable(room.wall(m.userData.wallId))), room.floorMesh];
  const hits = ray.intersectObjects(targets, false).filter((h) => app.mode !== 'wall' || h.distance > WALL_CAM_D - WALL_SLAB);
  if (!hits.length) return null;
  const h = hits[0];
  const surf = h.object === room.floorMesh ? 'FLOOR' : h.object.userData.wallId;
  if (surf !== 'FLOOR') {
    // only the mounting face counts (not the wall's back or top)
    const n = h.object.userData.n;
    if (h.face && Math.abs(h.face.normal.y) > 0.5) return null;
    void n;
  }
  return { surf, uv: grid.toSurf(surf, h.point) };
}
// snapping: unit tips and line ends on the same surface, then the step grid; shift = straight (axis-locked)
function snapUV(surf, uv, from, shift) {
  let [u, v] = uv;
  let snapped = null;
  const near = (p, tol) => Math.hypot(p[0] - u, p[1] - v) < tol;
  if (app.draw.snapUnits) {
    for (let i = 0; i < units.units.length; i++) {
      const un = units.units[i];
      if (un.hidden || un.wall !== surf) continue;
      const t = grid.toSurf(surf, units.tipPoint(i, tmpV));
      if (near(t, 12)) { snapped = t; break; }
    }
  }
  if (!snapped) for (const l of grid.lines) {
    if (l.surf !== surf) continue;
    for (const p of [l.a, l.b]) if (near(p, 8)) { snapped = [...p]; break; }
    if (snapped) break;
  }
  if (snapped) [u, v] = snapped;
  else if (app.draw.step > 0) { const st = app.draw.step; u = Math.round(u / st) * st; v = Math.round(v / st) * st; }
  if (shift && from) { if (Math.abs(u - from[0]) > Math.abs(v - from[1])) v = from[1]; else u = from[0]; }
  return [Math.round(u * 10) / 10, Math.round(v * 10) / 10];
}
// one drawing step: a snapped point on a surface + its world position (and plan x, y, height for 3D use)
function drawPoint(e) {
  const hit = surfaceHit(e.clientX, e.clientY);
  if (!hit) return null;
  const st = app.draw.start;
  const uv = snapUV(hit.surf, hit.uv, st && st.surf === hit.surf ? st.uv : null, e.shiftKey);
  const w = grid.toWorld(hit.surf, uv);
  // snap to the end of a 3D line / curve nearby (those don't belong to a surface)
  for (const l of grid.lines) {
    const pts = l.type === 'curve' ? [l.pts[0], l.pts[l.pts.length - 1]].map((q) => grid.toWorld('AIR', q)) : l.surf === 'AIR' ? [l.a, l.b].map((q) => grid.toWorld('AIR', q)) : [];
    for (const q of pts) if (q.distanceTo(w) < 0.08) return { surf: 'AIR', uv: grid.toSurf('AIR', q), w: q, air: true };
  }
  return { surf: hit.surf, uv, w };
}
const air = (pt) => grid.toSurf('AIR', pt.w).map((v) => Math.round(v * 10) / 10);
function finishCurve() {
  const c = app.draw.curve;
  if (c && c.length >= 2) { grid.lines.push({ id: grid.newId(), type: 'curve', pts: c.map((q) => [...q]) }); editProfiles(); toast('Curve added — select it to export it for printing'); }
  app.draw.curve = null; app.draw.start = null; grid.setPreview(null);
}
function drawClick(e) {
  const pt = drawPoint(e);
  if (!pt) return toast('Click on a wall, the floor or the end of a line', true);
  if (app.draw.kind === 'curve') {
    const c = (app.draw.curve ??= []);
    const q = air(pt);
    if (c.length && Math.hypot(q[0] - c[c.length - 1][0], q[1] - c[c.length - 1][1], q[2] - c[c.length - 1][2]) < 2) return finishCurve(); // same point twice = finish
    c.push(q);
    app.draw.start = pt;
    return;
  }
  const st = app.draw.start;
  if (!st) { app.draw.start = pt; return; }
  if (pt.w.distanceTo(st.w) < 0.02) { app.draw.start = null; grid.setPreview(null); return; } // same point twice = finish
  if (st.surf === pt.surf && !pt.air) grid.lines.push({ id: grid.newId(), surf: pt.surf, a: st.uv, b: pt.uv });
  else grid.lines.push({ id: grid.newId(), surf: 'AIR', a: air(st), b: air(pt) }); // between two surfaces: a 3D line through the space
  app.draw.start = pt; // keep drawing from the end point (polyline); Esc / click the same point to stop
  grid.setPreview(null);
  editProfiles();
}
function drawMove(e) {
  const st = app.draw.start;
  if (!st) return;
  const pt = drawPoint(e);
  if (!pt) { grid.setPreview(null); return; }
  if (app.draw.kind === 'curve') { grid.setPreview({ id: 'preview', type: 'curve', pts: [...app.draw.curve, air(pt)] }); return; }
  grid.setPreview(st.surf === pt.surf && !pt.air ? { id: 'preview', surf: st.surf, a: st.uv, b: pt.uv } : { id: 'preview', surf: 'AIR', a: air(st), b: air(pt) });
}
function pickLine(x, y) {
  ray.setFromCamera(toNDC(x, y), activeCam());
  const hits = ray.intersectObjects(grid.lineMeshes, false).filter((h) => app.mode !== 'wall' || h.distance > WALL_CAM_D - WALL_SLAB);
  return hits.length ? hits[0].object.userData.lineId : null;
}
function saveBlob(name, data, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// a printable curved rail: hollow square channel (outer = profile size), mm, Z up, lying on the bed
function exportCurve(id, wallMm = 2) {
  const l = grid.lines.find((x) => x.id === id && x.type === 'curve');
  if (!l) return toast('Select a curve first', true);
  const g = grid.curveGeometry(l, { mm: true, hollow: true, wallMm });
  g.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2)); // Y up -> Z up
  g.computeBoundingBox();
  const bb = g.boundingBox;
  g.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, -bb.min.z);
  const data = new STLExporter().parse(new THREE.Mesh(g), { binary: true });
  saveBlob(`pinrose-rail-${id}.stl`, data, 'model/stl');
}
// every junction (2+ line ends meeting) with its arm directions: send this file to get exact printable connectors
function exportJunctions() {
  const j = grid.junctions();
  saveBlob('pinrose-junctions.json', JSON.stringify({ format: 'pinrose-junctions', version: 1, profileMm: (grid.pcfg.sizeCm ?? 1.7) * 10, junctions: j }, null, 1), 'application/json');
  toast(`${j.length} junction(s) exported`);
}
function exportSTL() {
  // static snapshot of the whole scene (metres -> mm), for SketchUp (STL import needs a SketchUp subscription)
  const tmp = new THREE.Group();
  scene.updateMatrixWorld(true);
  const add = (mesh, i) => {
    const g = mesh.geometry.clone();
    const m = new THREE.Matrix4();
    if (i !== undefined) { mesh.getMatrixAt(i, m); m.premultiply(mesh.matrixWorld); } else m.copy(mesh.matrixWorld);
    g.applyMatrix4(m);
    // metres, Y up -> millimetres, Z up (SketchUp): (x, y, z) -> (x, -z, y)
    g.applyMatrix4(new THREE.Matrix4().makeScale(1000, 1000, 1000).premultiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)));
    tmp.add(new THREE.Mesh(g));
  };
  scene.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    let p = o; while (p) { if (!p.visible) return; p = p.parent; }
    if (o === units.ledHalo || o === units.ledCore || o === units.dots || o === units.halos || o === units.markers) return;
    if (o.parent?.name === 'planOverlay' || o.name === 'ground') return;
    if (o.isInstancedMesh) { for (let i = 0; i < o.count; i++) if (!units.units[i]?.hidden) add(o, i); }
    else add(o);
  });
  const data = new STLExporter().parse(tmp, { binary: true });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([data], { type: 'model/stl' }));
  a.download = 'pinrose-gallery.stl';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

let toastTimer = 0;
function toast(msg, warn = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'show' + (warn ? ' warn' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ''), 3200);
}

// ------------------------------------------------------------------ modes
function setMode(m) {
  if (app.mode === m) { ui.setMode(m); return; }
  if (app.mode === 'walk') {
    walkPose = { pos: persp.position.clone(), quat: persp.quaternion.clone() };
    walk.unlock();
  }
  if (app.mode === 'overview') orbitPose = { pos: persp.position.clone(), target: orbit.target.clone() };
  app.mode = m;
  orbit.enabled = m === 'overview';
  planCtl.enabled = m === 'plan';
  elevCtl.enabled = m === 'wall';
  if (m === 'wall' && !app.currentWall) app.currentWall = wallList()[0];
  units.setPlanMarkersVisible(m === 'plan');
  units.dots.visible = m === 'overview' && app.unitDots;
  room.setOverlayVisible(m === 'plan');
  showLabels();
  document.getElementById('crosshair').style.display = m === 'walk' ? 'block' : 'none';
  if (m === 'walk') {
    persp.position.copy(walkPose.pos);
    if (walkPose.quat) persp.quaternion.copy(walkPose.quat);
    else persp.rotation.set(walkPose.pitch, walkPose.yaw, 0, 'YXZ');
  } else if (m === 'overview' && orbitPose) {
    persp.position.copy(orbitPose.pos);
    orbit.target.copy(orbitPose.target);
    orbit.update();
  }
  applyCeiling();
  ui.setMode(m);
  onResize();
  if (m === 'wall') viewWall(app.currentWall);
}

// ------------------------------------------------------------------ input
const keys = {};
addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, select, textarea')) return;
  keys[e.code] = true;
  if (app.mode !== 'walk' || !walk.isLocked) {
    if (e.code === 'Digit1') setMode('overview');
    if (e.code === 'Digit2') setMode('walk');
    if (e.code === 'Digit3') setMode('plan');
    if (e.code === 'Digit4') setMode('wall');
    if (app.mode === 'wall' && (e.code === 'BracketRight' || e.code === 'PageDown')) stepWall(1);
    if (app.mode === 'wall' && (e.code === 'BracketLeft' || e.code === 'PageUp')) stepWall(-1);
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyA') { e.preventDefault(); select([...units.units.keys()]); }
    if (e.code === 'KeyL') setDraw(!(app.draw.on && app.draw.kind === 'line'), 'line');
    if (e.code === 'KeyC' && !(e.ctrlKey || e.metaKey)) setDraw(!(app.draw.on && app.draw.kind === 'curve'), 'curve');
    if ((e.code === 'Enter' || e.code === 'NumpadEnter') && app.draw.curve) finishCurve();
    if (e.code === 'Escape' && app.draw.on) { if (app.draw.curve) finishCurve(); else if (app.draw.start) { app.draw.start = null; grid.setPreview(null); } else setDraw(false); }
    if ((e.code === 'Delete' || e.code === 'Backspace') && grid.selected) { e.preventDefault(); deleteSelectedLine(); }
  }
});
addEventListener('keyup', (e) => (keys[e.code] = false));
addEventListener('blur', () => Object.keys(keys).forEach((k) => (keys[k] = false)));

const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const tmpV = new THREE.Vector3();
const activeCam = () => (app.mode === 'plan' ? ortho : app.mode === 'wall' ? elev : persp);
function wallList() { return room.mountableWalls().map((w) => w.id); }
function stepWall(d) {
  const L = wallList(), i = L.indexOf(app.currentWall);
  viewWall(L[(i + d + L.length) % L.length]);
}
// look straight at one wall, framed to fit it
function viewWall(id) {
  const w = room.wall(id);
  if (!w) return;
  app.currentWall = id;
  const g = w.segs[0];
  const mid = room.pointAt(w, w.length / 2);
  const H = room.wallHeight * CM;
  const c = new THREE.Vector3(mid.x * CM, H / 2, mid.y * CM);
  const n = new THREE.Vector3(g.n[0], 0, g.n[1]);
  elev.position.copy(c).addScaledVector(n, WALL_CAM_D);
  elev.up.set(0, 1, 0);
  elev.lookAt(c);
  elevCtl.target.copy(c);
  elev.zoom = 1;
  app._wallFit = { len: w.length * CM + 1.0, h: H + 0.8 };
  if (app.mode !== 'wall') setMode('wall');
  onResize();
  elevCtl.update();
  ui.setWall?.(id);
}
function toNDC(x, y) {
  const r = renderer.domElement.getBoundingClientRect();
  return ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
}
// pick a unit: exact raycast first (3D views), then nearest projected unit within `tol` px
function pick(x, y, tol = 14) {
  const cam = activeCam();
  const r = renderer.domElement.getBoundingClientRect();
  let maxDist = Infinity;
  if (app.mode !== 'plan') {
    ray.setFromCamera(toNDC(x, y), cam);
    const blockers = app.mode === 'wall' ? room.wallMeshes.filter((m) => m.userData.wallId === app.currentWall)
      : room.wallMeshes.filter((m) => m.visible && m.material !== room.ghostMat);
    const hits = ray.intersectObjects([units.cover, units.bracket, units.funnel, ...blockers], false)
      .filter((h) => app.mode !== 'wall' || h.distance > WALL_CAM_D - WALL_SLAB);
    if (hits.length) {
      if (hits[0].object.isInstancedMesh && !units.units[hits[0].instanceId]?.hidden) return hits[0].instanceId;
      maxDist = hits[0].distance + 0.1; // a wall is in front: only units before it are pickable
    }
  }
  let best = -1, bd = tol;
  const camDir = cam.getWorldDirection(new THREE.Vector3());
  const rel = new THREE.Vector3();
  for (let i = 0; i < units.units.length; i++) {
    if (units.units[i].hidden) continue;
    if (app.mode === 'wall' && units.units[i].wall !== app.currentWall) continue;
    let p;
    if (app.mode === 'plan') {
      units.markers.getMatrixAt(i, _mm);
      p = tmpV.setFromMatrixPosition(_mm);
    } else {
      p = units.pickPoint(i, tmpV);
      rel.copy(p).sub(cam.position);
      if (rel.dot(camDir) < 0 || rel.length() > maxDist) continue;
    }
    p.project(cam);
    const sx = ((p.x + 1) / 2) * r.width + r.left, sy = ((1 - p.y) / 2) * r.height + r.top;
    const d = Math.hypot(sx - x, sy - y);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
const _mm = new THREE.Matrix4();

// drag state
let down = null; // {x,y,unit,box,moved}
const boxEl = document.getElementById('box');
const canvas = renderer.domElement;

addEventListener('pointerdown', (e) => {
  if (e.target !== canvas || e.button !== 0) return;
  if (app.mode === 'walk') {
    if (!walk.isLocked) { walk.lock(); return; }
    const r = canvas.getBoundingClientRect();
    const i = pick(r.left + r.width / 2, r.top + r.height / 2, 30);
    if (i >= 0) (e.shiftKey || e.ctrlKey || e.metaKey) ? toggle(i) : select([i]);
    else if (!e.shiftKey) select([]);
    return;
  }
  if (app.draw.on) { down = { x: e.clientX, y: e.clientY, unit: -1, moved: false, draw: true }; return; }
  const i = pick(e.clientX, e.clientY);
  down = { x: e.clientX, y: e.clientY, unit: i, moved: false, add: e.shiftKey || e.ctrlKey || e.metaKey };
  if (i >= 0) {
    orbit.enabled = false; // grabbing a unit: don't orbit
  } else if (app.mode === 'plan') {
    down.box = true;
  }
}, { capture: true });

// double-click in the overview: glide the view centre (the orbit pivot) to the clicked point on a wall / the floor
let glide = null;
canvas.addEventListener('dblclick', (e) => {
  if (app.mode !== 'overview' || app.draw.on) return;
  ray.setFromCamera(toNDC(e.clientX, e.clientY), persp);
  const hits = ray.intersectObjects([...room.wallMeshes.filter((m) => m.visible && m.material !== room.ghostMat), room.floorMesh], false);
  if (!hits.length) return;
  const to = hits[0].point.clone();
  const shift = to.clone().sub(orbit.target);
  glide = { t: 0, from: orbit.target.clone(), camFrom: persp.position.clone(), shift };
});

addEventListener('pointermove', (e) => {
  if (app.draw.on && e.target === canvas) drawMove(e);
  if (!down) return;
  if (down.draw) { if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) down.moved = true; return; }
  const dx = e.clientX - down.x, dy = e.clientY - down.y;
  if (!down.moved && Math.hypot(dx, dy) > 4) {
    down.moved = true;
    if (down.unit >= 0 && !units.selected.has(down.unit)) select([down.unit], down.add);
  }
  if (!down.moved) return;
  if (down.box) {
    const r = canvas.getBoundingClientRect();
    Object.assign(boxEl.style, {
      display: 'block', left: Math.min(e.clientX, down.x) - r.left + 'px', top: Math.min(e.clientY, down.y) - r.top + 'px',
      width: Math.abs(dx) + 'px', height: Math.abs(dy) + 'px',
    });
  } else if (down.unit >= 0) {
    dragUnit(down.unit, e.clientX, e.clientY);
  }
});

addEventListener('pointerup', (e) => {
  if (!down) return;
  const d = down;
  down = null;
  orbit.enabled = app.mode === 'overview';
  if (d.draw) { if (!d.moved) drawClick(e); return; }
  if (d.box && d.moved) {
    boxEl.style.display = 'none';
    const r = canvas.getBoundingClientRect();
    const x0 = Math.min(e.clientX, d.x), x1 = Math.max(e.clientX, d.x), y0 = Math.min(e.clientY, d.y), y1 = Math.max(e.clientY, d.y);
    const hit = [];
    for (let i = 0; i < units.units.length; i++) {
      if (units.units[i].hidden) continue;
      units.markers.getMatrixAt(i, _mm);
      const p = tmpV.setFromMatrixPosition(_mm).project(ortho);
      const sx = ((p.x + 1) / 2) * r.width + r.left, sy = ((1 - p.y) / 2) * r.height + r.top;
      if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1) hit.push(i);
    }
    select(hit, d.add);
    return;
  }
  if (d.moved && d.unit >= 0) { autosave(); ui.refreshSelection(); return; }
  if (d.moved) return; // orbit/pan gesture
  if (d.unit >= 0) { d.add ? toggle(d.unit) : select([d.unit]); if (grid.selected) { grid.select(null); app.onLinesChanged?.(); } return; }
  const lid = pickLine(e.clientX, e.clientY);
  if (lid) { grid.select(lid); app.onLinesChanged?.(); if (!d.add) select([]); return; }
  if (grid.selected) { grid.select(null); app.onLinesChanged?.(); }
  if (!d.add) select([]);
});

// slide a unit along the mountable walls under the cursor
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function dragUnit(i, x, y) {
  const u = units.units[i];
  ray.setFromCamera(toNDC(x, y), activeCam());
  if (app.mode === 'plan') {
    floorPlane.constant = 0;
    const p = ray.ray.intersectPlane(floorPlane, tmpV);
    if (!p) return;
    const px = p.x / CM, py = p.z / CM;
    if (u.wall === 'FLOOR') { u.s = px; u.h = py; }
    else { const q = room.nearestMountable(px, py); if (!q) return; u.wall = q.wall.id; u.s = q.s; }
  } else {
    // free placement on any mountable wall face or on the floor
    const hit = surfaceHit(x, y);
    if (!hit) return;
    u.wall = hit.surf; u.s = hit.uv[0]; u.h = hit.uv[1];
  }
  units.refresh();
  ui.refreshSelection();
}

// ------------------------------------------------------------------ loop
function onResize() {
  const w = viewEl.clientWidth, hgt = viewEl.clientHeight;
  renderer.setSize(w, hgt);
  labelRenderer.setSize(w, hgt);
  persp.aspect = w / hgt;
  persp.updateProjectionMatrix();
  // ortho frustum sized to fit the room (metres), keep aspect
  const rw = (b.maxX - b.minX) * CM + 3, rh = (b.maxY - b.minY) * CM + 3;
  const half = Math.max(rw / 2, (rh / 2) * (w / hgt));
  ortho.left = -half; ortho.right = half; ortho.top = half * (hgt / w); ortho.bottom = -half * (hgt / w);
  ortho.updateProjectionMatrix();
  if (app._wallFit) {
    const { len, h } = app._wallFit;
    const hw = Math.max(len / 2, (h / 2) * (w / hgt));
    elev.left = -hw; elev.right = hw; elev.top = hw * (hgt / w); elev.bottom = -hw * (hgt / w);
    elev.updateProjectionMatrix();
  }
}
addEventListener('resize', onResize);

const fpsEl = document.getElementById('fps');
let last = performance.now(), acc = 0, frames = 0;
const fwd = new THREE.Vector3(), side = new THREE.Vector3();
function tick(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (app.mode === 'walk') {
    const sp = WALK_SPEED * (keys.ShiftLeft || keys.ShiftRight ? 2.5 : 1) * dt;
    persp.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    side.crossVectors(fwd, persp.up).normalize();
    const mv = new THREE.Vector3();
    if (keys.KeyW || keys.ArrowUp) mv.add(fwd);
    if (keys.KeyS || keys.ArrowDown) mv.sub(fwd);
    if (keys.KeyD || keys.ArrowRight) mv.add(side);
    if (keys.KeyA || keys.ArrowLeft) mv.sub(side);
    if (mv.lengthSq()) {
      mv.normalize().multiplyScalar(sp);
      const [nx, ny] = room.collide((persp.position.x + mv.x) / CM, (persp.position.z + mv.z) / CM, 30);
      persp.position.set(nx * CM, EYE_HEIGHT_CM * CM, ny * CM);
    }
  } else if (app.mode === 'overview') {
    // WASD / arrows: slide the view sideways / forward (on the floor plane), Q / E: down / up - the view keeps its angle
    const sp = 3.0 * (keys.ShiftLeft || keys.ShiftRight ? 3 : 1) * dt;
    persp.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    side.crossVectors(fwd, persp.up).normalize();
    const mv = new THREE.Vector3();
    if (keys.KeyW || keys.ArrowUp) mv.add(fwd);
    if (keys.KeyS || keys.ArrowDown) mv.sub(fwd);
    if (keys.KeyD || keys.ArrowRight) mv.add(side);
    if (keys.KeyA || keys.ArrowLeft) mv.sub(side);
    if (keys.KeyE) mv.y += 1;
    if (keys.KeyQ) mv.y -= 1;
    if (mv.lengthSq() && !(keys.ControlLeft || keys.MetaLeft)) { mv.normalize().multiplyScalar(sp); persp.position.add(mv); orbit.target.add(mv); }
    if (glide) {
      glide.t = Math.min(1, glide.t + dt / 0.45);
      const k = glide.t * glide.t * (3 - 2 * glide.t);
      orbit.target.copy(glide.from).addScaledVector(glide.shift, k);
      persp.position.copy(glide.camFrom).addScaledVector(glide.shift, k);
      if (glide.t >= 1) glide = null;
    }
    orbit.update();
  }
  else if (app.mode === 'wall') elevCtl.update();
  else planCtl.update();
  units.animate(dt);
  partitions.update(dt);
  room.cutaway(persp.position, app.mode === 'overview' && app.cutaway);
  const cam = activeCam();
  renderer.render(scene, cam);
  labelRenderer.render(scene, cam);
  frames++; acc += dt;
  if (acc > 0.5) { app.fps = frames / acc; fpsEl.textContent = `${app.fps.toFixed(0)} fps · ${units.units.length} units`; frames = 0; acc = 0; }
  requestAnimationFrame(tick);
}

// ------------------------------------------------------------------ boot
(async () => {
  try {
    await units.load(UNIT_GLB);
  } catch (err) {
    toast('Failed to load unit model: ' + err.message, true);
    throw err;
  }
  setUnits(generateLayout(room, { seed: app.seed }));
  ui.setMode('overview');
  units.dots.visible = app.unitDots;
  showLabels();
  onResize();
  requestAnimationFrame(tick);
  document.body.classList.add('ready');
})();

// test / console hooks
window.__sim = { app, grid, partitions, elev, viewWall, surfaceHit, snapUV, THREE, scene, persp, ortho, orbit, walk, units, room, lighting, setMode, select, mulberry32, renderer,
  // benchmark helper: n synchronous animate+render passes, returns ms per frame (includes GPU via readPixels sync)
  bench(n = 60) {
    const gl = renderer.getContext(), px = new Uint8Array(4);
    const t0 = performance.now();
    for (let i = 0; i < n; i++) { units.animate(1 / 60); renderer.render(scene, activeCam()); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }
    return (performance.now() - t0) / n;
  },
  setWalkPose(xcm, ycm, yawDeg, pitchDeg = 0) {
    persp.position.set(xcm * CM, EYE_HEIGHT_CM * CM, ycm * CM);
    persp.rotation.set(THREE.MathUtils.degToRad(pitchDeg), THREE.MathUtils.degToRad(yawDeg), 0, 'YXZ');
  },
};
