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
      ...['overview', 'walk', 'plan'].map((m) => (btns[m] = h('button', { onclick: () => app.setMode(m), title: `key ${['overview', 'walk', 'plan'].indexOf(m) + 1}` }, m[0].toUpperCase() + m.slice(1)))));
    const help = h('div', { class: 'help' });
    ui.setMode = (m) => {
      for (const [k, b] of Object.entries(btns)) b.classList.toggle('on', k === m);
      help.innerHTML = {
        overview: 'Drag: orbit · right-drag: pan · wheel: zoom · click a unit: select (shift/ctrl: add) · drag a unit: slide it along the walls',
        walk: 'Click the view to look around (pointer lock) · WASD/arrows: walk · shift: faster · click: select the unit under the cross · Esc: release mouse',
        plan: 'Drag on empty floor: box select (shift: add) · click/shift-click a dot: select · drag a dot: slide along walls · right-drag: pan · wheel: zoom',
      }[m];
    };
    const ceil = h('input', { type: 'checkbox', onchange: (e) => app.setCeiling(e.target.checked) });
    ui.ceiling = ceil;
    s.body.append(bar, help,
      h('label', { class: 'row chk' }, ceil, ' Ceiling (auto in walk mode)'),
      h('label', { class: 'row chk' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => (app.cutaway = e.target.checked) }), ' Cutaway: see through walls facing away (overview)'),
      h('label', { class: 'row chk' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => app.setUnitDots(e.target.checked) }), ' Locator dots behind units (overview)'),
      h('label', { class: 'row chk' }, h('input', { type: 'checkbox', checked: true, onchange: (e) => app.setLabels(e.target.checked) }), ' Wall labels in plan view'),
    );
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
        h('button', { onclick: () => app.select([...units.units.keys()]) }, 'All'),
        h('button', { onclick: () => app.select([]) }, 'None'),
        h('button', { onclick: () => app.select([...units.units.keys()].filter((i) => !units.selected.has(i))) }, 'Invert'),
        h('button', { onclick: () => { const ws = new Set([...units.selected].map((i) => units.units[i].wall)); app.select([...units.units.keys()].filter((i) => ws.has(units.units[i].wall))); }, title: 'Extend the selection to every unit on the walls already selected' }, 'Whole wall(s)'),
      ),
      h('div', { class: 'row' }, wallSel, h('button', { onclick: (e) => app.select([...units.units.keys()].filter((i) => units.units[i].wall === wallSel.value), e.shiftKey) }, 'Select all on wall')),
    );

    // properties
    const props = h('div', { class: 'props' });
    const moveWall = h('select', { onchange: () => app.editSelected((u) => { u.wall = moveWall.value; }) });
    const fS = numRow('Along wall', { min: 0, max: 1000, step: 1, unit: 'cm', onChange: (v) => app.editSelected((u) => { u.s = v; }) });
    const fH = numRow('Height', { min: 0, max: room.wallHeight, step: 1, unit: 'cm', onChange: (v) => app.editSelected((u) => { u.h = v; }) });
    const fR = numRow('Roll', { min: -180, max: 180, step: 1, unit: '°', onChange: (v) => app.editSelected((u) => { u.rot = v; }) });
    const fP = numRow('Speed', { min: 0, max: 30, step: 0.5, unit: 'rpm', onChange: (v) => app.editSelected((u) => { u.rpm = v; }) });
    const dirSel = h('select', { onchange: () => app.editSelected((u) => { u.dir = dirSel.value; }) },
      h('option', { value: 'cw' }, 'clockwise (facing wall)'), h('option', { value: 'ccw' }, 'counter-clockwise'), h('option', { value: '', disabled: true }, 'mixed'));
    const onChk = h('input', { type: 'checkbox', onchange: () => app.editSelected((u) => { u.on = onChk.checked; }) });
    props.append(
      h('label', { class: 'row' }, h('span', { class: 'lbl' }, 'Wall'), moveWall),
      fS.row, fH.row, fR.row, fP.row,
      h('label', { class: 'row' }, h('span', { class: 'lbl' }, 'Direction'), dirSel),
      h('label', { class: 'row chk' }, onChk, ' Motor on'),
      h('div', { class: 'btns' },
        h('button', { onclick: () => app.editSelected((u) => { u.dir = u.dir === 'cw' ? 'ccw' : 'cw'; }) }, 'Reverse dir'),
        h('button', { onclick: () => app.editSelected((u) => { u.on = !u.on; }) }, 'Toggle on/off'),
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
      if (!sel.length) {
        info.innerHTML = `<b>${units.units.length}</b> units · nothing selected`;
        return;
      }
      const walls = {};
      sel.forEach((u) => (walls[u.wall] = (walls[u.wall] || 0) + 1));
      const ids = sel.map((u) => u.id);
      info.innerHTML = `<b>${sel.length}</b> of ${units.units.length} selected: ${ids.slice(0, 14).join(', ')}${ids.length > 14 ? '…' : ''}<br><span class="dim">on ${Object.entries(walls).map(([w, n]) => `${w}×${n}`).join(', ')}</span>`;
      fillWalls(moveWall, false);
      const wa = agg(sel.map((u) => u.wall));
      if (!room.mountable(room.wall(wa.v))) moveWall.append(h('option', { value: wa.v }, `${wa.v} [not mountable]`));
      if (wa.mixed) moveWall.append(h('option', { value: '', disabled: true }, 'mixed'));
      moveWall.value = wa.mixed ? '' : wa.v;
      const maxLen = Math.max(...sel.map((u) => room.wall(u.wall).length));
      fS.setRange(0, Math.round(maxLen));
      fH.setRange(0, room.wallHeight);
      for (const [f, k] of [[fS, 's'], [fH, 'h'], [fR, 'rot'], [fP, 'rpm']]) {
        const a = agg(sel.map((u) => u[k]));
        f.set(Math.round(a.v * 10) / 10, a.mixed);
      }
      const d = agg(sel.map((u) => u.dir));
      dirSel.value = d.mixed ? '' : d.v;
      const o = agg(sel.map((u) => u.on));
      onChk.indeterminate = o.mixed;
      onChk.checked = !o.mixed && o.v;
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
        const d = h('details', { class: 'spot' }, h('summary', {}, on, ` Track light ${i + 1}`),
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
    s.body.append(amb.row, exp.row,
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
      ),
      h('div', { class: 'help' }, 'CSV: distance along wall is from the first point of the wall in room.json; height = funnel centre above floor; orientation = roll of the teardrop tip from vertical, counter-clockwise positive, facing the wall.'),
    );
    panel.append(s.el);
  }

  return ui;
}
