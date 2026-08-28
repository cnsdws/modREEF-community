import os
from pathlib import Path

import tinytuya


def load_env(path: str) -> None:
    for line in Path(path).read_text().splitlines():
        line = line.strip()

        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        os.environ.setdefault(key, value)


load_env(".env.local")

device = tinytuya.Device(
    dev_id=os.environ["GHOME_WP12_DEVICE_ID"],
    address=os.environ["GHOME_WP12_IP"],
    local_key=os.environ["GHOME_WP12_LOCAL_KEY"],
    version=3.5,
)

response = device.status()

if "dps" not in response:
    raise SystemExit(f"Unable to read device status: {response}")

dps = response["dps"]

status = {
    "outlets": [
        {
            "number": outlet,
            "on": bool(dps.get(str(outlet), False)),
        }
        for outlet in range(1, 7)
    ],
    "usbPowerOn": bool(dps.get("7", False)),
    "voltage": dps.get("20", 0) / 10,
    "raw": {
        key: value
        for key, value in dps.items()
        if key not in {str(number) for number in range(1, 8)} | {"20"}
    },
}

print(status)
