// Layout generation (seeded), JSON save/load, CSV export.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const GEN_DEFAULTS = {
  count: 60,
  seed: 1,
  heightMinCm: 90,
  heightMaxCm: 260,
  rpmMin: 2,
  rpmMax: 10,
  jitterCm: 18,
};

// Spread `count` units along all currently mountable walls, proportional to wall length.
export function generateLayout(room, opts = {}) {
  const o = { ...GEN_DEFAULTS, ...opts };
  const rnd = mulberry32(o.seed);
  const walls = room.mountableWalls();
  const margin = 15;
  const usable = walls.map((w) => Math.max(0, w.length - 2 * margin));
  const total = usable.reduce((a, b) => a + b, 0);
  const step = total / o.count;
  const units = [];
  for (let i = 0; i < o.count; i++) {
    let d = (i + 0.5) * step + (rnd() * 2 - 1) * Math.min(o.jitterCm, step * 0.35);
    d = Math.max(0, Math.min(total - 1e-6, d));
    let wi = 0;
    while (wi < walls.length - 1 && d > usable[wi]) { d -= usable[wi]; wi++; }
    units.push({
      id: `U${String(i + 1).padStart(2, '0')}`,
      wall: walls[wi].id,
      s: Math.round((margin + d) * 10) / 10,
      h: Math.round(o.heightMinCm + rnd() * (o.heightMaxCm - o.heightMinCm)),
      rot: Math.round(rnd() * 360 - 180),
      rpm: Math.round((o.rpmMin + rnd() * (o.rpmMax - o.rpmMin)) * 2) / 2,
      dir: rnd() < 0.5 ? 'cw' : 'ccw',
      on: true,
    });
  }
  return units;
}

export function layoutToJSON(state) {
  return JSON.stringify(
    {
      format: 'pinrose-layout',
      version: 2,
      savedAt: new Date().toISOString(),
      room: { wallHeightCm: state.room.wallHeight, optionalWallsEnabled: state.room.optionalEnabled },
      seed: state.seed,
      units: state.units.units.map(({ zone, ...u }) => u),
      lighting: state.lighting.toJSON(),
      profiles: state.grid?.toJSON(),
      partitions: state.partitions?.toJSON(),
      led: state.units.led,
    },
    null,
    2
  );
}

export function parseLayout(text) {
  const d = JSON.parse(text);
  if (d.format !== 'pinrose-layout' || !Array.isArray(d.units)) throw new Error('Not a Pinrose layout file');
  for (const u of d.units) {
    for (const k of ['wall', 's', 'h']) if (u[k] === undefined) throw new Error(`unit ${u.id} missing "${k}"`);
    u.rot ??= 0; u.rpm ??= 5; u.dir ??= 'cw'; u.on ??= true; u.hidden ??= false;
  }
  return d;
}

export function layoutToCSV(room, units) {
  const head = ['unit_id', 'wall_id', 'wall_label', 'distance_along_wall_cm', 'height_cm', 'orientation_deg', 'rpm', 'direction', 'on', 'plan_x_cm', 'plan_y_cm', 'zone', 'profile', 'hidden'];
  const rows = [head.join(',')];
  const order = [...units].sort((a, b) => (a.wall === b.wall ? a.s - b.s : a.wall.localeCompare(b.wall)));
  for (const u of order) {
    const w = room.wall(u.wall);
    const p = room.pointAt(w, u.s);
    rows.push([
      u.id, u.wall, `"${w.label.replace(/"/g, "'")}"`, u.s.toFixed(1), u.h.toFixed(1), u.rot.toFixed(1),
      u.rpm, u.dir, u.on ? 1 : 0, p.x.toFixed(1), p.y.toFixed(1), u.zone ?? '', u.profile ?? '', u.hidden ? 1 : 0,
    ].join(','));
  }
  return rows.join('\n') + '\n';
}

export function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
