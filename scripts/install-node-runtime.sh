#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this command with sudo." >&2
  exit 1
fi

if command -v node >/dev/null && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)'; then
  echo "Node.js $(node --version) already satisfies the Reef Controller requirement."
  exit 0
fi

case "$(uname -m)" in
  aarch64|arm64) NODE_ARCH="arm64" ;;
  x86_64|amd64) NODE_ARCH="x64" ;;
  *) echo "Unsupported Node.js architecture: $(uname -m)" >&2; exit 1 ;;
esac

NODE_VERSION="${MODREEF_NODE_VERSION:-latest-v22.x}"
if [[ ! "${NODE_VERSION}" =~ ^(latest-v22\.x|v22\.[0-9]+\.[0-9]+)$ ]]; then
  echo "Unsupported Node.js 22 release selector: ${NODE_VERSION}" >&2
  exit 1
fi
NODE_BASE_URL="https://nodejs.org/download/release/${NODE_VERSION}"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT

curl --fail --location --silent --show-error \
  "${NODE_BASE_URL}/SHASUMS256.txt" -o "${WORK_DIR}/SHASUMS256.txt"
NODE_ARCHIVE="$(awk -v architecture="linux-${NODE_ARCH}.tar.xz" '$2 ~ architecture "$" { print $2; exit }' "${WORK_DIR}/SHASUMS256.txt")"
if [[ -z "${NODE_ARCHIVE}" ]]; then
  echo "Could not locate the Node.js 22 ${NODE_ARCH} archive." >&2
  exit 1
fi

curl --fail --location --silent --show-error \
  "${NODE_BASE_URL}/${NODE_ARCHIVE}" -o "${WORK_DIR}/${NODE_ARCHIVE}"
(
  cd "${WORK_DIR}"
  grep " ${NODE_ARCHIVE}$" SHASUMS256.txt | sha256sum --check --status
)

tar -xJf "${WORK_DIR}/${NODE_ARCHIVE}" -C /usr/local --strip-components=1
corepack enable
corepack prepare pnpm@11.11.0 --activate
echo "Installed Node.js $(node --version) and pnpm $(pnpm --version)."
