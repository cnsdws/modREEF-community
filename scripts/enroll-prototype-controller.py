#!/usr/bin/env python3
"""Create and install a prototype per-controller setup identity."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import tempfile
from datetime import datetime, timezone


def run(*args: str, input_text: str | None = None) -> str:
    return subprocess.run(
        args,
        check=True,
        text=True,
        input=input_text,
        capture_output=True,
    ).stdout.strip()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("host", help="SSH host, such as modreef-01.local")
    parser.add_argument("label", help="Human label used only on prototype printouts")
    parser.add_argument(
        "--key",
        default=str(Path.home() / ".ssh" / "modreef_factory"),
        help="Factory SSH private key",
    )
    parser.add_argument(
        "--output-dir",
        default="artifacts/factory-labels/private",
        help="Private local manifest directory",
    )
    args = parser.parse_args()

    ssh = ["ssh", "-o", "BatchMode=yes", "-i", args.key, f"admin@{args.host}"]
    serial = run(
        *ssh,
        "tr -d '\\000' </sys/firmware/devicetree/base/serial-number",
    ).lower()
    if not serial or any(character not in "0123456789abcdef" for character in serial):
        raise SystemExit("Controller did not return a valid hardware serial")

    setup_id = serial[-6:].upper()
    claim_secret = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode().rstrip("=")
    created_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    payload = f"modreef://setup?v=1&id={serial}&secret={claim_secret}"
    identity = {
        "version": 1,
        "hardwareSerial": serial,
        "setupId": setup_id,
        "claimSecret": claim_secret,
        "claimSecretHash": hashlib.sha256(claim_secret.encode()).hexdigest(),
        "createdAt": created_at,
    }
    manifest = {
        "version": 1,
        "label": args.label,
        "host": args.host,
        "hardwareSerial": serial,
        "setupId": setup_id,
        "claimSecretHash": identity["claimSecretHash"],
        "setupPayload": payload,
        "createdAt": created_at,
    }

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    os.chmod(output_dir, 0o700)
    manifest_path = output_dir / f"controller-{setup_id.lower()}.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    os.chmod(manifest_path, 0o600)

    with tempfile.NamedTemporaryFile("w", delete=False) as temporary:
        json.dump(identity, temporary, indent=2)
        temporary.write("\n")
        identity_path = temporary.name
    os.chmod(identity_path, 0o600)

    try:
        remote_temp = f"/tmp/modreef-factory-identity-{setup_id.lower()}.json"
        run("scp", "-q", "-i", args.key, identity_path, f"admin@{args.host}:{remote_temp}")
        run(
            *ssh,
            f"sudo install -m 0640 -o root -g modreef {remote_temp} "
            "/var/lib/modreef/factory-identity.json && "
            f"rm -f {remote_temp} && "
            "sudo systemctl restart modreef-controller-onboarding.service",
        )
    finally:
        os.unlink(identity_path)

    print(f"Enrolled {args.label}: setup identifier {setup_id}")
    print(f"Private label manifest: {manifest_path}")


if __name__ == "__main__":
    main()
