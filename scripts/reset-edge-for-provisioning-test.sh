#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo." >&2
  exit 1
fi

if [[ "${1:-}" != "RESET-PROTOTYPE" ]]; then
  echo "This erases all modREEF controller credentials, equipment, schedules, and history." >&2
  echo "Usage: sudo $0 RESET-PROTOTYPE" >&2
  exit 1
fi

DATA_DIR="/var/lib/modreef"
CLOUD_DROP_IN="/etc/systemd/system/modreef-edge.service.d/cloud.conf"

systemctl stop modreef-edge.service
rm -f -- "${CLOUD_DROP_IN}"

if [[ -d "${DATA_DIR}" ]]; then
  find "${DATA_DIR}" -mindepth 1 -maxdepth 1 \
    ! -name factory-identity.json -exec rm -rf -- {} +
fi
install -d -m 0755 -o modreef -g modreef "${DATA_DIR}"
install -d -m 0755 -o modreef -g modreef "${DATA_DIR}/matter"

systemctl daemon-reload
systemctl start modreef-edge.service
sleep 3
/opt/modreef/app/scripts/edge-health-check.sh
echo "Prototype reset complete. This Reef Controller is unclaimed and has no equipment."
