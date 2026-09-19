"""The one command that re-takes every timing, meant for an idle box.

    .venv\\Scripts\\python.exe lab\\retime.py            # refuses if a wallpapers leg is running
    .venv\\Scripts\\python.exe lab\\retime.py --anyway   # tags the run beside-a-leg instead

Runs onnxruntime-node (CPU + DirectML), then Chrome over CDP (WebGPU, WASM single-thread,
WASM multi-thread), then the fidelity table. Results overwrite results/*.json, each tagged.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

LAB = Path(__file__).resolve().parents[1]


def leg_running() -> list[str]:
    command = (
        "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match "
        "'fractal-wallpapers|fractal-engine' } | ForEach-Object { $_.ProcessId }"
    )
    out = subprocess.run(
        ["powershell", "-NoProfile", "-Command", command], capture_output=True, text=True
    ).stdout
    return [line for line in out.split() if line.strip()]


def main() -> None:
    busy = leg_running()
    if busy and "--anyway" not in sys.argv:
        sys.exit(
            f"{len(busy)} wallpapers process(es) running ({', '.join(busy[:5])}); "
            "not an idle box. Re-run when it is, or pass --anyway."
        )
    tag = "beside-a-leg" if busy else "idle"
    subprocess.run(
        ["node", "web/node-run.mjs", "--eps", "cpu,dml", "--tag", tag], cwd=LAB, check=True
    )
    subprocess.run(["node", "web/browser-run.mjs", "--tag", tag], cwd=LAB, check=True)
    subprocess.run([sys.executable, "lab/fidelity.py"], cwd=LAB, check=True)
    print(f"timings tagged {tag!r}; table in measured/table.md")


if __name__ == "__main__":
    main()
