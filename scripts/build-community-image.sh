#!/usr/bin/env bash
set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PI_GEN_REPOSITORY="https://github.com/RPi-Distro/pi-gen.git"
PI_GEN_COMMIT="ca8aeed0ae300c2a89f55ce9617d5f96a27e99e5"
NODE_VERSION="v22.23.2"
TINYTUYA_SPEC="tinytuya==1.20.0"
SOURCE_COMMIT="${MODREEF_IMAGE_SOURCE_COMMIT:-$(git -C "${REPOSITORY_ROOT}" rev-parse HEAD)}"
OUTPUT_DIR="${1:-${REPOSITORY_ROOT}/artifacts/controller-image}"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "The bootable image must be built on Linux. Use the Controller image GitHub workflow from macOS." >&2
  exit 1
fi
for command in git docker openssl sha256sum tar; do
  command -v "${command}" >/dev/null || { echo "Missing required command: ${command}" >&2; exit 1; }
done
if [[ ! "${SOURCE_COMMIT}" =~ ^[a-f0-9]{40}$ ]]; then
  echo "MODREEF_IMAGE_SOURCE_COMMIT must resolve to a full Git commit." >&2
  exit 1
fi

BUILD_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/modreef-image-build.XXXXXX")"
trap 'rm -rf -- "${BUILD_ROOT}"' EXIT
PI_GEN_DIR="${BUILD_ROOT}/pi-gen"
git clone --quiet --filter=blob:none --no-checkout "${PI_GEN_REPOSITORY}" "${PI_GEN_DIR}"
git -C "${PI_GEN_DIR}" checkout --quiet "${PI_GEN_COMMIT}"

# GitHub's runner registers ARM64 through docker/setup-qemu-action. The pinned
# pi-gen Docker launcher re-runs dpkg-reconfigure inside its privileged
# container, which replaces that working host registration and makes arch-test
# fail. Guard the upstream line so a future pi-gen change cannot be patched
# silently, then retain the host-managed binfmt registration.
PI_GEN_BINFMT_RECONFIGURE='    dpkg-reconfigure qemu-user-binfmt &&'
grep -Fqx "${PI_GEN_BINFMT_RECONFIGURE}" "${PI_GEN_DIR}/build-docker.sh" || {
  echo "Pinned pi-gen binfmt compatibility patch no longer applies." >&2
  exit 1
}
sed -i '/dpkg-reconfigure qemu-user-binfmt &&/d' "${PI_GEN_DIR}/build-docker.sh"

cp -R "${REPOSITORY_ROOT}/image/pi-gen/stage-modreef" "${PI_GEN_DIR}/stage-modreef"
mkdir -p "${PI_GEN_DIR}/stage-modreef/00-install-modreef/files/modreef-release"
git -C "${REPOSITORY_ROOT}" archive "${SOURCE_COMMIT}" \
  | tar -xf - -C "${PI_GEN_DIR}/stage-modreef/00-install-modreef/files/modreef-release"
touch "${PI_GEN_DIR}/stage2/SKIP_IMAGES"

BUILD_PASSWORD="$(openssl rand -base64 36 | tr -d '\n')"
cat > "${PI_GEN_DIR}/config-modreef" <<EOF
IMG_NAME='modreef-controller'
PI_GEN_RELEASE='modREEF community controller'
RELEASE='trixie'
DEPLOY_COMPRESSION='xz'
COMPRESSION_LEVEL='6'
LOCALE_DEFAULT='en_US.UTF-8'
TARGET_HOSTNAME='modreef-uninitialized'
KEYBOARD_KEYMAP='us'
KEYBOARD_LAYOUT='English (US)'
TIMEZONE_DEFAULT='UTC'
FIRST_USER_NAME='admin'
FIRST_USER_PASS='${BUILD_PASSWORD}'
DISABLE_FIRST_BOOT_USER_RENAME='1'
PASSWORDLESS_SUDO='0'
ENABLE_SSH='0'
PUBKEY_ONLY_SSH='0'
ENABLE_CLOUD_INIT='1'
STAGE_LIST='stage0 stage1 stage2 stage-modreef'
export MODREEF_SOURCE_COMMIT='${SOURCE_COMMIT}'
export MODREEF_NODE_VERSION='${NODE_VERSION}'
export MODREEF_TINYTUYA_SPEC='${TINYTUYA_SPEC}'
EOF

(cd "${PI_GEN_DIR}" && ./build-docker.sh -c config-modreef)
IMAGE="$(bash "${REPOSITORY_ROOT}/scripts/collect-community-image.sh" \
  "${PI_GEN_DIR}/deploy" "${OUTPUT_DIR}")"
cat > "${OUTPUT_DIR}/build-manifest.json" <<EOF
{
  "formatVersion": 1,
  "sourceCommit": "${SOURCE_COMMIT}",
  "piGenCommit": "${PI_GEN_COMMIT}",
  "nodeVersion": "${NODE_VERSION}",
  "tinyTuyaRequirement": "${TINYTUYA_SPEC}",
  "architecture": "arm64",
  "operatingSystem": "Raspberry Pi OS Lite",
  "imagerInitFormat": "cloudinit-rpi",
  "builtAt": "$(date -u +%FT%TZ)"
}
EOF
echo "Built ${IMAGE}"
