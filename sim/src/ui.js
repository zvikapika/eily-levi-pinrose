// Side panel: view, selection + unit properties + bulk ops, room, lighting, layout I/O.
import { generateLayout, layoutToJSON, parseLayout, layoutToCSV, download, GEN_DEFAULTS } from './layout.js';

const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'class') e.className = v;
    else if (k in e && typeof v !== 'string') e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
};

function section(title, open = true) {
  const body = h('div', { class: 'sec-body' });
  const d = h('details', { class: 'sec' }, h('summary', {}, title), body);
  d.open = open;
  return { el: d, body };
}

// slider + number box pair; onChange(value)
function numRow(label, { min, max, step = 1, value, onChange, unit = '' }) {
  const range = h('input', { type: 'range', min, max, step });
  const num = h('input', { type: 'number', min, max, step, class: 'num' });
  const row = h('label', { class: 'row' }, h('span', { class: 'lbl' }, label), range, num, unit ? h('span', { class: 'unit' }, unit) : null);
  const set = (v, mixed = false) => {
    range.value = v;
    num.value = mixed ? '' : v;
    num.placeholder = mixed ? 'mixed' : '';
  };
  range.addEventListener('input', () => { num.value = range.value; num.placeholder = ''; onChange(+range.value); });
  num.addEventListener('change', () => { if (num.value !== '') { range.value = num.value; onChange(+num.value); } });
  set(value ?? min);
  return { row, range, num, set, setRange(mn, mx) { range.min = num.min = mn; range.max = num.max = mx; } };
}

export function buildUI(app) {
  const { room, units, lighting } = app;
  const panel = document.getElementById('panel');
  panel.innerHTML = '';
  const ui = {};

  // ---------------------------------------------------------------- view
  {
    const s = section('View');
    const btns = {};
    const bar = h('div', { class: 'seg' },
      ...['overview', 'walk', 'plan', 'wall'].map((m) => (btns[m] = h('button', { onclick: () => app.setMode(m), title: `key ${['overview', 'walk', 'plan', 'wall'].indexOf(m) + 1}` }, { overview: 'All (overview)', walk: 'Walk', plan: 'Plan', wall: 'One wall' }[m]))));
    const wallPick = h('select', { onchange: () => app.viewWall(wallPick.value) });
    for (const id of app.wallList()) { const w = room.wall(id); wallPick.append(h('option', { value: id }, `${id} — ${w.label} (${Math.round(w.length)} cm)`)); }
    const wallRow = h('div', { class: 'row' },
      h('button', { onclick: () => { const L = app.wallList(); app.viewWall(L[(L.indexOf(app.currentWall ?? L[0]) - 1 + L.length) % L.length]); }, title: 'previous wall ( [ )' }, '◀'),
      wallPick,
      h('button', { onclick: () => { const L = app.wallList(); app.viewWall(L[(L.indexOf(app.currentWall ?? L[L.length - 1]) + 1) % L.length]); }, title: 'next wall ( ] )' }, '▶'));
    ui.setWall = (id) => { wallPick.value = id; };
    const help = h('div', { class: 'help' });
    ui.setMode = (m) => {
      for (const [k, b] of Object.entries(btns)) b.classList.toggle('on', k === m);
      help.innerHTML = {
        overview: 'Drag: orbit · right-drag: pan · wheel: zoom · click a unit: select (shift/ctrl: add) · drag a unit: slide it along the walls',
        walk: 'Click the view to look around (pointer lock) · WASD/arrows: walk · shift: faster · click: select the unit under the cross · Esc: release mouse',
        plan: 'Drag on empty floor: box select (shift: add) · click/shift-click a dot: select · drag a dot: slide along walls · right-drag: pan · wheel: zoom',
        wall: 'Front view of one wall: drag units on it · draw lines (L) · right-drag: pan · wheel: zoom · ◀ ▶ or [ ] = next wall · 1 = see everything again · tip: double-click a wall in the overview to open it here',
      }[m];
    };
    const ceil = h('input', { type: 'checkbox', onchange: (e) => app.setCeiling(e.target.checked) });
    ui.ceiling = ceil;
    s.body.append(bar, wallRow, help,
      h('label', { class: 'row chk' }, ceil, ' Ceiling (auto in walk mode)'),
      h('label', { class: 'row chk' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => (app.cutaway = e.target.checked) }), ' Cutaway: see through walls facing away (overview)'),
      h('label', { class: 'row chk' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => app.setUnitDots(e.target.checked) }), ' Locator dots behind units (overview)'),
      h('label', { class: 'row chk' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => app.setLabels(e.target.checked) }), ' Wall labels in plan view'),
    );
    panel.append(s.el);
  }

  // ---------------------------------------------------------------- inner space quick controls
  {
    const s = section('Inner space — LEDs & darkness');
    const L = units.led;
    const ledOn = h('input', { type: 'checkbox', checked: L.on, onchange: (e) => { units.setLed({ on: e.target.checked }); app.autosave(); } });
    const dark = h('input', { type: 'checkbox', checked: !!lighting.dark, onchange: (e) => { lighting.setDark(e.target.checked); app.autosave(); } });
    s.body.append(
      h('label', { class: 'row chk big' }, ledOn, ' 💡 LED inside the units (inner room only)'),
      h('label', { class: 'row chk big' }, dark, ' 🌑 Darken the inner room'),
      h('label', { class: 'row' }, h('span', { class: 'lbl' }, 'LED colour'), h('input', { type: 'color', value: L.colour, oninput: (e) => units.setLed({ colour: e.target.value }) })),
      numRow('LED level', { min: 0, max: 2, step: 0.01, value: L.intensity, onChange: (v) => units.setLed({ intensity: v }) }).row,
      h('div', { class: 'help' }, 'More control (each space\'s dimmer, colour temperature, track lights) is in Lighting below.'));
    ui.innerQuick = { ledOn, dark };
    panel.append(s.el);
  }

  // ---------------------------------------------------------------- selection
  {
    const s = section('Selection & units');
    const info = h('div', { class: 'info' });
    const wallSel = h('select', {});
    const fillWalls = (sel, includeAll) => {
      sel.innerHTML = '';
      for (const w of room.walls) {
        if (!includeAll && !room.mountable(w)) continue;
        if (w.kind === 'excluded') continue;
        sel.append(h('option', { value: w.id }, `${w.id} — ${w.label} (${Math.round(w.length)} cm)${room.mountable(w) ? '' : ' [off]'}`));
      }
    };
    fillWalls(wallSel, true);
    s.body.append(info,
      h('div', { class: 'btns' },
        h('button', { onclick: () => app.setAllMotors(true), class: 'hi' }, '▶ All motors on'),
        h('button', { onclick: () => app.setAllMotors(false) }, '■ All motors off'),
        h('button', { onclick: () => app.editSelected((u) => { u.hidden = true; }) }, 'Hide selected'),
        h('button', { onclick: () => { units.units.forEach((u) => (u.hidden = false)); units.refresh(); ui.refreshSelection(); app.autosave(); } }, 'Show all'),
      ),
      h('div', { class: 'btns' },
        h('button', { onclick: () => app.select([...units.units.keys()]) }, 'All'),
        h('button', { onclick: () => app.select([]) }, 'None'),
        h('button', { onclick: () => app.select([...units.units.keys()].filter((i) => !units.selected.has(i))) }, 'Invert'),
        h('button', { onclick: () => { const ws = new Set([...units.selected].map((i) => units.units[i].wall)); app.select([...units.units.keys()].filter((i) => ws.has(units.units[i].wall))); }, title: 'Extend the selection to every unit on the walls already selected' }, 'Whole wall(s)'),
      ),
      h('div', { class: 'row' }, wallSel, h('button', { onclick: (e) => app.select([...units.units.keys()].filter((i) => units.units[i].wall === wallSel.value), e.shiftKey) }, 'Select all on wall')),
    );

    // properties
    const props = h('div', { class: 'props' });
    const moveWall = h('select', { onchange: () => app.editSelected((u) => {
      const to = moveWall.value;
      if (to === 'FLOOR' && u.wall !== 'FLOOR') { const p = room.unitPlan(u); u.s = p.x + p.n[0] * 40; u.h = p.y + p.n[1] * 40; }
      else if (to !== 'FLOOR' && u.wall === 'FLOOR') { const q = room.projectOnWall(room.wall(to), u.s, u.h); u.s = q.s; u.h = 150; }
      u.wall = to;
    }) });
    const fS = numRow('Along wall', { min: 0, max: 1000, step: 1, unit: 'cm', onChange: (v) => app.editSelected((u) => { u.s = v; }) });
    const fH = numRow('Height', { min: 0, max: room.wallHeight, step: 1, unit: 'cm', onChange: (v) => app.editSelected((u) => { u.h = v; }) });
    const fR = numRow('Roll', { min: -180, max: 180, step: 1, unit: '°', onChange: (v) => app.editSelected((u) => { u.rot = v; }) });
    const fP = numRow('Speed', { min: 0, max: 30, step: 0.5, unit: 'rpm', onChange: (v) => app.editSelected((u) => { u.rpm = v; }) });
    const dirSel = h('select', { onchange: () => app.editSelected((u) => { u.dir = dirSel.value; }) },
      h('option', { value: 'cw' }, 'clockwise (facing wall)'), h('option', { value: 'ccw' }, 'counter-clockwise'), h('option', { value: '', disabled: true }, 'mixed'));
    const onChk = h('input', { type: 'checkbox', onchange: () => app.editSelected((u) => { u.on = onChk.checked; }) });
    const hidChk = h('input', { type: 'checkbox', onchange: () => app.editSelected((u) => { u.hidden = hidChk.checked; }) });
    props.append(
      h('label', { class: 'row' }, h('span', { class: 'lbl' }, 'Wall'), moveWall),
      fS.row, fH.row, fR.row, fP.row,
      h('label', { class: 'row' }, h('span', { class: 'lbl' }, 'Direction'), dirSel),
      h('label', { class: 'row chk' }, onChk, ' Motor on'),
      h('label', { class: 'row chk' }, hidChk, ' Hidden (remove from the wall)'),
      h('div', { class: 'btns' },
        h('button', { onclick: () => app.editSelected((u) => { u.dir = u.dir === 'cw' ? 'ccw' : 'cw'; }) }, 'Reverse dir'),
        h('button', { onclick: () => app.editSelected((u) => { u.on = !u.on; }) }, 'Toggle on/off'),
        h('button', { onclick: () => app.editSelected((u) => { const q = room.nearestMountable(...(() => { const p = room.unitPlan(u); return [p.x, p.y]; })()); if (u.wall !== 'FLOOR') { u.wall = 'FLOOR'; const p = room.unitPlan({ wall: q.wall.id, s: q.s, h: 0 }); u.s = p.x + p.n[0] * 40; u.h = p.y + p.n[1] * 40; } else { u.wall = q.wall.id; u.s = q.s; u.h = 150; } }), title: 'Move the selection from its wall to the floor in front of it, or from the floor back to the nearest wall' }, 'Wall ⇄ floor'),
      ),
    );

    // bulk ops
    const PROPS = { s: 'Along wall (cm)', h: 'Height (cm)', rot: 'Roll (°)', rpm: 'Speed (rpm)' };
    const DEF = { s: ['', ''], h: [90, 260], rot: [-180, 180], rpm: [2, 10] };
    const mkBulk = (title, verb, fn, extra = {}) => {
      const p = h('select', {}, ...Object.entries({ ...PROPS, ...extra }).map(([k, v]) => h('option', { value: k }, v)));
      const mn = h('input', { type: 'number', class: 'num', placeholder: 'min' });
      const mx = h('input', { type: 'number', class: 'num', placeholder: 'max' });
      const setDef = () => { const d = DEF[p.value] ?? ['', '']; mn.value = d[0]; mx.value = d[1]; };
      p.addEventListener('change', setDef);
      setDef();
      return h('div', { class: 'row bulk' }, h('span', { class: 'lbl' }, title), p, mn, mx,
        h('button', { onclick: () => fn(p.value, mn.value === '' ? null : +mn.value, mx.value === '' ? null : +mx.value) }, verb));
    };
    props.append(
      h('div', { class: 'sub' }, 'Bulk (applies to the selection)'),
      mkBulk('Randomize', 'Go', (k, a, b) => app.bulkRandomize(k, a, b), { dir: 'Direction' }),
      mkBulk('Distribute', 'Go', (k, a, b) => app.bulkDistribute(k, a, b)),
      h('div', { class: 'help' }, 'Distribute "along wall" spaces the selected units evenly on each wall they are on (blank min/max = whole wall). Other properties are spread in the order units sit along the walls.'),
    );
    s.body.append(props);
    panel.append(s.el);

    const agg = (vals) => {
      const allSame = vals.every((v) => v === vals[0]);
      const mean = typeof vals[0] === 'number' ? vals.reduce((a, b) => a + b, 0) / vals.length : vals[0];
      return { mixed: !allSame, v: allSame ? vals[0] : mean };
    };
    ui.refreshWalls = () => { const v = wallSel.value; fillWalls(wallSel, true); if (v) wallSel.value = v; };
    ui.refreshSelection = () => {
      const sel = [...units.selected].sort((a, b) => a - b).map((i) => units.units[i]);
      props.classList.toggle('disabled', sel.length === 0);
      const nh = units.units.filter((u) => u.hidden).length;
      const stats = `<b>${units.units.length - nh}</b> units on the walls${nh ? ` · ${nh} hidden` : ''} · motors on: ${units.units.filter((u) => u.on && !u.hidden).length}`;
      if (!sel.length) {
        info.innerHTML = `${stats}<br><span class="dim">nothing selected</span>`;
        return;
      }
      const walls = {};
      sel.forEach((u) => (walls[u.wall] = (walls[u.wall] || 0) + 1));
      const ids = sel.map((u) => u.id);
      info.innerHTML = `<b>${sel.length}</b> of ${units.units.length} selected: ${ids.slice(0, 14).join(', ')}${ids.length > 14 ? '…' : ''}<br><span class="dim">on ${Object.entries(walls).map(([w, n]) => `${w}×${n}`).join(', ')}</span>`;
      fillWalls(moveWall, false);
      moveWall.append(h('option', { value: 'FLOOR' }, 'Floor (lying, funnel up)'));
      const wa = agg(sel.map((u) => u.wall));
      const allFloor = sel.every((u) => u.wall === 'FLOOR');
      fS.row.querySelector('.lbl').textContent = allFloor ? 'Plan x' : 'Along wall';
      fH.row.querySelector('.lbl').textContent = allFloor ? 'Plan y' : 'Height';
      if (!room.mountable(room.wall(wa.v))) moveWall.append(h('option', { value: wa.v }, `${wa.v} [not mountable]`));
      if (wa.mixed) moveWall.append(h('option', { value: '', disabled: true }, 'mixed'));
      moveWall.value = wa.mixed ? '' : wa.v;
      const maxLen = Math.max(...sel.map((u) => room.wall(u.wall).length));
      const bb = room.bounds();
      fS.setRange(allFloor ? Math.round(bb.minX) : 0, allFloor ? Math.round(bb.maxX) : Math.round(maxLen));
      fH.setRange(allFloor ? Math.round(bb.minY) : 0, allFloor ? Math.round(bb.maxY) : room.wallHeight);
      for (const [f, k] of [[fS, 's'], [fH, 'h'], [fR, 'rot'], [fP, 'rpm']]) {
        const a = agg(sel.map((u) => u[k]));
        f.set(Math.round(a.v * 10) / 10, a.mixed);
      }
      const d = agg(sel.map((u) => u.dir));
      dirSel.value = d.mixed ? '' : d.v;
      const o = agg(sel.map((u) => u.on));
      onChk.indeterminate = o.mixed;
      onChk.checked = !o.mixed && o.v;
      const hd = agg(sel.map((u) => !!u.hidden));
      hidChk.indeterminate = hd.mixed;
      hidChk.checked = !hd.mixed && hd.v;
    };
  }

  // ---------------------------------------------------------------- room
  {
    const s = section('Room', false);
    const wh = numRow('Wall height', { min: 250, max: 600, step: 5, value: room.wallHeight, unit: 'cm', onChange: (v) => app.setWallHeight(v) });
    ui.wallHeight = wh;
    const opt = h('input', { type: 'checkbox', checked: room.optionalEnabled, onchange: (e) => app.setOptionalWalls(e.target.checked) });
    ui.optional = opt;
    const exVis = h('input', { type: 'checkbox', checked: true, onchange: (e) => app.setExcludedVisible(e.target.checked) });
    s.body.append(wh.row,
      h('label', { class: 'row chk' }, opt, ' Corridor walls are mountable (optional, unconfirmed)'),
      h('label', { class: 'row chk' }, exVis, ' Show excluded walls (entry wedge, storage side)'),
      h('div', { class: 'help' }, 'Geometry comes from sim/room.json (cm). Blue = target walls, orange = optional corridor, grey = excluded. Values marked plan-estimate in that file still need confirming on site.'),
    );
    panel.append(s.el);
  }

  // ---------------------------------------------------------------- grid lines (17x17 profile)
  {
    const { grid } = app;
    const s = section('Grid lines — 17×17 white profile', true);
    const info = h('div', { class: 'info' });
    const drawBtn = h('button', { class: 'hi', onclick: () => app.setDraw(!app.draw.on) }, '✎ Draw lines (L)');
    ui.setDrawState = (on) => { drawBtn.textContent = on ? '■ Stop drawing (Esc)' : '✎ Draw lines (L)'; drawBtn.classList.toggle('on', on); };
    const sel = h('div', { class: 'props' });
    const surfName = (id) => (id === 'FLOOR' ? 'Floor' : id);
    const refresh = () => {
      const byS = {};
      for (const l of grid.lines) byS[surfName(l.surf)] = (byS[surfName(l.surf)] ?? 0) + grid.lengthCm(l);
      info.innerHTML = `<b>${grid.lines.length}</b> lines · total profile <b>${(grid.totalLengthCm() / 100).toFixed(1)} m</b><br>` +
        `<span class="dim">${Object.entries(byS).map(([k, v]) => `${k} ${(v / 100).toFixed(1)} m`).join(' · ') || 'no lines yet'}</span>`;
      sel.innerHTML = '';
      const l = grid.lines.find((x) => x.id === grid.selected);
      if (!l) { sel.append(h('div', { class: 'help' }, 'Click a line (drawing off) to select it · Delete key removes it')); return; }
      const isF = l.surf === 'FLOOR';
      const upd = () => { grid.buildLines(); app.editProfiles(); };
      const f = (label, arr, k) => numRow(label, { min: isF ? -100 : 0, max: isF ? 2300 : Math.round(room.wall(l.surf)?.length ?? 2000), value: Math.round(arr[k]), unit: 'cm', onChange: (v) => { arr[k] = v; upd(); } }).row;
      sel.append(
        h('div', { class: 'sub' }, `Line ${l.id} · ${isF ? 'floor' : `wall ${l.surf}`} · ${grid.lengthCm(l).toFixed(0)} cm`),
        f(isF ? 'Start x' : 'Start along', l.a, 0), f(isF ? 'Start y' : 'Start height', l.a, 1),
        f(isF ? 'End x' : 'End along', l.b, 0), f(isF ? 'End y' : 'End height', l.b, 1),
        h('div', { class: 'btns' }, h('button', { onclick: () => app.deleteSelectedLine() }, 'Delete line')));
    };
    app.onLinesChanged = refresh;
    const cg = h('input', { type: 'checkbox', checked: true, onchange: (e) => grid.setCeilingGridVisible(e.target.checked) });
    const pv = h('input', { type: 'checkbox', checked: true, onchange: (e) => grid.setProfilesVisible(e.target.checked) });
    const su = h('input', { type: 'checkbox', checked: app.draw.snapUnits, onchange: (e) => (app.draw.snapUnits = e.target.checked) });
    const step = h('input', { type: 'number', class: 'num', value: app.draw.step, min: 0, max: 100, onchange: (e) => (app.draw.step = +e.target.value) });
    s.body.append(info,
      h('div', { class: 'btns' }, drawBtn,
        h('button', { onclick: () => { if (!confirm('Remove all grid lines?')) return; grid.setLines([]); app.editProfiles(); } }, 'Clear all'),
        h('button', { onclick: () => { grid.setLines(grid.defaultLines()); app.editProfiles(); }, title: 'A grid on every wall with units: the ceiling-grid lines continue down the walls (gaps filled to one cell) + one run under the ceiling' }, 'Default wall grid'),
      ),
      h('div', { class: 'help' }, 'Drawing: click on a wall or the floor to start, click again to end the line — it continues from there, so you can draw a path. Click the same point twice or press Esc to stop. Shift = straight (horizontal / vertical). Ends snap to unit tips and to other line ends.'),
      h('label', { class: 'row' }, h('span', { class: 'lbl' }, 'Snap step'), step, h('span', { class: 'unit' }, 'cm')),
      h('label', { class: 'row chk' }, su, ' Snap line ends to unit tips (wire exit)'),
      h('label', { class: 'row chk' }, pv, ' Show grid lines'),
      h('label', { class: 'row chk' }, cg, ' Show the existing ceiling grid (4×4 cm metal)'),
      sel,
    );
    ui.refreshProfiles = refresh;
    refresh();
    panel.append(s.el);
  }

  // ---------------------------------------------------------------- partitions
  if (app.partitions.enabled) {
    const P = app.partitions, st = P.state;
    const s = section('Partitions (divider)', false);
    const info = h('div', { class: 'info' });
    const manual = h('div', { class: 'props' });
    const refresh = () => {
      const D = P.D;
      info.innerHTML = `<b>${st.count}</b> partitions × ${st.widthCm} cm, pivots every ${D.spacing.toFixed(0)} cm<br>` +
        `<span class="dim">mechanism: lever ${D.Lv} cm, crank r ${D.r.toFixed(1)} cm, rod ${D.c.toFixed(0)} cm · swing ${st.minDeg}°–${st.maxDeg}° · never closer than ${P.minGapToClosedDeg().toFixed(0)}° to closed</span>`;
      manual.innerHTML = '';
      manual.classList.toggle('disabled', st.mechanism);
      for (let i = 0; i < st.count; i++) {
        manual.append(numRow(`Panel ${i + 1}`, { min: 0, max: 360, value: Math.round(st.manual[i] ?? st.minDeg), unit: '°', onChange: (v) => { st.manual[i] = v; P.apply(); app.autosave(); } }).row);
      }
    };
    const chk = (label, key, fn) => h('label', { class: 'row chk' }, h('input', { type: 'checkbox', checked: st[key], onchange: (e) => { st[key] = e.target.checked; fn?.(e.target.checked); P.apply(); refresh(); app.autosave(); } }), label);
    s.body.append(info,
      chk(' Show partitions', 'visible', (v) => P.setVisible(v)),
      chk(' Mechanism drives all panels together (motor on the inner ceiling)', 'mechanism'),
      chk(' Mechanism motor running', 'running'),
      numRow('Cycle time', { min: 5, max: 600, value: st.periodS, unit: 's', onChange: (v) => { st.periodS = v; app.autosave(); } }).row,
      numRow('Swing from', { min: 5, max: 175, value: st.minDeg, unit: '°', onChange: (v) => { st.minDeg = v; P.rebuild(); refresh(); app.autosave(); } }).row,
      numRow('Swing to', { min: 10, max: 180, value: st.maxDeg, unit: '°', onChange: (v) => { st.maxDeg = v; P.rebuild(); refresh(); app.autosave(); } }).row,
      numRow('Count', { min: 1, max: 10, value: st.count, onChange: (v) => { P.setCount(v); refresh(); app.autosave(); } }).row,
      numRow('Width', { min: 40, max: 150, value: st.widthCm, unit: 'cm', onChange: (v) => { P.setWidth(v); app.autosave(); } }).row,
      h('div', { class: 'sub' }, 'Manual angle per panel (mechanism off), 0° = closed in line'),
      manual,
      h('div', { class: 'help' }, 'Angles are measured from the divider line. With the mechanism on, all panels share one angle that swings between the two limits; the crank turns one way continuously, so the panels can never all be closed.'),
    );
    ui.refreshPartitions = refresh;
    refresh();
    panel.append(s.el);
  }

  // ---------------------------------------------------------------- lighting
  {
    const s = section('Lighting', false);
    const amb = numRow('Ambient', { min: 0, max: 2, step: 0.01, value: lighting.ambient.intensity, onChange: (v) => lighting.setAmbient(v) });
    const exp = numRow('Exposure', { min: 0.2, max: 2.5, step: 0.01, value: lighting.exposure, onChange: (v) => lighting.setExposure(v) });
    const sh = h('input', { type: 'checkbox', checked: lighting.shadows, onchange: (e) => lighting.setShadows(e.target.checked) });
    const wc = h('input', { type: 'color', value: '#' + room.wallMat.color.getHexString(), oninput: (e) => { room.wallMat.color.set(e.target.value); room.excludedMat.color.set(e.target.value).multiplyScalar(0.94); } });
    const fc = h('input', { type: 'color', value: '#' + room.floorMat.color.getHexString(), oninput: (e) => room.floorMat.color.set(e.target.value) });
    const spotsBox = h('div', {});
    ui.lighting = { amb, exp, sh, wc, fc };
    const renderSpots = () => {
      spotsBox.innerHTML = '';
      lighting.spots.forEach((sp, i) => {
        const p = sp.p;
        const upd = (k) => (v) => { p[k] = v; lighting.apply(sp); app.autosave(); };
        const on = h('input', { type: 'checkbox', checked: p.on, onchange: (e) => upd('on')(e.target.checked) });
        const d = h('details', { class: 'spot' }, h('summary', {}, on, ` Track light ${i + 1} · ${p.zone === 'inner' ? 'inner' : 'outer'} space`,
          h('button', { class: 'mini', onclick: (e) => { e.preventDefault(); lighting.removeSpot(i); renderSpots(); app.autosave(); } }, '✕')),
          numRow('Pos x', { min: -100, max: 2300, value: p.x, unit: 'cm', onChange: upd('x') }).row,
          numRow('Pos y', { min: -100, max: 1200, value: p.y, unit: 'cm', onChange: upd('y') }).row,
          numRow('Aim x', { min: -100, max: 2300, value: p.aimX, unit: 'cm', onChange: upd('aimX') }).row,
          numRow('Aim y', { min: -100, max: 1200, value: p.aimY, unit: 'cm', onChange: upd('aimY') }).row,
          numRow('Aim height', { min: 0, max: 600, value: p.aimH, unit: 'cm', onChange: upd('aimH') }).row,
          numRow('Intensity', { min: 0, max: 200, step: 1, value: p.intensity, unit: 'cd', onChange: upd('intensity') }).row,
          numRow('Colour temp', { min: 1800, max: 6500, step: 50, value: p.kelvin, unit: 'K', onChange: upd('kelvin') }).row,
          numRow('Beam angle', { min: 5, max: 120, step: 1, value: p.angle, unit: '°', onChange: upd('angle') }).row,
          numRow('Softness', { min: 0, max: 1, step: 0.01, value: p.penumbra, onChange: upd('penumbra') }).row,
        );
        spotsBox.append(d);
      });
    };
    ui.renderSpots = renderSpots;
    renderSpots();
    const zoneBox = (id, label) => {
      const z = lighting.zones[id];
      const k = numRow('Colour temp', { min: 0, max: 6500, step: 50, value: z.kelvin, unit: 'K', onChange: (v) => { lighting.setZone(id, { kelvin: v }); app.autosave(); } });
      return h('div', { class: 'spot' },
        h('label', { class: 'row chk' }, h('input', { type: 'checkbox', checked: z.on, onchange: (e) => { lighting.setZone(id, { on: e.target.checked }); app.autosave(); } }), h('b', {}, ` ${label}`)),
        numRow('Dimmer', { min: 0, max: 2, step: 0.01, value: z.dim, onChange: (v) => { lighting.setZone(id, { dim: v }); app.autosave(); } }).row,
        k.row,
        h('div', { class: 'help' }, 'Colour temp 0 = each light keeps its own.'),
        h('div', { class: 'btns' }, h('button', { onclick: () => { lighting.addSpot(id); renderSpots(); app.autosave(); } }, `+ Light in ${id} space`)));
    };
    const L = units.led;
    const led = h('div', { class: 'spot' },
      h('label', { class: 'row chk' }, h('input', { type: 'checkbox', checked: L.on, onchange: (e) => units.setLed({ on: e.target.checked }) }), h('b', {}, ' LED inside the units (inner space only)')),
      h('label', { class: 'row' }, h('span', { class: 'lbl' }, 'LED colour'), h('input', { type: 'color', value: L.colour, oninput: (e) => units.setLed({ colour: e.target.value }) })),
      numRow('LED level', { min: 0, max: 2, step: 0.01, value: L.intensity, onChange: (v) => units.setLed({ intensity: v }) }).row,
      h('div', { class: 'help' }, 'Tip: dim the inner-space lighting to see the LEDs.'));
    s.body.append(
      h('div', { class: 'sub' }, 'Two lighting systems'),
      zoneBox('inner', 'Inner space (68 m², west)'),
      zoneBox('outer', 'Outer space (85 m², east)'),
      led,
      h('div', { class: 'sub' }, 'General'),
      amb.row, exp.row,
      h('label', { class: 'row chk' }, sh, ' Shadows'),
      h('label', { class: 'row' }, h('span', { class: 'lbl' }, 'Wall colour'), wc, h('span', { class: 'lbl' }, ' Floor'), fc),
      h('div', { class: 'sub' }, 'Track lights (mounted 20 cm below the ceiling; positions in plan cm)'),
      spotsBox);
    panel.append(s.el);
  }

  // ---------------------------------------------------------------- layout I/O
  {
    const s = section('Layout', false);
    const seed = h('input', { type: 'number', class: 'num', value: app.seed });
    const count = h('input', { type: 'number', class: 'num', value: GEN_DEFAULTS.count, min: 1, max: 240 });
    const file = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none', onchange: async (e) => {
      const f = e.target.files[0]; if (!f) return;
      try { app.loadLayout(parseLayout(await f.text())); app.toast(`Loaded ${f.name}`); } catch (err) { app.toast('Load failed: ' + err.message, true); }
      file.value = '';
    } });
    const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    s.body.append(
      h('div', { class: 'row' }, h('span', { class: 'lbl' }, 'Seed'), seed, h('span', { class: 'lbl' }, 'Units'), count,
        h('button', { onclick: () => { app.seed = +seed.value; app.setUnits(generateLayout(room, { seed: app.seed, count: +count.value })); app.toast(`Generated ${count.value} units, seed ${seed.value}`); } }, 'Generate')),
      h('div', { class: 'btns' },
        h('button', { onclick: () => { localStorage.setItem('pinrose.layout', layoutToJSON(app)); app.toast('Saved in this browser'); } }, 'Save (browser)'),
        h('button', { onclick: () => { const t = localStorage.getItem('pinrose.layout'); if (!t) return app.toast('Nothing saved yet', true); app.loadLayout(parseLayout(t)); app.toast('Loaded from browser'); } }, 'Load (browser)'),
        h('button', { onclick: () => { const t = localStorage.getItem('pinrose.autosave'); if (!t) return app.toast('No autosave', true); app.loadLayout(parseLayout(t)); app.toast('Restored autosave'); } }, 'Restore autosave'),
      ),
      h('div', { class: 'btns' },
        h('button', { onclick: () => download(`pinrose-layout-${stamp()}.json`, layoutToJSON(app)) }, 'Download JSON'),
        h('button', { onclick: () => file.click() }, 'Upload JSON'), file,
        h('button', { onclick: () => download(`pinrose-install-${stamp()}.csv`, layoutToCSV(room, units.units), 'text/csv') }, 'Export CSV'),
        h('button', { onclick: () => app.exportSTL(), title: 'Static 3D snapshot of the whole space (mm). SketchUp for Web imports STL only with a subscription.' }, 'Export 3D (STL)'),
      ),
      h('div', { class: 'help' }, 'CSV: distance along wall is from the first point of the wall in room.json; height = funnel centre above floor; orientation = roll of the teardrop tip from vertical, counter-clockwise positive, facing the wall.'),
    );
    panel.append(s.el);
  }

  ui.refreshAll = () => { ui.refreshProfiles?.(); ui.refreshPartitions?.(); ui.refreshSelection?.(); };
  return ui;
}
