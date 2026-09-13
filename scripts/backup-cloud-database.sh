#!/usr/bin/env bash
set -euo pipefail

DATABASE_URL="${MODREEF_DATABASE_URL:-}"
OUTPUT="${1:-modreef-cloud-$(date -u +%Y%m%dT%H%M%SZ).dump}"
if [[ -z "${DATABASE_URL}" ]]; then
  echo "MODREEF_DATABASE_URL is required." >&2
  exit 1
fi
command -v pg_dump >/dev/null || {
  echo "pg_dump is required." >&2
  exit 1
}

umask 077
pg_dump --format=custom --compress=9 --no-owner --no-acl \
  --dbname "${DATABASE_URL}" --file "${OUTPUT}"
sha256sum "${OUTPUT}" > "${OUTPUT}.sha256"
chmod 0600 "${OUTPUT}" "${OUTPUT}.sha256"
echo "Created cloud database backup: ${OUTPUT}"
