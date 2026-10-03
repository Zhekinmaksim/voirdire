#!/usr/bin/env python3
"""Publish a labelled demo, or gate real measurements before publishing."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
CHAIN = ROOT / "chain-and-site"
OUT = ROOT / "dist"


def main():
    # Remove stale output even when the new build is rejected.
    if OUT.exists():
        shutil.rmtree(OUT)
    mode = os.environ.get("SITE_MODE", "demo")
    matrix = json.loads((CHAIN / "web/matrix.json").read_text())
    if mode == "demo":
        if matrix.get("provenance", {}).get("kind") != "fixture":
            raise SystemExit("Demo requires fixture provenance. Use SITE_MODE=measured for live data.")
    elif mode == "measured":
        subprocess.run(
            [sys.executable, "scripts/check_matrix.py", "web/matrix.json"],
            cwd=CHAIN, check=True,
        )
    else:
        raise SystemExit("SITE_MODE must be demo or measured")
    subprocess.run([sys.executable, "scripts/build_page.py"], cwd=CHAIN, check=True)
    OUT.mkdir()
    shutil.copy2(CHAIN / "web/index.html", OUT / "index.html")
    shutil.copy2(CHAIN / "web/matrix.json", OUT / "matrix.json")
    print(f"Built {mode} site in {OUT}")


if __name__ == "__main__":
    main()
