#!/bin/bash -e

# pi-gen's on_chroot helper mounts a fresh tmpfs at /tmp. Keep the archived
# installer in /var/tmp so it remains visible when the chroot starts.
SOURCE="${ROOTFS_DIR}/var/tmp/modreef-release"
install -d "${SOURCE}"
rsync -a --delete "files/modreef-release/" "${SOURCE}/"

on_chroot <<EOF
MODREEF_NODE_VERSION='${MODREEF_NODE_VERSION}' MODREEF_TINYTUYA_SPEC='${MODREEF_TINYTUYA_SPEC}' MODREEF_IMAGE_BUILD=1 /var/tmp/modreef-release/scripts/install-edge.sh
/opt/modreef/app/scripts/prepare-edge-image.sh PREPARE-FACTORY-IMAGE
passwd --lock admin
rm -rf -- /var/tmp/modreef-release
EOF

# Raspberry Pi Imager replaces this file when the owner completes OS
# customization. If somebody bypasses the supported manifest and writes the
# image directly, cloud-init must not create an upstream default user or enable
# password-based remote access.
install -m 0644 /dev/stdin "${ROOTFS_DIR}/boot/firmware/user-data" <<'EOF'
#cloud-config
users: []
disable_root: true
ssh_pwauth: false
EOF

install -m 0644 /dev/stdin "${ROOTFS_DIR}/boot/firmware/modreef-image.json" <<EOF
{
  "formatVersion": 1,
  "product": "modREEF Reef Controller",
  "sourceCommit": "${MODREEF_SOURCE_COMMIT}",
  "onboardingMode": "private-lan"
}
EOF
