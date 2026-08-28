#!/usr/bin/env bash
set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEST_DIRECTORY="$(mktemp -d "${TMPDIR:-/tmp}/modreef-image-artifacts.XXXXXX")"
trap 'rm -rf -- "${TEST_DIRECTORY}"' EXIT

SOURCE_DIRECTORY="${TEST_DIRECTORY}/deploy"
OUTPUT_DIRECTORY="${TEST_DIRECTORY}/artifacts"
mkdir -p "${SOURCE_DIRECTORY}"
printf 'compressed image\n' > \
  "${SOURCE_DIRECTORY}/image_2026-08-27-modreef-controller-community.img.xz"
printf 'image metadata\n' > \
  "${SOURCE_DIRECTORY}/2026-08-27-modreef-controller-community.info"

bash "${REPOSITORY_ROOT}/scripts/collect-community-image.sh" \
  "${SOURCE_DIRECTORY}" "${OUTPUT_DIRECTORY}" >/dev/null

cmp \
  "${SOURCE_DIRECTORY}/image_2026-08-27-modreef-controller-community.img.xz" \
  "${OUTPUT_DIRECTORY}/modreef-controller-community-arm64.img.xz"
cmp \
  "${SOURCE_DIRECTORY}/2026-08-27-modreef-controller-community.info" \
  "${OUTPUT_DIRECTORY}/modreef-controller-community-arm64.info"
(
  cd "${OUTPUT_DIRECTORY}"
  sha256sum --check modreef-controller-community-arm64.img.xz.sha256
)

echo "Community image artifact collection passed."
