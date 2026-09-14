#!/usr/bin/env bash
set -euo pipefail

SERVICE="modreef-edge.service"
PORT="${MODREEF_PORT:-3000}"

systemctl is-active --quiet "${SERVICE}" || {
  echo "FAIL: ${SERVICE} is not running" >&2
  systemctl --no-pager --full status "${SERVICE}" >&2 || true
  exit 1
}

API_READY=false
API_READY_ATTEMPTS="${MODREEF_HEALTH_READY_ATTEMPTS:-45}"
for ((_attempt = 1; _attempt <= API_READY_ATTEMPTS; _attempt += 1)); do
  if curl --fail --silent --max-time 2 "http://127.0.0.1:${PORT}/health" >/dev/null; then
    API_READY=true
    break
  fi
  sleep 1
done
[[ "${API_READY}" == true ]] || {
  echo "FAIL: local Reef Controller API did not become ready on port ${PORT}" >&2
  exit 1
}

[[ -w /var/lib/modreef ]] || {
  echo "FAIL: /var/lib/modreef is not writable" >&2
  exit 1
}

bluetoothctl show | grep -q 'Powered: yes' || {
  echo "FAIL: Bluetooth controller is not powered" >&2
  exit 1
}

echo "PASS: Reef Controller service, local API, storage, and Bluetooth are ready."
