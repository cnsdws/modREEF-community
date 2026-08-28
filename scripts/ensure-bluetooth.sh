#!/usr/bin/env bash
set -euo pipefail

/usr/sbin/rfkill unblock bluetooth

for _attempt in {1..10}; do
  if /usr/bin/bluetoothctl show | grep -q 'Powered: yes'; then
    echo "Bluetooth controller is powered."
    exit 0
  fi
  /usr/bin/bluetoothctl power on >/dev/null 2>&1 || true
  sleep 1
done

echo "Bluetooth controller did not become ready." >&2
exit 1
