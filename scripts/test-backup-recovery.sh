#!/usr/bin/env bash
set -euo pipefail

bash -n scripts/backup-edge-state.sh scripts/restore-edge-state.sh \
  scripts/backup-cloud-database.sh scripts/restore-cloud-database.sh

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/modreef-backup-test.XXXXXX")"
trap 'rm -rf -- "${TEST_ROOT}"' EXIT
mkdir -p "${TEST_ROOT}/source/matter" "${TEST_ROOT}/restored"
printf 'database-state\n' > "${TEST_ROOT}/source/modreef.db"
printf 'device-secret\n' > "${TEST_ROOT}/source/device-credentials.env"
printf 'matter-state\n' > "${TEST_ROOT}/source/matter/state"
printf 'do-not-copy\n' > "${TEST_ROOT}/source/factory-identity.json"

MODREEF_DATA_DIR="${TEST_ROOT}/source" \
MODREEF_BACKUP_ALLOW_UNPRIVILEGED=1 \
MODREEF_BACKUP_STOP_SERVICE=0 \
MODREEF_SERVICE_USER="$(id -un)" \
MODREEF_SERVICE_GROUP="$(id -gn)" \
  bash scripts/backup-edge-state.sh "${TEST_ROOT}/edge.tar.gz"

tar -tzf "${TEST_ROOT}/edge.tar.gz" | grep -q '^manifest.json$'
tar -tzf "${TEST_ROOT}/edge.tar.gz" | grep -q '^data/modreef.db$'
if tar -tzf "${TEST_ROOT}/edge.tar.gz" | grep -q 'factory-identity.json'; then
  echo "Hardware-bound factory identity leaked into a backup." >&2
  exit 1
fi

printf 'unique-new-controller\n' > "${TEST_ROOT}/restored/factory-identity.json"
MODREEF_DATA_DIR="${TEST_ROOT}/restored" \
MODREEF_BACKUP_ALLOW_UNPRIVILEGED=1 \
MODREEF_BACKUP_STOP_SERVICE=0 \
MODREEF_SERVICE_USER="$(id -un)" \
MODREEF_SERVICE_GROUP="$(id -gn)" \
  bash scripts/restore-edge-state.sh \
    "${TEST_ROOT}/edge.tar.gz" RESTORE-CONTROLLER-BACKUP

grep -q 'database-state' "${TEST_ROOT}/restored/modreef.db"
grep -q 'device-secret' "${TEST_ROOT}/restored/device-credentials.env"
grep -q 'matter-state' "${TEST_ROOT}/restored/matter/state"
grep -q 'unique-new-controller' "${TEST_ROOT}/restored/factory-identity.json"

if bash scripts/restore-edge-state.sh "${TEST_ROOT}/edge.tar.gz" WRONG \
  >/dev/null 2>&1; then
  echo "Restore accepted an invalid confirmation phrase." >&2
  exit 1
fi
