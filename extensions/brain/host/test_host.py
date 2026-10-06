#!/usr/bin/env python3
"""Drive brain_fill_host.py over its real stdio protocol, without Chrome."""

import json
import struct
import subprocess
import sys
from pathlib import Path

HOST = Path(__file__).with_name("brain_fill_host.py")

REQUEST = {
    "type": "fill",
    "engine": sys.argv[1] if len(sys.argv) > 1 else "claude",
    # Empty means "whatever ~/.obsidian-wiki/config points at", same as the popup.
    "vault": sys.argv[2] if len(sys.argv) > 2 else "",
    "form": {
        "url": "https://example.com/vendor-review",
        "title": "Vendor Security Review — AI Coding Agent Tooling",
        "fields": [
            {"id": "f0", "label": "Product name", "type": "text", "maxLength": 80},
            {"id": "f1", "label": "What does the product do?", "type": "textarea"},
            {"id": "f2", "label": "What category of security tool is it?", "type": "select",
             "options": ["Runtime agent security", "SAST", "Network firewall", "SIEM"]},
            {"id": "f3", "label": "Which competing products were evaluated?", "type": "textarea"},
            {"id": "f4", "label": "Primary threat model addressed", "type": "textarea"},
            {"id": "f5", "label": "Applicant home address", "type": "text"},
            {"id": "f6", "label": "Does it integrate with MCP?", "type": "select",
             "options": ["Yes", "No", "Unknown"]},
        ],
    },
}


def main() -> None:
    request = {"type": "vaults"} if sys.argv[1:2] == ["vaults"] else REQUEST
    payload = json.dumps(request).encode()
    process = subprocess.run(
        [sys.executable, str(HOST)],
        input=struct.pack("<I", len(payload)) + payload,
        capture_output=True,
        timeout=300,
    )

    if process.stderr:
        print("stderr:", process.stderr.decode()[:2000])
    if len(process.stdout) < 4:
        print("no response; exit code", process.returncode)
        return

    (length,) = struct.unpack("<I", process.stdout[:4])
    print(json.dumps(json.loads(process.stdout[4:4 + length]), indent=2))


if __name__ == "__main__":
    main()
