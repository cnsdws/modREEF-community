#!/usr/bin/env bash
set -euo pipefail

OUTPUT="${1:-edge-release.tar.gz}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "${ROOT}"
RELEASE_PATHS=(
  package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json
  patches apps/edge deploy scripts packages
)

# GitHub candidates are created from committed objects, so an untracked local
# file can never leak into a release. Container builds have no .git directory;
# GNU tar provides the equivalent deterministic ordering and metadata there.
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git archive --format=tar HEAD -- "${RELEASE_PATHS[@]}" | gzip -n > "${OUTPUT}"
else
  tar \
    --sort=name \
    --mtime='UTC 1970-01-01' \
    --owner=0 \
    --group=0 \
    --numeric-owner \
    -cf - "${RELEASE_PATHS[@]}" \
    | gzip -n > "${OUTPUT}"
fi
