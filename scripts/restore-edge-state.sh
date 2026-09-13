#!/usr/bin/env bash
set -euo pipefail

ARCHIVE="${1:-}"
CONFIRMATION="${2:-}"
DATA_DIR="${MODREEF_DATA_DIR:-/var/lib/modreef}"
APP_DIR="${MODREEF_APP_DIR:-/opt/modreef/app}"
SERVICE="${MODREEF_EDGE_SERVICE:-modreef-edge.service}"
SERVICE_USER="${MODREEF_SERVICE_USER:-modreef}"
SERVICE_GROUP="${MODREEF_SERVICE_GROUP:-modreef}"
STOP_SERVICE="${MODREEF_BACKUP_STOP_SERVICE:-1}"

if [[ "${EUID}" -ne 0 && "${MODREEF_BACKUP_ALLOW_UNPRIVILEGED:-0}" != "1" ]]; then
  echo "Run with sudo." >&2
  exit 1
fi
if [[ -z "${ARCHIVE}" || "${CONFIRMATION}" != "RESTORE-CONTROLLER-BACKUP" ]]; then
  echo "Usage: sudo $0 backup.tar.gz RESTORE-CONTROLLER-BACKUP" >&2
  exit 1
fi
if [[ ! -f "${ARCHIVE}" ]]; then
  echo "Backup archive not found: ${ARCHIVE}" >&2
  exit 1
fi
if [[ -f "${ARCHIVE}.sha256" ]]; then
  sha256sum --check --status "${ARCHIVE}.sha256" || {
    echo "Backup checksum verification failed." >&2
    exit 1
  }
fi
if tar -tzf "${ARCHIVE}" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo "Backup contains an unsafe path." >&2
  exit 1
fi

WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/modreef-edge-restore.XXXXXX")"
EDGE_WAS_ACTIVE=false
RESTORE_STARTED=false
cleanup() {
  rm -rf -- "${WORK_DIR}"
}
rollback() {
  if [[ "${RESTORE_STARTED}" == true && -d "${WORK_DIR}/previous" ]]; then
    rsync -a --delete "${WORK_DIR}/previous/" "${DATA_DIR}/" || true
    chown -R "${SERVICE_USER}:${SERVICE_GROUP}" "${DATA_DIR}" 2>/dev/null || true
  fi
  if [[ "${EDGE_WAS_ACTIVE}" == true ]]; then
    systemctl start "${SERVICE}" || true
  fi
  cleanup
}
trap rollback ERR
trap cleanup EXIT

tar -xzf "${ARCHIVE}" -C "${WORK_DIR}"
[[ -f "${WORK_DIR}/manifest.json" && -f "${WORK_DIR}/data/modreef.db" ]] || {
  echo "This is not a complete modREEF controller backup." >&2
  exit 1
}
node -e '
  const manifest = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  if (manifest.schemaVersion !== 1) process.exit(1);
' "${WORK_DIR}/manifest.json" || {
  echo "Unsupported controller backup format." >&2
  exit 1
}

if [[ "${STOP_SERVICE}" == "1" ]] && systemctl is-active --quiet "${SERVICE}"; then
  EDGE_WAS_ACTIVE=true
  systemctl stop "${SERVICE}"
fi
mkdir -p "${WORK_DIR}/previous" "${DATA_DIR}"
rsync -a "${DATA_DIR}/" "${WORK_DIR}/previous/"
RESTORE_STARTED=true

rsync -a --delete \
  --filter='protect factory-identity.json' \
  --filter='protect factory-initialized' \
  --filter='protect wifi-provisioned' \
  --filter='protect release.sha256' \
  --filter='protect release-channel' \
  "${WORK_DIR}/data/" "${DATA_DIR}/"
chown -R "${SERVICE_USER}:${SERVICE_GROUP}" "${DATA_DIR}" 2>/dev/null || true

if [[ "${EDGE_WAS_ACTIVE}" == true ]]; then
  systemctl start "${SERVICE}"
  sleep 3
  "${APP_DIR}/scripts/edge-health-check.sh"
fi
RESTORE_STARTED=false
trap - ERR
echo "Controller state restored. Wi-Fi, operating-system identity, and factory identity were preserved."
