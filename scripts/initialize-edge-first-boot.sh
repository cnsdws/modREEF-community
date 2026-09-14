#!/usr/bin/env bash
set -euo pipefail

MARKER="/var/lib/modreef/factory-initialized"
[[ -e "${MARKER}" ]] && exit 0

SERIAL="$(awk -F': ' '/^Serial/ { print $2 }' /proc/cpuinfo | tail -1)"
if [[ ! "${SERIAL}" =~ ^[A-Fa-f0-9]+$ ]]; then
  SERIAL="$(cat /etc/machine-id 2>/dev/null || true)"
fi
SUFFIX="${SERIAL: -6}"
[[ "${SUFFIX}" =~ ^[A-Fa-f0-9]{6}$ ]] || SUFFIX="$(printf '%06x' "$((RANDOM * 2 + RANDOM % 2))")"
CONTROLLER_HOSTNAME="modreef-${SUFFIX,,}"

hostnamectl set-hostname "${CONTROLLER_HOSTNAME}"
# Cloned images deliberately contain neither a machine-specific SSH host key
# nor a reusable hostname entry. Generate a unique server identity before
# deciding whether this particular image is allowed to expose factory SSH.
ssh-keygen -A
sed -i '/^127\.0\.1\.1[[:space:]]/d' /etc/hosts
printf '127.0.1.1 %s\n' "${CONTROLLER_HOSTNAME}" >> /etc/hosts

# Avahi may already have expanded %h in the service name using the temporary
# Raspberry Pi Imager hostname. Reload it after assigning the hardware-derived
# identity so nearby-controller discovery immediately presents the final name.
if systemctl is-active --quiet avahi-daemon.service; then
  systemctl restart avahi-daemon.service
fi

if systemctl cat ssh.service >/dev/null 2>&1; then
  if [[ -s /home/admin/.ssh/authorized_keys ]]; then
    # Image preparation already records whether SSH is enabled. Do not run
    # `systemctl enable` from inside an early-boot unit: Debian's SysV
    # compatibility helper requests daemon reloads and can deadlock the unit,
    # which previously blocked network-pre.target and BLE onboarding.
    systemctl start ssh.service
    echo "Factory SSH access enabled for this prototype."
  else
    systemctl stop ssh.service
    echo "Factory SSH access disabled for this customer image."
  fi
fi

install -d -m 0755 -o modreef -g modreef /var/lib/modreef
printf '%s\n' "${CONTROLLER_HOSTNAME}" > "${MARKER}"
chown modreef:modreef "${MARKER}"
echo "Initialized unique Reef Controller identity ${CONTROLLER_HOSTNAME}."
