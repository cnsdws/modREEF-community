#!/usr/bin/env bash
set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="${REPOSITORY_ROOT}/.github/workflows/controller-image.yml"

UPLOAD_LINE="$(grep -n -m1 'name: Upload verified community image' "${WORKFLOW}" | cut -d: -f1)"
ATTEST_LINE="$(grep -n -m1 'name: Attest public image provenance' "${WORKFLOW}" | cut -d: -f1)"

[[ -n "${UPLOAD_LINE}" && -n "${ATTEST_LINE}" && "${UPLOAD_LINE}" -lt "${ATTEST_LINE}" ]]
grep -A2 'name: Attest public image provenance' "${WORKFLOW}" \
  | grep -Fq 'if: github.event.repository.private == false'
grep -A4 'name: Generate public Raspberry Pi Imager manifest' "${WORKFLOW}" \
  | grep -Fq "startsWith(github.ref, 'refs/tags/controller-v')"
grep -Fq 'scripts/generate-imager-manifest.mjs' "${WORKFLOW}"
grep -Fq -- '--latest' "${WORKFLOW}"
grep -Fq 'releases/download/${{ github.ref_name }}/modreef-controller-community-arm64.img.xz' "${WORKFLOW}"
grep -Fq 'github.event.repository.private' "${WORKFLOW}"

echo "Controller image workflow artifact safeguards passed."
