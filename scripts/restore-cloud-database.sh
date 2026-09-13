#!/usr/bin/env bash
set -euo pipefail

ARCHIVE="${1:-}"
CONFIRMATION="${2:-}"
DATABASE_URL="${MODREEF_DATABASE_URL:-}"
if [[ -z "${ARCHIVE}" || "${CONFIRMATION}" != "RESTORE-INTO-EMPTY-DATABASE" ]]; then
  echo "Usage: MODREEF_DATABASE_URL=... $0 backup.dump RESTORE-INTO-EMPTY-DATABASE" >&2
  exit 1
fi
if [[ -z "${DATABASE_URL}" ]]; then
  echo "MODREEF_DATABASE_URL is required." >&2
  exit 1
fi
command -v pg_restore >/dev/null || {
  echo "pg_restore is required." >&2
  exit 1
}
if [[ -f "${ARCHIVE}.sha256" ]]; then
  sha256sum --check --status "${ARCHIVE}.sha256" || {
    echo "Backup checksum verification failed." >&2
    exit 1
  }
fi

# Deliberately omit --clean. Restoration must target a newly created empty
# database so this command cannot silently overwrite the live service.
pg_restore --exit-on-error --no-owner --no-acl \
  --dbname "${DATABASE_URL}" "${ARCHIVE}"
echo "Cloud database restored into the empty target database."
