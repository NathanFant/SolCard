#!/usr/bin/env python3
"""
Pre-commit hook that auto-updates the copyright year in the LICENSE file.
"""

import re
import subprocess
from datetime import datetime
from pathlib import Path


def update_license_year():
    license_path = Path(__file__).resolve().parent.parent / "LICENSE"

    if not license_path.exists():
        return

    content = license_path.read_text()
    current_year = str(datetime.now().year)

    updated = re.sub(
        r"(Copyright\s+)\d{4}(\s+TerraByte LLC)",
        rf"\g<1>{current_year}\g<2>",
        content,
    )

    if updated != content:
        license_path.write_text(updated)
        subprocess.run(["git", "add", str(license_path)])
        print(f"Updated LICENSE copyright year to {current_year}")


if __name__ == "__main__":
    update_license_year()
