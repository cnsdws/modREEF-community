import os
import sys
from pathlib import Path

import tinytuya


def load_env(path: str) -> None:
    for line in Path(path).read_text().splitlines():
        line = line.strip()

        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        os.environ.setdefault(key, value)


if len(sys.argv) != 3:
    raise SystemExit(
        "Usage: python3 scripts/tuya-set-outlet.py <1-6> <on|off>"
    )

outlet = int(sys.argv[1])
state_text = sys.argv[2].lower()

if outlet not in range(1, 7):
    raise SystemExit("Outlet must be between 1 and 6")

if state_text not in {"on", "off"}:
    raise SystemExit("State must be on or off")

load_env(".env.local")

device = tinytuya.Device(
    dev_id=os.environ["GHOME_WP12_DEVICE_ID"],
    address=os.environ["GHOME_WP12_IP"],
    local_key=os.environ["GHOME_WP12_LOCAL_KEY"],
    version=3.5,
)

state = state_text == "on"
response = device.set_value(outlet, state)

print(response)
