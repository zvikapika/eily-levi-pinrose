import trimesh, numpy as np
from pathlib import Path
R = Path(__file__).resolve().parent.parent
cov = trimesh.load(R / 'out_v6/pinrus_v6.stl'); js = trimesh.load(R / 'out_jig/_fit_straight.stl'); jr = trimesh.load(R / 'out_jig/_fit_round.stl')


def hits(m, o, d):
    loc, _, _ = m.ray.intersects_location([o], [d])
    return sorted(np.round(np.asarray(loc).reshape(-1, 3) @ np.array(d), 2).tolist())


print('straight cover', hits(cov, [-100, 86, 40], [1, 0, 0])[:2], 'jig', hits(js, [-100, 86, 40], [1, 0, 0]))
print('round cover', hits(cov, [-50, -40, 40], [0, 1, 0])[:2], 'jig', hits(jr, [-50, -40, 40], [0, 1, 0]))
