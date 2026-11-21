#!/usr/bin/env python3
"""Assemble the Pinrose wall unit from the CAD STLs into one GLB for the simulator.

Usage (from repo root):
    uv run --with trimesh --with numpy sim/tools/build_unit_glb.py \
        [--bracket 3d/pinruswall.stl] [--cover 3d/pinrus.stl] [--ring 3d/pinruso.stl] \
        [--out sim/assets/unit.glb]

Output frame (metres, glTF Y-up is ignored; the sim uses this frame directly):
    origin = funnel/cup axis, on the wall plane
    +X = across the unit, +Y = toward the teardrop tip ("up" at roll 0), +Z = out of the wall
Nodes: "bracket", "cover", "ring". The funnel is procedural (sim/src/unit.js).

Placement of each STL in that frame is defined by PARTS below. The STLs are each
modelled in their own coordinates, so a v2 part with a different origin needs its
transform updated here (the sim itself never changes).
"""
import argparse, json
import numpy as np
import trimesh

ap = argparse.ArgumentParser()
ap.add_argument('--bracket', default='3d/pinruswall.stl')
ap.add_argument('--cover', default='3d/pinrus.stl')
ap.add_argument('--ring', default='3d/pinruso.stl')
ap.add_argument('--out', default='sim/assets/unit.glb')
a = ap.parse_args()

# --- measured from the v1 STLs (mm) -------------------------------------------
CUP = (-43.0, 15.5)          # cup axis in pinrus.stl XY
COVER_DEPTH = 50.0           # pinrus.stl Z extent; open rim (z=50) goes against the wall
COVER_FLOOR = 3.0
RING_CENTER = (-102.15, 129.65)   # pinruso.stl XY centre
RING_GAP = 0.5               # ring sits just behind the cover floor, inside the cup (assumption)

def m_cover(v):
    # rotate 180 deg about Y: floor (z=0) faces out of the wall, rim at the wall
    x, y, z = v.T
    return np.c_[-(x - CUP[0]), y - CUP[1], COVER_DEPTH - z]

def m_bracket(v, bb):
    # bracket's back plate (z=0) is on the wall; its round end is at +Y in the STL,
    # the cover's round end is at -Y, so rotate 180 deg about Z and centre it in the cover
    x, y, z = v.T
    cx = (bb[0][0] + bb[1][0]) / 2
    cy = (bb[0][1] + bb[1][1]) / 2
    cover_cy = (-15.0 + 146.0) / 2 - CUP[1]   # cover bbox centre in unit frame
    return np.c_[-(x - cx), -(y - cy) + cover_cy, z]

def m_ring(v):
    x, y, z = v.T
    z0 = COVER_DEPTH - COVER_FLOOR - RING_GAP - 3.0
    return np.c_[x - RING_CENTER[0], y - RING_CENTER[1], z + z0]

scene = trimesh.Scene()
meta = {}
for name, path in (('bracket', a.bracket), ('cover', a.cover), ('ring', a.ring)):
    m = trimesh.load(path, force='mesh')
    if name == 'cover':
        v = m_cover(m.vertices)
    elif name == 'bracket':
        v = m_bracket(m.vertices, m.bounds)
    else:
        v = m_ring(m.vertices)
    # all transforms are proper rotations + translations, so face winding is unchanged
    mm = trimesh.Trimesh(vertices=v / 1000.0, faces=m.faces, process=True)
    mm.fix_normals()
    scene.add_geometry(mm, node_name=name, geom_name=name)
    meta[name] = {'tris': int(len(mm.faces)), 'bounds_mm': (mm.bounds * 1000).round(2).tolist(), 'src': path}

meta['funnel_pivot_mm'] = [0, 0, COVER_DEPTH - COVER_FLOOR - RING_GAP - 3.0]
meta['cover_face_mm'] = COVER_DEPTH
scene.metadata['pinrose'] = meta
scene.export(a.out)
with open(a.out.replace('.glb', '.json'), 'w') as fh:
    json.dump(meta, fh, indent=2)
print(json.dumps(meta, indent=2))
