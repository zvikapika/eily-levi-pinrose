"""Assembly STEP for Pinrose v6 (cover frame). Printed parts are sewn from the print meshes (planar facets,
same geometry as the STLs); motor / coupler / crank are B-rep placeholders built from the parameters."""
import sys, time
import numpy as np, trimesh
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import pinrose_v2 as P
import pinrose_v6 as P3
from build123d import Solid, Compound, export_step, Color
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakePolygon, BRepBuilderAPI_MakeFace, BRepBuilderAPI_Sewing, BRepBuilderAPI_MakeSolid
from OCP.gp import gp_Pnt
from OCP.TopoDS import TopoDS
from OCP.TopAbs import TopAbs_SHELL
from OCP.TopExp import TopExp_Explorer
from OCP.ShapeUpgrade import ShapeUpgrade_UnifySameDomain


def mesh_to_solid(m):
    from OCP.ShapeFix import ShapeFix_Shape
    sew = BRepBuilderAPI_Sewing(1e-3)
    V = m.vertices
    keep = m.area_faces > 1e-7
    for f in m.faces[keep]:
        poly = BRepBuilderAPI_MakePolygon(*[gp_Pnt(*map(float, V[i])) for i in f], True)
        face = BRepBuilderAPI_MakeFace(poly.Wire(), True)
        if face.IsDone():
            sew.Add(face.Face())
    sew.Perform()
    sh = sew.SewedShape()
    ex = TopExp_Explorer(sh, TopAbs_SHELL)
    mk = BRepBuilderAPI_MakeSolid()
    while ex.More():
        mk.Add(TopoDS.Shell(ex.Current())); ex.Next()
    s = mk.Solid()
    u = ShapeUpgrade_UnifySameDomain(s, True, True, True); u.Build()
    s = Solid(u.Shape())
    if not s.is_valid:
        fx = ShapeFix_Shape(s.wrapped); fx.Perform()
        s = Solid(fx.Shape())
    return s


t = time.time()
A = P3.OUT / "asm"
cols = dict(cover=(0.95, 0.94, 0.91), bracket=(0.91, 0.89, 0.85), strap=(0.97, 0.96, 0.94), strap2=(0.97, 0.96, 0.94), ring=(0.94, 0.91, 0.86))
children = []
for n in ["cover", "bracket", "strap", "strap2", "ring"]:
    s = mesh_to_solid(trimesh.load(A / f"{n}.stl"))
    s.label = {"cover": "pinrus_v6_cover", "bracket": "pinruswall_v6_bracket", "strap": "motor_strap_v6_a", "strap2": "motor_strap_v6_b", "ring": "pinruso_ring"}[n]
    s.color = Color(*cols[n])
    print(n, "valid", s.is_valid, "vol", round(s.volume, 1), f"{time.time() - t:.1f}s")
    children.append(s)
# placeholders as true B-rep
d = P.derived(); zA = P.MOTOR_AXIS_Z
ph = dict(
    motor_placeholder_D22x55=P.ycyl(P.AXIS_X, zA, P.MOTOR_D, P.Y_FACE, d["y_rear"]) + P.ycyl(P.AXIS_X, zA, P.FLANGE_D, P.Y_FACE - P.FLANGE_L, P.Y_FACE)
    + P.ycyl(P.AXIS_X, zA, P.SHAFT_D, P.Y_FACE - P.FLANGE_L - P.SHAFT_L, P.Y_FACE - P.FLANGE_L),
    coupler_placeholder=P.ycyl(P.AXIS_X, zA, P.COUPLER_D, d["cpl0"], d["cpl1"]),
)
colsp = dict(motor_placeholder_D22x55=(0.62, 0.64, 0.67), coupler_placeholder=(0.79, 0.64, 0.23))
for k, v in ph.items():
    v.label = k; v.color = Color(*colsp[k]); children.append(v)
cr = mesh_to_solid(trimesh.load(A / "crank.stl")); cr.label = "crank_wire_placeholder"; cr.color = Color(0.2, 0.2, 0.2)
children.append(cr)
asm = Compound(children=children, label="pinrose_unit_v6")
export_step(asm, P3.OUT / "pinrose_v6_assembly.step")
print("step ok", f"{time.time() - t:.1f}s", (P3.OUT / "pinrose_v6_assembly.step").stat().st_size // 1024, "KB")
