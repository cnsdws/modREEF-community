#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo $0" >&2
  exit 1
fi

JOURNAL_DIR="/var/log/journal"
CONFIG_DIR="/etc/systemd/journald.conf.d"
CONFIG_FILE="${CONFIG_DIR}/modreef-persistent.conf"

install -d -m 2755 -o root -g systemd-journal "${JOURNAL_DIR}"
install -d -m 0755 -o root -g root "${CONFIG_DIR}"
install -m 0644 /dev/stdin "${CONFIG_FILE}" <<'EOF'
[Journal]
Storage=persistent
SystemMaxUse=128M
MaxRetentionSec=30day
Compress=yes
EOF

systemd-tmpfiles --create --prefix "${JOURNAL_DIR}"
systemctl restart systemd-journald.service

test -d "${JOURNAL_DIR}"
grep -q '^Storage=persistent$' "${CONFIG_FILE}"
echo "Persistent system journal enabled (128 MB maximum, 30-day retention)."
