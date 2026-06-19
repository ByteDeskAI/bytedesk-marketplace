"""Optional wrapper around official Structurizr CLI when installed."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path


def find_cli() -> str | None:
    for name in ("structurizr", "structurizr.sh", "structurizr-cli"):
        path = shutil.which(name)
        if path:
            return path
    return None


def run_cli(args: list[str], workspace: Path) -> tuple[int, str, str]:
    cli = find_cli()
    if not cli:
        return (
            127,
            "",
            "Structurizr CLI not found. Install from https://github.com/structurizr/cli or use `structurizr lint`.",
        )
    cmd = [cli, *args, "-workspace", str(workspace)]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    return proc.returncode, proc.stdout, proc.stderr