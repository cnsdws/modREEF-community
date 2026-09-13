#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
scratch_directory="$(mktemp -d)"
trap 'rm -rf "$scratch_directory"' EXIT

mkdir -p \
  "$scratch_directory/scripts" \
  "$scratch_directory/packages/device-integrations/src" \
  "$scratch_directory/docs/device-profiles"
cp "$repository_root/scripts/create-device-integration.mjs" "$scratch_directory/scripts/"
cp "$repository_root/packages/device-integrations/package.json" \
  "$scratch_directory/packages/device-integrations/"
cp "$repository_root/packages/device-integrations/src/index.ts" \
  "$scratch_directory/packages/device-integrations/src/"

(
  cd "$scratch_directory"
  node scripts/create-device-integration.mjs acme-test
  test -f packages/driver-acme-test/src/index.ts
  test -f packages/driver-acme-test/src/integration.ts
  test -f packages/driver-acme-test/test/integration.test.ts
  test -f docs/device-profiles/acme-test.md
  grep -q 'acmeTestIntegration' packages/device-integrations/src/index.ts
  grep -q '@modreef/driver-acme-test' packages/device-integrations/package.json
)

echo "PASS: device integration generator created and registered a complete scaffold."
