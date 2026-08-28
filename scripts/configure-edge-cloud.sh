#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this command with sudo." >&2
  exit 1
fi

if [[ "$#" -ne 2 ]]; then
  echo "Usage: $0 <edge-id> <aquarium-id>" >&2
  exit 1
fi

read -r -s -p "One-time Reef Controller token: " EDGE_TOKEN
printf '\n'

if [[ ! "${EDGE_TOKEN}" =~ ^[A-Za-z0-9_-]{43}$ ]]; then
  echo "Invalid Reef Controller token. Copy the 43-character token exactly once." >&2
  exit 1
fi

for value in "$@" "${EDGE_TOKEN}"; do
  if [[ -z "${value}" || "${value}" == *$'\n'* || "${value}" == *'"'* ]]; then
    echo "Credentials contain unsupported characters." >&2
    exit 1
  fi
done

install -d -m 0750 /etc/systemd/system/modreef-edge.service.d
umask 0077
{
  printf '%s\n' '[Service]'
  printf 'Environment="MODREEF_CLOUD_URL=https://api.modreef.net"\n'
  printf 'Environment="MODREEF_EDGE_ID=%s"\n' "$1"
  printf 'Environment="MODREEF_AQUARIUM_ID=%s"\n' "$2"
  printf 'Environment="MODREEF_EDGE_TOKEN=%s"\n' "${EDGE_TOKEN}"
} > /etc/systemd/system/modreef-edge.service.d/cloud.conf

systemctl daemon-reload
systemctl restart modreef-edge.service
unset EDGE_TOKEN
echo "Reef Controller credentials installed; waiting for startup..."
sleep 3
/opt/modreef/app/scripts/edge-health-check.sh
