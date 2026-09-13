#!/usr/bin/env bash
set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="${REPOSITORY_ROOT}/.github/workflows/controller-image.yml"
RELEASE_CANDIDATE_WORKFLOW="${REPOSITORY_ROOT}/.github/workflows/release-candidate.yml"

UPLOAD_LINE="$(grep -n -m1 'name: Upload verified community image' "${WORKFLOW}" | cut -d: -f1)"
ATTEST_LINE="$(grep -n -m1 'name: Attest public image provenance' "${WORKFLOW}" | cut -d: -f1)"

[[ -n "${UPLOAD_LINE}" && -n "${ATTEST_LINE}" && "${UPLOAD_LINE}" -lt "${ATTEST_LINE}" ]]
grep -A2 'name: Attest public image provenance' "${WORKFLOW}" \
  | grep -Fq 'if: github.event.repository.private == false'
grep -A4 'name: Generate public Raspberry Pi Imager manifest' "${WORKFLOW}" \
  | grep -Fq "startsWith(github.ref, 'refs/tags/controller-v')"
grep -Fq 'scripts/generate-imager-manifest.mjs' "${WORKFLOW}"
grep -Fq -- '--prerelease' "${WORKFLOW}"
if grep -Fq -- '--latest' "${WORKFLOW}"; then
  echo "Tagged controller images must remain prereleases until hardware acceptance." >&2
  exit 1
fi
grep -Fq 'releases/download/${{ github.ref_name }}/modreef-controller-community-arm64.img.xz' "${WORKFLOW}"
grep -Fq 'github.event.repository.private' "${WORKFLOW}"

PUBLISH_LINE="$(grep -n -m1 'name: Publish candidate to the staging channel' "${RELEASE_CANDIDATE_WORKFLOW}" | cut -d: -f1)"
MIRROR_LINE="$(grep -n -m1 'name: Mirror candidate in GitHub Actions' "${RELEASE_CANDIDATE_WORKFLOW}" | cut -d: -f1)"
[[ -n "${PUBLISH_LINE}" && -n "${MIRROR_LINE}" && "${PUBLISH_LINE}" -lt "${MIRROR_LINE}" ]]
grep -A2 'name: Mirror candidate in GitHub Actions' "${RELEASE_CANDIDATE_WORKFLOW}" \
  | grep -Fq 'continue-on-error: true'
grep -A7 'name: Mirror candidate in GitHub Actions' "${RELEASE_CANDIDATE_WORKFLOW}" \
  | grep -Fq 'retention-days: 7'

echo "Controller image and release candidate artifact safeguards passed."
