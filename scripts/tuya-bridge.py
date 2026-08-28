import json
import os
import sys
from pathlib import Path

import tinytuya


def load_env(path: str) -> None:
    env_path = Path(path)
    if not env_path.exists():
        return

    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key, value)


load_env(
    os.environ.get(
        "MODREEF_ENV_FILE",
        ".env.edge.local",
    ),
)

device = tinytuya.Device(
    dev_id=os.environ["GHOME_WP12_DEVICE_ID"],
    address=os.environ["GHOME_WP12_IP"],
    local_key=os.environ["GHOME_WP12_LOCAL_KEY"],
    version=float(os.environ.get("TUYA_PROTOCOL_VERSION", "3.5")),
)

if len(sys.argv) < 2:
    raise SystemExit("Usage: tuya-bridge.py <status|set|set-multiple>")

if sys.argv[1] == "status":
    response = device.status()
    if "dps" not in response:
        raise SystemExit(json.dumps(response))
    print(json.dumps(response["dps"]))
elif sys.argv[1] == "set":
    if len(sys.argv) != 4:
        raise SystemExit("Usage: tuya-bridge.py set <1-7> <true|false>")
    dps = int(sys.argv[2])
    if dps not in range(1, 8):
        raise SystemExit("DPS must be between 1 and 7")
    value = sys.argv[3].lower() == "true"
    print(json.dumps(device.set_value(dps, value)))
elif sys.argv[1] == "set-multiple":
    if len(sys.argv) != 3:
        raise SystemExit(
            "Usage: tuya-bridge.py set-multiple '<json-object>'"
        )

    values = json.loads(sys.argv[2])
    if not isinstance(values, dict) or not values:
        raise SystemExit("Values must be a non-empty JSON object")

    allowed_dps = set(range(1, 16))
    normalized = {}

    for raw_dps, value in values.items():
        dps = int(raw_dps)
        if dps not in allowed_dps:
            raise SystemExit("DPS must be between 1 and 15")
        if not isinstance(value, (bool, int)):
            raise SystemExit("DPS values must be boolean or integer")
        normalized[str(dps)] = value

    print(json.dumps(device.set_multiple_values(normalized)))
else:
    raise SystemExit(f"Unknown command: {sys.argv[1]}")
