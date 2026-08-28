#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo." >&2
  exit 1
fi
if [[ "${1:-}" != "PREPARE-FACTORY-IMAGE" ]]; then
  echo "Usage: sudo $0 PREPARE-FACTORY-IMAGE [--preserve-factory-access] [--preserve-factory-identity]" >&2
  exit 1
fi

PRESERVE_FACTORY_ACCESS=false
PRESERVE_FACTORY_IDENTITY=false
for option in "${@:2}"; do
  case "${option}" in
    --preserve-factory-access) PRESERVE_FACTORY_ACCESS=true ;;
    --preserve-factory-identity) PRESERVE_FACTORY_IDENTITY=true ;;
    *) echo "Unknown option: ${option}" >&2; exit 1 ;;
  esac
done

systemctl stop modreef-controller-onboarding.service modreef-edge.service modreef-update.timer || true
rm -f -- /etc/systemd/system/modreef-edge.service.d/cloud.conf
rm -f -- /opt/modreef/app/.env.edge.local

WIFI_CONNECTION_UUIDS=()
if command -v nmcli >/dev/null 2>&1; then
  mapfile -t WIFI_CONNECTION_UUIDS < <(
    nmcli -t --escape no -f UUID,TYPE connection show |
      awk -F: '$2 == "802-11-wireless" || $2 == "wifi" { print $1 }'
  )
fi
if [[ "${PRESERVE_FACTORY_IDENTITY}" == true ]]; then
  find /var/lib/modreef -mindepth 1 -maxdepth 1 ! -name factory-identity.json -exec rm -rf -- {} +
else
  find /var/lib/modreef -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
fi
install -d -m 0755 -o modreef -g modreef /var/lib/modreef /var/lib/modreef/matter

# Remove customer/factory Wi-Fi without reloading NetworkManager. The existing
# link remains up long enough to finish sanitation and power off, but no Wi-Fi
# profile is available on the next boot.
if [[ -d /etc/NetworkManager/system-connections ]]; then
  while IFS= read -r -d '' profile; do
    if grep -qx '\[wifi\]' "${profile}"; then
      rm -f -- "${profile}"
    fi
  done < <(find /etc/NetworkManager/system-connections -maxdepth 1 -type f -print0)
fi
rm -f -- /etc/wpa_supplicant/wpa_supplicant.conf

# Ubuntu Desktop can persist NetworkManager-created connections as netplan
# YAML instead of keyfiles. Removing only system-connections is therefore not
# sufficient: netplan recreates the Wi-Fi profile (including its password) on
# the next boot. Keep wired profiles, but remove every YAML document that
# defines a Wi-Fi interface.
if [[ -d /etc/netplan ]]; then
  while IFS= read -r -d '' profile; do
    if grep -Eq '^[[:space:]]*wifis:[[:space:]]*($|#)' "${profile}"; then
      rm -f -- "${profile}"
    fi
  done < <(find /etc/netplan -maxdepth 1 -type f \( -name '*.yaml' -o -name '*.yml' \) -print0)
fi

# Clear generated network and cloud-init state so neither subsystem can
# restore a removed customer connection from its runtime cache on first boot.
rm -f -- /var/lib/NetworkManager/*wlan*.lease
rm -f -- /var/lib/NetworkManager/seen-bssids
rm -rf -- /var/lib/cloud

truncate -s 0 /etc/machine-id
rm -f -- /var/lib/dbus/machine-id
rm -f -- /etc/ssh/ssh_host_*

if [[ "${PRESERVE_FACTORY_ACCESS}" != true ]]; then
  rm -f -- /home/admin/.ssh/authorized_keys
  systemctl disable ssh.service 2>/dev/null || true
else
  if [[ ! -s /home/admin/.ssh/authorized_keys ]]; then
    echo "Cannot preserve factory access: /home/admin/.ssh/authorized_keys is missing or empty." >&2
    exit 1
  fi
  systemctl enable ssh.service 2>/dev/null || true
fi

systemctl enable modreef-first-boot.service modreef-update.timer modreef-update.path modreef-controller-onboarding.service modreef-edge.service
systemctl daemon-reload

# Removing a keyfile alone leaves the active profile cached inside
# NetworkManager, which can recreate it during shutdown. Delete the registered
# connections last; this may intentionally drop a remote factory session.
for connection_uuid in "${WIFI_CONNECTION_UUIDS[@]}"; do
  nmcli connection delete uuid "${connection_uuid}"
done
nmcli connection reload || true
echo "Factory image sanitized. Shut down now; do not boot this card before imaging."
