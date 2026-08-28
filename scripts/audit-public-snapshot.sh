#!/usr/bin/env bash
set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_REF="${1:-HEAD}"
GITLEAKS_BINARY="${GITLEAKS_BINARY:-gitleaks}"
TEMPORARY_DIRECTORY="$(mktemp -d "${TMPDIR:-/tmp}/modreef-public-audit.XXXXXX")"
trap 'rm -rf -- "${TEMPORARY_DIRECTORY}"' EXIT

if ! command -v "${GITLEAKS_BINARY}" >/dev/null 2>&1; then
  echo "Gitleaks is required. Run scripts/install-gitleaks.sh first." >&2
  exit 1
fi

ARCHIVE="${TEMPORARY_DIRECTORY}/modreef-public-source.tar.gz"
EXTRACTED_ROOT="${TEMPORARY_DIRECTORY}/source"
mkdir "${EXTRACTED_ROOT}"

"${REPOSITORY_ROOT}/scripts/create-public-snapshot.sh" "${SOURCE_REF}" "${ARCHIVE}"
tar -xzf "${ARCHIVE}" -C "${EXTRACTED_ROOT}"

"${GITLEAKS_BINARY}" dir "${EXTRACTED_ROOT}/modreef" \
  --config "${EXTRACTED_ROOT}/modreef/.gitleaks.toml" \
  --no-banner \
  --redact \
  --exit-code 1

echo "Public snapshot secret scan passed for $(git -C "${REPOSITORY_ROOT}" rev-parse "${SOURCE_REF}^{commit}")."
