#!/usr/bin/env python3
"""Fold dist-single/index.html + its JS/CSS into one self-contained HTML file."""
import re
from pathlib import Path

d = Path(__file__).resolve().parent.parent / 'dist-single'
html = (d / 'index.html').read_text()


def js(m):
    src = (d / m.group(1)).read_text().replace('</script', '<\\/script')
    return f'<script type="module">{src}</script>'


html = re.sub(r'<script type="module" crossorigin src="\./([^"]+)"></script>', js, html)
html = re.sub(r'<link rel="stylesheet" crossorigin href="\./([^"]+)">',
              lambda m: f'<style>{(d / m.group(1)).read_text()}</style>', html)
assert 'src="./' not in html and 'href="./assets' not in html, 'unresolved asset'
out = d / 'pinrose_gallery_sim.html'
out.write_text(html)
print(out, out.stat().st_size // 1024, 'KB')
