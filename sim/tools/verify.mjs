// End-to-end check of the simulator: `npm run dev` in one terminal, then `npm run verify` (uses your installed Google Chrome).
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const OUT = process.argv[2] || new URL('../docs', import.meta.url).pathname;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pinrose-verify-'));
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) logs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message));
page.on('response', (r) => { if (r.status() >= 400) logs.push('HTTP ' + r.status() + ' ' + r.url()); });
const R = {};
const ok = (name, cond, extra = '') => { R[name] = cond ? 'PASS' : 'FAIL'; console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };
const E = (f, a) => page.evaluate(f, a);
const btn = (text) => page.locator('button', { hasText: text }).first();

await page.goto(process.env.SIM_URL || 'http://127.0.0.1:5178/');
await page.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 30000 });
await page.waitForTimeout(1200);

// 1. 60 units rendered and rotating
const n = await E(() => ({ units: __sim.units.units.length, inst: __sim.units.funnel.count, cover: __sim.units.cover.count }));
ok('60 units instanced', n.units === 60 && n.inst === 60 && n.cover === 60, JSON.stringify(n));
const a0 = await E(() => Array.from(__sim.units.angles.slice(0, 60)));
await page.waitForTimeout(1000);
const a1 = await E(() => Array.from(__sim.units.angles.slice(0, 60)));
const moving = a0.filter((v, i) => Math.abs(a1[i] - v) > 0.05).length;
ok('all 60 funnels rotating', moving === 60, `${moving}/60 changed angle in 1 s`);
const rpmCheck = await E(() => { const u = __sim.units.units[0]; return { rpm: u.rpm, dir: u.dir }; });
const measuredRpm = Math.abs(a1[0] - a0[0]) / (2 * Math.PI) * 60;
console.log('   unit 0 rpm setting', rpmCheck.rpm, 'measured ~', measuredRpm.toFixed(2), '(1 s window, timer jitter)');
const seedSame = await E(() => JSON.stringify(__sim.units.units.slice(0, 3)));
console.log('   first units (seed 1):', seedSame);

// 2. performance: synchronous render cost incl. GPU sync
const benchOn = await E(() => __sim.bench(120));
await E(() => __sim.lighting.setShadows(false));
const benchOff = await E(() => __sim.bench(120));
await E(() => __sim.lighting.setShadows(true));
const gpu = await E(() => { const g = document.querySelector('canvas').getContext('webgl2'); const d = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(d.UNMASKED_RENDERER_WEBGL); });
const calls = await E(() => { __sim.renderer.info.autoReset = true; __sim.renderer.render(__sim.scene, __sim.persp); return { calls: __sim.renderer.info.render.calls, tris: __sim.renderer.info.render.triangles }; });
ok('frame cost < 16 ms (shadows on)', benchOn < 16, `${benchOn.toFixed(2)} ms/frame with 6 shadowed spots, ${benchOff.toFixed(2)} ms without; ${gpu}; ${JSON.stringify(calls)} (main pass)`);
R.bench = { shadowsOn: +benchOn.toFixed(2), shadowsOff: +benchOff.toFixed(2), gpu, ...calls };

await page.screenshot({ path: `${OUT}/01-overview.png` });

// 3. click-select + shift-click in overview (screen position of a unit's body)
const scr = async (i) => E((i) => { const s = __sim; const p = s.units.pickPoint(i).project(s.persp); const r = s.renderer.domElement.getBoundingClientRect(); return [((p.x + 1) / 2) * r.width + r.left, ((1 - p.y) / 2) * r.height + r.top]; }, i);
// move close to the north-east wall so units are big enough to click
await E(() => { const s = __sim; s.persp.position.set(13.6, 1.75, 3.2); s.orbit.target.set(13.6, 1.75, 0); s.orbit.update(); });
await page.waitForTimeout(400);
const visible = await E(() => { const s = __sim; const out = []; const r = s.renderer.domElement.getBoundingClientRect(); s.units.units.forEach((u, i) => { const p = s.units.pickPoint(i).project(s.persp); if (u.wall === 'N-east' && Math.abs(p.x) < 0.8 && Math.abs(p.y) < 0.8 && p.z < 1) out.push(i); }); return out; });
console.log('   units in close view:', visible.length);
let [x, y] = await scr(visible[0]);
await page.mouse.click(x, y);
let sel = await E(() => [...__sim.units.selected]);
ok('click selects one unit', sel.length === 1 && sel[0] === visible[0], JSON.stringify(sel));
[x, y] = await scr(visible[1]);
await page.keyboard.down('Shift'); await page.mouse.click(x, y); await page.keyboard.up('Shift');
sel = await E(() => [...__sim.units.selected]);
ok('shift-click adds', sel.length === 2, JSON.stringify(sel));

// 4. select all on wall N-east, set height, distribute, randomize
await E(() => { const b = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Select all on wall'); const s = b.previousElementSibling; s.value = 'N-east'; });
await btn('Select all on wall').click();
const onWall = await E(() => ({ sel: __sim.units.selected.size, total: __sim.units.units.filter((u) => u.wall === 'N-east').length }));
ok('select all on wall', onWall.sel === onWall.total && onWall.sel > 5, JSON.stringify(onWall));
// set height for all selected via the number box of the Height row
const hRow = page.locator('label.row', { hasText: 'Height' }).first();
await hRow.locator('input[type=number]').fill('180');
await hRow.locator('input[type=number]').press('Enter');
const hs = await E(() => [...__sim.units.selected].map((i) => __sim.units.units[i].h));
ok('set height for all selected', hs.length > 5 && hs.every((v) => v === 180), `${hs.length} units at 180 cm`);
// distribute height 110..250
const dist = page.locator('.row.bulk', { hasText: 'Distribute' });
await dist.locator('select').selectOption('h');
await dist.locator('input').nth(0).fill('110'); await dist.locator('input').nth(1).fill('250');
await dist.locator('button').click();
const hs2 = await E(() => [...__sim.units.selected].map((i) => __sim.units.units[i]).sort((a, b) => a.s - b.s).map((u) => u.h));
ok('distribute heights evenly', hs2[0] === 110 && hs2[hs2.length - 1] === 250, JSON.stringify(hs2));
// distribute along wall (whole wall)
await dist.locator('select').selectOption('s');
await dist.locator('button').click();
const ss = await E(() => [...__sim.units.selected].map((i) => __sim.units.units[i].s).sort((a, b) => a - b));
const gaps = ss.slice(1).map((v, i) => v - ss[i]);
ok('distribute along wall evenly', Math.max(...gaps) - Math.min(...gaps) < 0.5, `gaps ${gaps[0].toFixed(1)} cm`);
// randomize roll -60..60
const rnd = page.locator('.row.bulk', { hasText: 'Randomize' });
await rnd.locator('select').selectOption('rot');
await rnd.locator('input').nth(0).fill('-60'); await rnd.locator('input').nth(1).fill('60');
await rnd.locator('button').click();
const rots = await E(() => [...__sim.units.selected].map((i) => __sim.units.units[i].rot));
ok('randomize roll within range', rots.every((r) => r >= -60 && r <= 60) && new Set(rots).size > 2, JSON.stringify(rots));
// rpm + direction + on/off for the selection
const pRow = page.locator('label.row', { hasText: 'Speed' }).first();
await pRow.locator('input[type=number]').fill('12'); await pRow.locator('input[type=number]').press('Enter');
await page.locator('.props select').nth(1).selectOption('ccw');
const rpmDir = await E(() => [...__sim.units.selected].map((i) => __sim.units.units[i]).every((u) => u.rpm === 12 && u.dir === 'ccw'));
ok('set rpm + direction for selection', rpmDir);
// turn the first selected off, verify it stops
const firstSel = await E(() => Math.min(...__sim.units.selected));
await E((i) => { __sim.units.units[i].on = false; __sim.units.refresh(); }, firstSel);
const s0 = await E((i) => __sim.units.angles[i], firstSel); await page.waitForTimeout(400); const s1 = await E((i) => __sim.units.angles[i], firstSel);
ok('off unit stops rotating', s0 === s1);
await E((i) => { __sim.units.units[i].on = true; __sim.units.refresh(); }, firstSel);
// view for the multi-selection screenshot
await E(() => { const s = __sim; s.persp.position.set(12.4, 1.9, 4.6); s.orbit.target.set(13.9, 1.6, 0); s.orbit.update(); });
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}/03-multiselect-panel.png` });

// 5. plan view + box select + drag
await E(() => document.activeElement?.blur()); await page.keyboard.press('Digit3');
await page.waitForTimeout(500);
await btn('None').click();
// drag a box around the east wall region (plan cm x 1500..1950, y -50..900)
const box = await E(() => { const s = __sim; const r = s.renderer.domElement.getBoundingClientRect(); const P = (x, z) => { const p = new s.THREE.Vector3(x / 100, 3.6, z / 100).project(s.ortho); return [((p.x + 1) / 2) * r.width + r.left, ((1 - p.y) / 2) * r.height + r.top]; }; return [P(1650, -60), P(1960, 860)]; });
await page.mouse.move(box[0][0], box[0][1]); await page.mouse.down();
await page.mouse.move((box[0][0] + box[1][0]) / 2, (box[0][1] + box[1][1]) / 2, { steps: 4 });
await page.mouse.move(box[1][0], box[1][1], { steps: 4 });
await page.screenshot({ path: `${TMP}/plan-boxdrag.png` });
await page.mouse.up();
const boxSel = await E(() => { const s = __sim; const L = [...s.units.selected].map((i) => s.units.units[i]); return { n: L.length, walls: [...new Set(L.map((u) => u.wall))], expectE: s.units.units.filter((u) => u.wall === 'E').length }; });
ok('plan box select', boxSel.n > 0 && boxSel.walls.includes('E'), JSON.stringify(boxSel));
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/04-plan-view.png` });
// drag one marker along the wall in plan
const dragIdx = await E(() => [...__sim.units.selected].find((i) => __sim.units.units[i].wall === 'E'));
const before = await E((i) => ({ ...__sim.units.units[i] }), dragIdx);
const mpos = await E((i) => { const s = __sim; const M = new s.THREE.Matrix4(); s.units.markers.getMatrixAt(i, M); const p = new s.THREE.Vector3().setFromMatrixPosition(M).project(s.ortho); const r = s.renderer.domElement.getBoundingClientRect(); return [((p.x + 1) / 2) * r.width + r.left, ((1 - p.y) / 2) * r.height + r.top]; }, dragIdx);
await page.mouse.move(mpos[0], mpos[1]); await page.mouse.down();
await page.mouse.move(mpos[0], mpos[1] + 25, { steps: 5 }); await page.mouse.up();
const after = await E((i) => ({ ...__sim.units.units[i] }), dragIdx);
ok('drag slides unit along wall', after.wall === before.wall && Math.abs(after.s - before.s) > 10, `${before.wall} s ${before.s.toFixed(0)} -> ${after.s.toFixed(0)} cm`);

// 6. walk mode
await E(() => document.activeElement?.blur()); await page.keyboard.press('Digit2');
await E(() => __sim.setWalkPose(700, 640, -38, 2));
await page.waitForTimeout(600);
// walk forward 1 s with W (no pointer lock needed for keys)
const p0 = await E(() => __sim.persp.position.toArray());
await page.keyboard.down('KeyW'); await page.waitForTimeout(700); await page.keyboard.up('KeyW');
const p1 = await E(() => __sim.persp.position.toArray());
ok('WASD walks at eye height', Math.hypot(p1[0] - p0[0], p1[2] - p0[2]) > 0.3 && Math.abs(p1[1] - 1.6) < 1e-6, `moved ${Math.hypot(p1[0] - p0[0], p1[2] - p0[2]).toFixed(2)} m, eye ${p1[1]} m`);
await btn('None').click();
await E(() => document.activeElement?.blur());
await E(() => __sim.setWalkPose(1150, 720, -38, 4));
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/02-walk-first-person.png` });
// collision: try to walk through the north wall
await E(() => __sim.setWalkPose(1200, 80, 0, 0));
await page.keyboard.down('KeyW'); await page.waitForTimeout(800); await page.keyboard.up('KeyW');
const pc = await E(() => __sim.persp.position.toArray());
ok('walls block walking', pc[2] > 0.2, `z after pushing into N wall: ${pc[2].toFixed(2)} m`);

// 7. layout I/O
await E(() => document.activeElement?.blur()); await page.keyboard.press('Digit1');
await page.locator('summary', { hasText: 'Layout' }).click();
let dl = page.waitForEvent('download'); await btn('Export CSV').click(); let d = await dl;
await d.saveAs(`${TMP}/export.csv`);
const csv = fs.readFileSync(`${TMP}/export.csv`, 'utf8').trim().split('\n');
ok('CSV export', csv.length === 61 && csv[0].startsWith('unit_id,wall_id,wall_label,distance_along_wall_cm,height_cm,orientation_deg,rpm'), `${csv.length - 1} rows; ${csv[1]}`);
dl = page.waitForEvent('download'); await btn('Download JSON').click(); d = await dl;
await d.saveAs(`${TMP}/layout.json`);
const saved = JSON.parse(fs.readFileSync(`${TMP}/layout.json`, 'utf8'));
await page.locator('.row', { hasText: 'Seed' }).locator('input').first().fill('7');
await btn('Generate').click();
const changed = await E(() => JSON.stringify(__sim.units.units[0]));
await page.locator('input[type=file]').setInputFiles(`${TMP}/layout.json`);
await page.waitForTimeout(300);
const restored = await E(() => __sim.units.units);
ok('JSON download -> regenerate -> upload restores', JSON.stringify(restored) === JSON.stringify(saved.units) && changed !== JSON.stringify(saved.units[0]), `${restored.length} units`);
await btn('Save (browser)').click();
await btn('Generate').click();
await btn('Load (browser)').click();
const restored2 = await E(() => __sim.units.units);
ok('localStorage save/load', JSON.stringify(restored2) === JSON.stringify(saved.units));

// 8. lighting + room toggles
await page.locator('summary', { hasText: 'Lighting' }).click();
await page.locator('label.row', { hasText: 'Shadows' }).locator('input').uncheck();
const shOff = await E(() => __sim.renderer.shadowMap.enabled);
await page.locator('label.row', { hasText: 'Shadows' }).locator('input').check();
await page.locator('input[type=color]').first().evaluate((el) => { el.value = '#d8e0e8'; el.dispatchEvent(new Event('input', { bubbles: true })); });
const wc = await E(() => __sim.room.wallMat.color.getHexString());
await E(() => { const s = __sim.lighting.spots[0]; s.p.kelvin = 6000; s.p.intensity = 80; s.p.angle = 30; __sim.lighting.apply(s); });
const sp = await E(() => { const l = __sim.lighting.spots[0].light; return { i: l.intensity, c: l.color.getHexString(), a: +(l.angle * 360 / Math.PI).toFixed(1) }; });
ok('lighting controls', shOff === false && wc === 'd8e0e8' && sp.i === 80 && sp.a === 30, JSON.stringify({ shOff, wc, sp }));
await page.locator('summary', { hasText: 'Room' }).click();
const optBefore = await E(() => __sim.room.mountable(__sim.room.wall('C-corridor')));
await page.locator('label.row', { hasText: 'Corridor walls' }).locator('input').check();
const optAfter = await E(() => __sim.room.mountable(__sim.room.wall('C-corridor')));
await page.locator('label.row', { hasText: 'Corridor walls' }).locator('input').uncheck();
ok('optional corridor walls off by default, toggle works', optBefore === false && optAfter === true);

console.log('\nconsole errors/warnings:', logs.length ? logs : 'none');
R.console = logs;
fs.writeFileSync(`${TMP}/verify-result.json`, JSON.stringify(R, null, 2));
await browser.close();
