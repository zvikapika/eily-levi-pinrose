"""Pictures of the notch jigs: each jig alone + both jigs placed on the v6 cover (from fit_check.py)."""
from pathlib import Path
import numpy as np, trimesh, pyvista as pv
pv.OFF_SCREEN = True
R = Path(__file__).resolve().parent.parent
O = R / "out_jig"


def pvm(m):
    f = np.hstack([np.full((len(m.faces), 1), 3), m.faces]).astype(np.int64)
    return pv.PolyData(np.asarray(m.vertices), f)


pl = pv.Plotter(off_screen=True, shape=(1, 3), window_size=(2100, 800), border=False)
pl.set_background("white")
for k, name in enumerate(["notch_jig_straight", "notch_jig_round"]):
    pl.subplot(0, k)
    m = trimesh.load(O / f"{name}.stl")
    m.apply_transform(trimesh.transformations.rotation_matrix(np.pi, [1, 0, 0]))  # as used: top plate up
    pl.add_mesh(pvm(m), color="#ffb36b", smooth_shading=False, specular=0.3)
    pl.camera_position = [(60, -90, 60), (0, 0, -14), (0, 0, 1)]
    pl.reset_camera(); pl.camera.zoom(1.15)
    pl.add_text({"notch_jig_straight": "Straight sides", "notch_jig_round": "Round end"}[name], font_size=13, color="black")
pl.subplot(0, 2)
cov = trimesh.load(R / "out_v6" / "pinrus_v6.stl")
pl.add_mesh(pvm(cov), color="#f4f1ea", smooth_shading=False)
for n in ("_fit_straight", "_fit_round"):
    pl.add_mesh(pvm(trimesh.load(O / f"{n}.stl")), color="#ff8a3d")
pl.camera_position = [(-160, -120, 190), (-43, 60, 30), (0, 0, 1)]
pl.reset_camera(); pl.camera.zoom(1.3)
pl.add_text("On the cover (open back up)", font_size=13, color="black")
pl.screenshot(O / "notch_jig_views.png")
print("ok")
