#!/usr/bin/env python3
"""Bundle the known local UI modules for WKWebView's file:// loader.

Chrome continues to use the original ES modules. This packaging step only
creates a classic-script sibling within the companion's copied resources.
"""
from pathlib import Path
import re
import sys

resources = Path(sys.argv[1])
core = (resources / 'core.mjs').read_text()
palette = (resources / 'palette.js').read_text()
document = (resources / 'palette.html').read_text()

core = re.sub(r'^export\s+(?=(?:async\s+)?function\b|(?:const|let|var)\b)', '', core, flags=re.M)
palette, count = re.subn(r'\Aimport\s*\{.*?\}\s*from\s*[\'"]\./core\.mjs[\'"];\s*', '', palette, count=1, flags=re.S)
if count != 1 or re.search(r'^\s*(?:import|export)\b', core + '\n' + palette, flags=re.M):
    raise SystemExit('Native UI bundling requires the known local core.mjs import layout.')

old = '<script type="module" src="palette.js"></script>'
new = '<script defer src="palette-native.js"></script>'
if document.count(old) != 1:
    raise SystemExit('Could not identify the palette module script in HTML.')
(resources / 'palette-native.js').write_text("(() => {\n'use strict';\n" + core + '\n' + palette + '\n})();\n')
(resources / 'palette-native.html').write_text(document.replace(old, new))
