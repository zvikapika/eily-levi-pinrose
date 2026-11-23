#!/bin/bash
# One self-contained HTML of the gallery simulator (opens by double-click, no server, no internet).
set -e
cd "$(dirname "$0")/.."
./node_modules/.bin/vite build --config vite.single.config.js
python3 tools/inline_html.py
