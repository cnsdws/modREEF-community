#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo ./scripts/install-edge.sh" >&2
  exit 1
fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="/opt/modreef/app"
DATA_DIR="/var/lib/modreef"
SERVICE_DIR="/etc/systemd/system/modreef-edge.service.d"
SERVICE_USER="modreef"

if [[ "${SOURCE_DIR}" == "${APP_DIR}" ]]; then
  echo "Run the installer from a staging checkout, not ${APP_DIR}." >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends \
  avahi-daemon avahi-utils bluetooth bluez ca-certificates curl git libbluetooth-dev libudev-dev \
  network-manager python3 python3-venv rfkill rsync xz-utils

"${SOURCE_DIR}/scripts/install-node-runtime.sh"
"${SOURCE_DIR}/scripts/configure-persistent-journal.sh"

if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir /var/lib/modreef --shell /usr/sbin/nologin "${SERVICE_USER}"
fi
usermod -a -G bluetooth "${SERVICE_USER}"

install -d -o root -g root "${APP_DIR}"
install -d -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${DATA_DIR}" "${DATA_DIR}/matter"
rsync -a --delete \
  --exclude='.data/' --exclude='node_modules/' --exclude='.turbo/' \
  "${SOURCE_DIR}/" "${APP_DIR}/"

cd "${APP_DIR}"
if [[ "${MODREEF_IMAGE_BUILD:-0}" == "1" ]]; then
  pnpm --filter '@modreef/edge...' install --frozen-lockfile --prod=false
else
  pnpm install --frozen-lockfile --prod=false
fi
python3 -m venv .venv
.venv/bin/pip install --disable-pip-version-check "${MODREEF_TINYTUYA_SPEC:-tinytuya>=1.17,<2}"

chown -R root:root "${APP_DIR}"
# A factory staging checkout may be created by mktemp with mode 0700. rsync's
# archive mode copies that root-directory mode onto APP_DIR, which would prevent
# the unprivileged service account from entering its working directory.
chmod 0755 "${APP_DIR}"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${DATA_DIR}"
install -m 0644 deploy/edge/modreef-edge.service /etc/systemd/system/modreef-edge.service
install -m 0644 deploy/edge/modreef-bluetooth.service /etc/systemd/system/modreef-bluetooth.service
install -m 0644 deploy/edge/modreef-controller-onboarding.service /etc/systemd/system/modreef-controller-onboarding.service
install -m 0644 deploy/edge/modreef-update.service /etc/systemd/system/modreef-update.service
install -m 0644 deploy/edge/modreef-update.timer /etc/systemd/system/modreef-update.timer
install -m 0644 deploy/edge/modreef-update.path /etc/systemd/system/modreef-update.path
install -m 0644 deploy/edge/modreef-first-boot.service /etc/systemd/system/modreef-first-boot.service
install -m 0644 deploy/edge/modreef.service /etc/avahi/services/modreef.service
install -d -m 0755 /etc/modreef
install -m 0644 deploy/edge/release-public-key.pem /etc/modreef/release-public-key.pem
install -d -m 0750 -o root -g "${SERVICE_USER}" "${SERVICE_DIR}"

systemctl daemon-reload
systemctl enable avahi-daemon.service bluetooth.service NetworkManager.service modreef-bluetooth.service modreef-controller-onboarding.service modreef-edge.service modreef-first-boot.service
systemctl enable modreef-update.timer modreef-update.path

if [[ "${MODREEF_IMAGE_BUILD:-0}" == "1" ]]; then
  echo "modREEF Reef Controller installed into an offline image root."
  exit 0
fi

systemctl start modreef-update.timer modreef-update.path
systemctl restart bluetooth.service
systemctl restart avahi-daemon.service
systemctl restart modreef-bluetooth.service
systemctl restart modreef-controller-onboarding.service
systemctl restart modreef-edge.service

echo "modREEF Reef Controller installed."
echo "Next: sudo ${APP_DIR}/scripts/configure-edge-cloud.sh <edge-id> <aquarium-id>"
systemctl --no-pager --full status modreef-edge.service || true
