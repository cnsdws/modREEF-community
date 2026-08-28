#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIRECTORY="${1:?pi-gen deploy directory is required}"
OUTPUT_DIRECTORY="${2:?artifact output directory is required}"

SOURCE_IMAGE="$(find "${SOURCE_DIRECTORY}" -maxdepth 1 -type f \
  -name '*modreef-controller*.img.xz' -print -quit)"
[[ -n "${SOURCE_IMAGE}" ]] || {
  echo "pi-gen did not produce a modREEF image." >&2
  exit 1
}

mkdir -p "${OUTPUT_DIRECTORY}"
OUTPUT_IMAGE="${OUTPUT_DIRECTORY}/modreef-controller-community-arm64.img.xz"
cp "${SOURCE_IMAGE}" "${OUTPUT_IMAGE}"

SOURCE_INFO="$(find "${SOURCE_DIRECTORY}" -maxdepth 1 -type f \
  -name '*modreef-controller*.info' -print -quit)"
if [[ -n "${SOURCE_INFO}" ]]; then
  cp "${SOURCE_INFO}" "${OUTPUT_DIRECTORY}/modreef-controller-community-arm64.info"
fi

(
  cd "${OUTPUT_DIRECTORY}"
  sha256sum "$(basename "${OUTPUT_IMAGE}")" > "$(basename "${OUTPUT_IMAGE}").sha256"
)

printf '%s\n' "${OUTPUT_IMAGE}"
