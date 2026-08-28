#!/usr/bin/env bash
set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_REF="${1:-HEAD}"
OUTPUT_PATH="${2:-${REPOSITORY_ROOT}/modreef-public-source.tar.gz}"
SOURCE_COMMIT="$(git -C "${REPOSITORY_ROOT}" rev-parse --verify "${SOURCE_REF}^{commit}")"
OUTPUT_DIRECTORY="$(dirname "${OUTPUT_PATH}")"

if [[ -e "${OUTPUT_PATH}" ]]; then
  echo "Refusing to overwrite existing snapshot: ${OUTPUT_PATH}" >&2
  exit 1
fi

TEMPORARY_PATH="$(mktemp "${OUTPUT_DIRECTORY}/.modreef-public-source.XXXXXX.tar.gz")"
trap 'rm -f -- "${TEMPORARY_PATH}"' EXIT

git -C "${REPOSITORY_ROOT}" archive \
  --format=tar.gz \
  --prefix=modreef/ \
  --output="${TEMPORARY_PATH}" \
  "${SOURCE_COMMIT}"

ARCHIVE_LIST="$(tar -tzf "${TEMPORARY_PATH}")"
FORBIDDEN_PATTERN='(^|/)(node_modules|\.turbo|\.expo|\.git|tmp|factory-images)(/|$)|androguard\.log$|(^|/)(ghome-scan|ghome-unplugged)\.json$|factory-labels/private|(^|/)\.DS_Store$'
FORBIDDEN_PATHS="$(printf '%s\n' "${ARCHIVE_LIST}" | grep -E "${FORBIDDEN_PATTERN}" || true)"

if [[ -n "${FORBIDDEN_PATHS}" ]]; then
  echo "Public snapshot contains forbidden paths:" >&2
  printf '%s\n' "${FORBIDDEN_PATHS}" >&2
  exit 1
fi

for required_path in .gitleaks.toml LICENSE NOTICE THIRD_PARTY_NOTICES.md SECURITY.md CONTRIBUTING.md CODE_OF_CONDUCT.md; do
  # A quiet grep exits as soon as it finds a match. With pipefail enabled that
  # can give the producer SIGPIPE on large archives and falsely report the
  # required file as missing. Feed grep directly instead.
  if ! grep -qx "modreef/${required_path}" <<< "${ARCHIVE_LIST}"; then
    echo "Public snapshot is missing ${required_path}." >&2
    exit 1
  fi
done

mv "${TEMPORARY_PATH}" "${OUTPUT_PATH}"
trap - EXIT
echo "Created public source snapshot from ${SOURCE_COMMIT}."
echo "Archive: ${OUTPUT_PATH}"
echo "This verifies paths only; run secret scanning and manual review before publication."
