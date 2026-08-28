#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/modreef/app"
CHANNEL_FILE="/var/lib/modreef/release-channel"
RELEASE_CHANNEL="$(cat "${CHANNEL_FILE}" 2>/dev/null || printf 'production')"
if [[ "${RELEASE_CHANNEL}" != "staging" ]]; then
  RELEASE_CHANNEL="production"
fi
if [[ "${RELEASE_CHANNEL}" == "staging" ]]; then
  DEFAULT_RELEASE_API="https://api.modreef.net/v1/releases/edge/staging/latest"
else
  DEFAULT_RELEASE_API="https://api.modreef.net/v1/releases/edge/latest"
fi
RELEASE_API="${MODREEF_RELEASE_API:-${DEFAULT_RELEASE_API}}"
CURRENT_FILE="/var/lib/modreef/release.sha256"
STATUS_FILE="/var/lib/modreef/update-status.json"
WORK_DIR="/var/tmp/modreef-update"
ARCHIVE="${WORK_DIR}/release.tar.gz"
STAGING="${WORK_DIR}/staging"
BACKUP="${WORK_DIR}/backup"
SERVICE_USER="modreef"

write_update_status() {
  local status="$1"
  local message="$2"
  local target="${3:-}"
  local succeeded="${4:-}"
  local installed
  local checked_at
  installed="$(cat "${CURRENT_FILE}" 2>/dev/null || true)"
  checked_at="$(date --iso-8601=seconds)"
  printf '{"status":"%s","installedRelease":"%s","targetRelease":"%s","lastCheckedAt":"%s","lastSucceededAt":"%s","message":"%s","automaticUpdatesEnabled":true,"releaseChannel":"%s"}\n' \
    "${status}" "${installed}" "${target}" "${checked_at}" "${succeeded}" "${message}" "${RELEASE_CHANNEL}" > "${STATUS_FILE}"
  chown "${SERVICE_USER}:${SERVICE_USER}" "${STATUS_FILE}" 2>/dev/null || true
  chmod 0644 "${STATUS_FILE}"
}

ensure_service_user() {
  if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
    useradd --system --create-home --home-dir /var/lib/modreef \
      --shell /usr/sbin/nologin "${SERVICE_USER}"
  fi
  if getent group bluetooth >/dev/null 2>&1; then
    usermod -a -G bluetooth "${SERVICE_USER}"
  fi
  install -d -o "${SERVICE_USER}" -g "${SERVICE_USER}" /var/lib/modreef
  chown -R "${SERVICE_USER}:${SERVICE_USER}" /var/lib/modreef
}

migrate_device_credentials() {
  local legacy_path="${APP_DIR}/.env.edge.local"
  local durable_path="/var/lib/modreef/device-credentials.env"
  if [[ -f "${legacy_path}" && ! -e "${durable_path}" ]]; then
    install -o "${SERVICE_USER}" -g "${SERVICE_USER}" -m 0600 \
      "${legacy_path}" "${durable_path}"
  fi
  rm -f -- "${legacy_path}"
}

parse_manifest() {
  node -e '
    const value = JSON.parse(process.env.MANIFEST_JSON);
    if (!/^[a-f0-9]{64}$/.test(value.sha256) || !/^https:\/\//.test(value.url)) process.exit(1);
    process.stdout.write(`${value.sha256} ${value.url}\n`);
  '
}

if [[ "${1:-}" == "--parse-manifest" ]]; then
  MANIFEST_JSON="$(cat)" parse_manifest
  exit
fi

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this command with sudo." >&2
  exit 1
fi

# Older development controllers ran as the interactive admin account. Ensure
# the locked-down production service identity exists before installing a unit
# that references it, so a qualified update cannot leave the runtime in a
# systemd 217/USER restart loop.
ensure_service_user
migrate_device_credentials
write_update_status "checking" "Checking for a qualified controller release"

mkdir -p "${WORK_DIR}"
MANIFEST="$(curl --fail --silent --show-error --max-time 15 "${RELEASE_API}")" || {
  write_update_status "failed" "The qualified release service could not be reached"
  echo "Qualified release check unavailable; starting installed local controller." >&2
  exit 0
}
read -r TARGET_SHA RELEASE_URL < <(
  MANIFEST_JSON="${MANIFEST}" parse_manifest
) || {
  write_update_status "failed" "The qualified release manifest was invalid"
  echo "Qualified release manifest is invalid; starting installed local controller." >&2
  exit 0
}

CURRENT_SHA="$(cat "${CURRENT_FILE}" 2>/dev/null || true)"
if [[ "${CURRENT_SHA}" == "${TARGET_SHA}" ]]; then
  write_update_status "up-to-date" "Controller software is up to date" "${TARGET_SHA}"
  echo "Reef Controller already has the current qualified release."
  exit 0
fi

write_update_status "installing" "Installing qualified controller software" "${TARGET_SHA}"

curl --fail --silent --show-error --location --max-time 180 \
  "${RELEASE_URL}" -o "${ARCHIVE}"
echo "${TARGET_SHA}  ${ARCHIVE}" | sha256sum --check --status || {
  echo "Qualified release checksum verification failed." >&2
  exit 1
}

rm -rf -- "${STAGING}" "${BACKUP}"
mkdir -p "${STAGING}" "${BACKUP}"
tar -xzf "${ARCHIVE}" -C "${STAGING}"
[[ -f "${STAGING}/pnpm-lock.yaml" && -f "${STAGING}/apps/edge/package.json" ]] || {
  echo "Qualified release archive is incomplete." >&2
  exit 1
}

rsync -a --delete \
  --exclude='.git/' --exclude='.data/' --exclude='.venv/' \
  --exclude='node_modules/' --exclude='.turbo/' \
  "${APP_DIR}/" "${BACKUP}/"

EDGE_WAS_ACTIVE=false
rollback() {
  write_update_status "failed" "Update failed; the previous controller release was restored" "${TARGET_SHA}"
  echo "Qualified update failed; restoring the previous controller source." >&2
  rsync -a --delete --delete-excluded \
    --filter='protect .git/' --filter='protect .data/' --filter='protect .venv/' \
    --exclude='.git/' --exclude='.data/' --exclude='.venv/' \
    --exclude='node_modules/' --exclude='.turbo/' \
    "${BACKUP}/" "${APP_DIR}/"
  cd "${APP_DIR}"
  pnpm install --frozen-lockfile --prod=false || true
  [[ "${EDGE_WAS_ACTIVE}" == true ]] && systemctl start modreef-edge.service || true
}
trap rollback ERR

if systemctl is-active --quiet modreef-edge.service; then
  EDGE_WAS_ACTIVE=true
  systemctl stop modreef-edge.service
fi

rsync -a --delete --delete-excluded \
  --filter='protect .git/' --filter='protect .data/' --filter='protect .venv/' \
  --exclude='.git/' --exclude='.data/' --exclude='.venv/' \
  --exclude='node_modules/' --exclude='.turbo/' \
  "${STAGING}/" "${APP_DIR}/"
cd "${APP_DIR}"
pnpm install --frozen-lockfile --prod=false
if [[ -x .venv/bin/pip ]]; then
  .venv/bin/pip install --disable-pip-version-check 'tinytuya>=1.17,<2'
fi
chown -R root:root "${APP_DIR}"
chmod 0755 "${APP_DIR}"
install -m 0644 deploy/edge/modreef-edge.service /etc/systemd/system/modreef-edge.service
install -m 0644 deploy/edge/modreef-bluetooth.service /etc/systemd/system/modreef-bluetooth.service
install -m 0644 deploy/edge/modreef-controller-onboarding.service /etc/systemd/system/modreef-controller-onboarding.service
install -m 0644 deploy/edge/modreef-update.service /etc/systemd/system/modreef-update.service
install -m 0644 deploy/edge/modreef-update.timer /etc/systemd/system/modreef-update.timer
install -m 0644 deploy/edge/modreef-update.path /etc/systemd/system/modreef-update.path
install -m 0644 deploy/edge/modreef-first-boot.service /etc/systemd/system/modreef-first-boot.service
if [[ -d /etc/avahi/services ]]; then
  install -m 0644 deploy/edge/modreef.service /etc/avahi/services/modreef.service
  systemctl restart avahi-daemon.service
fi
systemctl daemon-reload
systemctl enable modreef-controller-onboarding.service >/dev/null
systemctl enable --now modreef-update.timer modreef-update.path >/dev/null

if [[ "${EDGE_WAS_ACTIVE}" == true ]]; then
  systemctl start modreef-edge.service
  sleep 3
  "${APP_DIR}/scripts/edge-health-check.sh"
fi
printf '%s\n' "${TARGET_SHA}" > "${CURRENT_FILE}"
chown "${SERVICE_USER}:${SERVICE_USER}" "${CURRENT_FILE}"
write_update_status "succeeded" "Controller software updated successfully" "${TARGET_SHA}" "$(date --iso-8601=seconds)"
trap - ERR
echo "Installed qualified Reef Controller release ${TARGET_SHA:0:12}."
