#!/bin/bash
# Creates cad/.venv (gitignored). A fresh `uv pip install build123d` times out on this host,
# so the venv reuses the known-good CAD stack of ~/the_other_room/cad/.venv through a .pth file
# (build123d, trimesh+manifold3d, pyvista, shapely, matplotlib). Same Python 3.12 build.
# On a host with working installs instead run:
#   uv venv cad/.venv --python 3.12 && uv pip install --python cad/.venv/bin/python build123d trimesh manifold3d rtree shapely pyvista matplotlib
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$HOME/the_other_room/cad/.venv"
PY="$(readlink "$SRC/bin/python" || echo python3.12)"
uv venv "$HERE/.venv" --python "$PY" --allow-existing
SP="$HERE/.venv/lib/python3.12/site-packages"
echo "$SRC/lib/python3.12/site-packages" > "$SP/zz_shared_cad_stack.pth"
"$HERE/.venv/bin/python" -c "import build123d, trimesh, manifold3d, shapely; print('ok build123d', build123d.__version__, 'trimesh', trimesh.__version__)"
