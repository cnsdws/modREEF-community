#!/usr/bin/env bash
set -euo pipefail

SHA="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
URL="https://api.modreef.net/v1/releases/edge/archive"
PARSED="$(
  printf '{"sha256":"%s","url":"%s"}\n' "${SHA}" "${URL}" \
    | bash scripts/update-edge.sh --parse-manifest
)"
[[ "${PARSED}" == "${SHA} ${URL} unsigned" ]]

SIGNATURE="$(printf 'a%.0s' {1..86})=="
SIGNED_PARSED="$(
  printf '{"sha256":"%s","url":"%s","signature":"%s"}\n' "${SHA}" "${URL}" "${SIGNATURE}" \
    | bash scripts/update-edge.sh --parse-manifest
)"
[[ "${SIGNED_PARSED}" == "${SHA} ${URL} ${SIGNATURE}" ]]

if printf '{"sha256":"bad","url":"http://insecure.invalid/archive"}\n' \
  | bash scripts/update-edge.sh --parse-manifest >/dev/null 2>&1; then
  echo "Invalid release manifest was accepted." >&2
  exit 1
fi

TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/modreef-update-test.XXXXXX")"
trap 'rm -rf -- "${TEST_ROOT}"' EXIT
mkdir -p \
  "${TEST_ROOT}/source/apps/edge" \
  "${TEST_ROOT}/destination/apps/stale/node_modules" \
  "${TEST_ROOT}/destination/.git" \
  "${TEST_ROOT}/destination/.venv"
printf 'edge\n' > "${TEST_ROOT}/source/apps/edge/package.json"
printf 'keep\n' > "${TEST_ROOT}/destination/.git/config"
printf 'keep\n' > "${TEST_ROOT}/destination/.venv/marker"
printf 'remove\n' > "${TEST_ROOT}/destination/apps/stale/node_modules/file"

rsync -a --delete --delete-excluded \
  --filter='protect .git/' --filter='protect .data/' --filter='protect .venv/' \
  --exclude='.git/' --exclude='.data/' --exclude='.venv/' \
  --exclude='node_modules/' --exclude='.turbo/' \
  "${TEST_ROOT}/source/" "${TEST_ROOT}/destination/"

[[ -f "${TEST_ROOT}/destination/.git/config" ]]
[[ -f "${TEST_ROOT}/destination/.venv/marker" ]]
[[ ! -e "${TEST_ROOT}/destination/apps/stale" ]]
[[ -f "${TEST_ROOT}/destination/apps/edge/package.json" ]]

# A legacy controller may not have the production service identity yet. The
# updater must create it before installing the production systemd unit.
grep -q 'ensure_service_user' scripts/update-edge.sh
grep -q 'useradd --system --create-home --home-dir /var/lib/modreef' scripts/update-edge.sh

# Runtime startup must not invoke pnpm: pnpm may attempt package-manager
# metadata writes, while the production service deliberately mounts APP_DIR
# read-only through ProtectSystem=full.
grep -q 'ExecStart=/opt/modreef/app/apps/edge/node_modules/.bin/tsx src/index.ts' \
  deploy/edge/modreef-edge.service
if grep -q '^ExecStart=.*pnpm' deploy/edge/modreef-edge.service; then
  echo "Production Edge service still invokes pnpm at runtime." >&2
  exit 1
fi

# Matter commissioning opens a raw Bluetooth HCI socket. Keep the runtime
# unprivileged, but grant only the two network capabilities required by Noble.
grep -q '^AmbientCapabilities=CAP_NET_ADMIN CAP_NET_RAW$' \
  deploy/edge/modreef-edge.service
grep -q '^CapabilityBoundingSet=CAP_NET_ADMIN CAP_NET_RAW$' \
  deploy/edge/modreef-edge.service

# An authenticated Edge command creates this root-owned service trigger; the
# application process never receives general sudo or systemd privileges.
grep -q '^PathExists=/var/lib/modreef/update.request$' deploy/edge/modreef-update.path
grep -q '^Unit=modreef-update.service$' deploy/edge/modreef-update.path
grep -q 'modreef-update.path' scripts/update-edge.sh
grep -q 'RELEASE_CHANNEL.*staging' scripts/update-edge.sh
grep -q '/v1/releases/edge/staging/latest' scripts/update-edge.sh
grep -q '"releaseChannel":"%s"' scripts/update-edge.sh
grep -q 'openssl pkeyutl -verify -pubin -rawin' scripts/update-edge.sh
grep -q 'MODREEF_REQUIRE_SIGNED_RELEASES' scripts/update-edge.sh
grep -q 'deploy/edge/release-public-key.pem /etc/modreef/release-public-key.pem' scripts/update-edge.sh
grep -q 'deploy/edge/release-public-key.pem /etc/modreef/release-public-key.pem' scripts/install-edge.sh
openssl pkey -pubin -in deploy/edge/release-public-key.pem -noout

# Sanitized clones must get unique SSH host keys. Prototype images explicitly
# retain the factory key; customer images explicitly disable remote access.
grep -q '^ssh-keygen -A$' scripts/initialize-edge-first-boot.sh
grep -q 'authorized_keys' scripts/initialize-edge-first-boot.sh
grep -q 'systemctl start ssh.service' scripts/initialize-edge-first-boot.sh
grep -q 'systemctl stop ssh.service' scripts/initialize-edge-first-boot.sh
if grep -Eq 'systemctl (enable|disable).*ssh\.service' scripts/initialize-edge-first-boot.sh; then
  echo "First boot must not change SSH enablement from inside systemd." >&2
  exit 1
fi
if grep -q 'network-pre.target' deploy/edge/modreef-first-boot.service; then
  echo "First boot must not block the network-pre target." >&2
  exit 1
fi
grep -q 'modreef-controller-onboarding.service' deploy/edge/modreef-first-boot.service
grep -q 'Cannot preserve factory access' scripts/prepare-edge-image.sh
grep -q "127\\.0\\.1\\.1" scripts/initialize-edge-first-boot.sh
grep -q 'systemctl restart avahi-daemon.service' scripts/initialize-edge-first-boot.sh
