#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="${MODREEF_DATA_DIR:-/var/lib/modreef}"
SERVICE="${MODREEF_EDGE_SERVICE:-modreef-edge.service}"
SERVICE_USER="${MODREEF_SERVICE_USER:-modreef}"
SERVICE_GROUP="${MODREEF_SERVICE_GROUP:-modreef}"
STOP_SERVICE="${MODREEF_BACKUP_STOP_SERVICE:-1}"
OUTPUT="${1:-/var/backups/modreef/modreef-edge-$(date -u +%Y%m%dT%H%M%SZ).tar.gz}"

if [[ "${EUID}" -ne 0 && "${MODREEF_BACKUP_ALLOW_UNPRIVILEGED:-0}" != "1" ]]; then
  echo "Run with sudo: sudo $0 [output.tar.gz]" >&2
  exit 1
fi
if [[ ! -d "${DATA_DIR}" || ! -f "${DATA_DIR}/modreef.db" ]]; then
  echo "No Reef Controller state database was found in ${DATA_DIR}." >&2
  exit 1
fi

umask 077
mkdir -p "$(dirname "${OUTPUT}")"
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/modreef-edge-backup.XXXXXX")"
EDGE_WAS_ACTIVE=false
cleanup() {
  if [[ "${EDGE_WAS_ACTIVE}" == true ]]; then
    systemctl start "${SERVICE}" || true
  fi
  rm -rf -- "${WORK_DIR}"
}
trap cleanup EXIT

if [[ "${STOP_SERVICE}" == "1" ]] && systemctl is-active --quiet "${SERVICE}"; then
  EDGE_WAS_ACTIVE=true
  systemctl stop "${SERVICE}"
fi

mkdir -p "${WORK_DIR}/data"
rsync -a \
  --exclude='factory-identity.json' \
  --exclude='factory-initialized' \
  --exclude='wifi-provisioned' \
  --exclude='update.request' \
  --exclude='update-status.json' \
  "${DATA_DIR}/" "${WORK_DIR}/data/"

RELEASE_SHA="$(cat "${DATA_DIR}/release.sha256" 2>/dev/null || true)"
HOST_NAME="$(hostname)"
CREATED_AT="$(date -u +%FT%TZ)"
printf '{"schemaVersion":1,"createdAt":"%s","hostname":"%s","releaseSha256":"%s"}\n' \
  "${CREATED_AT}" "${HOST_NAME}" "${RELEASE_SHA}" > "${WORK_DIR}/manifest.json"

tar -czf "${OUTPUT}" -C "${WORK_DIR}" manifest.json data
sha256sum "${OUTPUT}" > "${OUTPUT}.sha256"
chmod 0600 "${OUTPUT}" "${OUTPUT}.sha256"
if [[ "${EUID}" -eq 0 ]] && id "${SERVICE_USER}" >/dev/null 2>&1; then
  chown root:"${SERVICE_GROUP}" "${OUTPUT}" "${OUTPUT}.sha256" 2>/dev/null || true
fi

echo "Created encrypted-storage-sensitive controller backup: ${OUTPUT}"
echo "Store the archive and checksum somewhere private; they contain device and cloud credentials."
