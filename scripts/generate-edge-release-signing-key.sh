#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 PRIVATE_KEY_PATH PUBLIC_KEY_PATH" >&2
  exit 2
fi

PRIVATE_KEY="$1"
PUBLIC_KEY="$2"
if [[ -e "${PRIVATE_KEY}" || -e "${PUBLIC_KEY}" ]]; then
  echo "Refusing to overwrite an existing key file." >&2
  exit 1
fi

umask 077
openssl genpkey -algorithm ED25519 -out "${PRIVATE_KEY}"
openssl pkey -in "${PRIVATE_KEY}" -pubout -out "${PUBLIC_KEY}"
chmod 0600 "${PRIVATE_KEY}"
chmod 0644 "${PUBLIC_KEY}"

echo "Created an Ed25519 release key pair."
echo "Store ${PRIVATE_KEY} offline and in the protected GitHub secret MODREEF_EDGE_RELEASE_SIGNING_KEY."
echo "Install ${PUBLIC_KEY} as /etc/modreef/release-public-key.pem on every controller image."
