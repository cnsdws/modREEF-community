#!/usr/bin/env bash
set -euo pipefail

VERSION="8.30.1"
DESTINATION="${1:-/tmp/modreef-tools/gitleaks}"
OS="$(uname -s)"
ARCH="$(uname -m)"

case "${OS}/${ARCH}" in
  Darwin/arm64)
    ASSET="gitleaks_${VERSION}_darwin_arm64.tar.gz"
    SHA256="b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5"
    ;;
  Darwin/x86_64)
    ASSET="gitleaks_${VERSION}_darwin_x64.tar.gz"
    SHA256="dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709"
    ;;
  Linux/x86_64)
    ASSET="gitleaks_${VERSION}_linux_x64.tar.gz"
    SHA256="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
    ;;
  Linux/aarch64|Linux/arm64)
    ASSET="gitleaks_${VERSION}_linux_arm64.tar.gz"
    SHA256="e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080"
    ;;
  *)
    echo "Unsupported Gitleaks platform: ${OS}/${ARCH}" >&2
    exit 1
    ;;
esac

TEMPORARY_DIRECTORY="$(mktemp -d "${TMPDIR:-/tmp}/modreef-gitleaks.XXXXXX")"
trap 'rm -rf -- "${TEMPORARY_DIRECTORY}"' EXIT
ARCHIVE="${TEMPORARY_DIRECTORY}/${ASSET}"
URL="https://github.com/gitleaks/gitleaks/releases/download/v${VERSION}/${ASSET}"

curl --fail --location --silent --show-error "${URL}" --output "${ARCHIVE}"

if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_SHA256="$(sha256sum "${ARCHIVE}" | awk '{print $1}')"
else
  ACTUAL_SHA256="$(shasum -a 256 "${ARCHIVE}" | awk '{print $1}')"
fi

if [[ "${ACTUAL_SHA256}" != "${SHA256}" ]]; then
  echo "Gitleaks checksum mismatch for ${ASSET}." >&2
  exit 1
fi

mkdir -p "$(dirname "${DESTINATION}")"
tar -xzf "${ARCHIVE}" -C "${TEMPORARY_DIRECTORY}" gitleaks
install -m 0755 "${TEMPORARY_DIRECTORY}/gitleaks" "${DESTINATION}"
"${DESTINATION}" version
