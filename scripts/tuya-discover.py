import ipaddress
import sys

import tinytuya


if len(sys.argv) != 2:
    raise SystemExit("Usage: tuya-discover.py <device-id>")

target = sys.argv[1]
devices = tinytuya.deviceScan(
    verbose=False,
    maxretry=10,
    poll=True,
)

matches = []
for address, info in devices.items():
    discovered_id = (
        info.get("gwId")
        or info.get("id")
        or info.get("devId")
    )

    if discovered_id != target:
        continue

    parsed = ipaddress.ip_address(address)
    if parsed.version == 4 and parsed.is_private:
        matches.append(address)

if len(matches) != 1:
    raise SystemExit(
        f"Expected one private address, found {len(matches)}"
    )

print(matches[0])
