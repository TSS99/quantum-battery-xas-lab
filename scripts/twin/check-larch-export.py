"""Regenerate the twin XDI/Larch pair, run it, and record the Larch reference values."""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

import larch


ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "scripts" / "twin" / "fixtures"
VITE_NODE = ROOT / "node_modules" / "vite-node" / "vite-node.mjs"
ENTRY = ROOT / "scripts" / "twin" / "make-larch-export-fixture.ts"
SCRIPT = FIXTURES / "larch-acquisition.py"


def value(pattern: str, output: str) -> float:
    match = re.search(pattern, output)
    if match is None:
        raise RuntimeError(f"Could not read {pattern!r} from exported script output:\n{output}")
    return float(match.group(1))


subprocess.run(["node", str(VITE_NODE), str(ENTRY)], cwd=ROOT, check=True)
completed = subprocess.run([sys.executable, str(SCRIPT)], cwd=FIXTURES, check=True, text=True, capture_output=True)
fixture = {
    "format": "xaslab-twin-larch-export/1",
    "larchVersion": larch.__version__,
    "xdi": "scripts/twin/fixtures/larch-acquisition.xdi",
    "script": "scripts/twin/fixtures/larch-acquisition.py",
    "result": {
        "e0_eV": value(r"e0:\s*([+\-0-9.eE]+)", completed.stdout),
        "edgeStep": value(r"edge step:\s*([+\-0-9.eE]+)", completed.stdout),
        "peakR_A": value(r"peak:\s*([+\-0-9.eE]+)", completed.stdout),
    },
}
target = ROOT / "src" / "data" / "twin" / "larch-export-fixture.json"
target.write_text(json.dumps(fixture, indent=2) + "\n", encoding="utf-8")
print(completed.stdout, end="")
print(f"wrote {target.relative_to(ROOT)} with xraylarch {larch.__version__}")
