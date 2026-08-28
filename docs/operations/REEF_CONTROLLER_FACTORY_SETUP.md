# Reef Controller factory setup

This is the reproducible baseline for a Raspberry Pi 4 Reef Controller. It replaces the manual collection of shell commands used on the development controller.

## Image baseline

- Raspberry Pi OS Lite 64-bit (Debian-based)
- Internet access during factory installation (the installer fetches and verifies Node.js 22)
- Wi-Fi country and factory network configured temporarily for prototypes only
- SSH enabled only for factory validation
- A unique hostname; do not copy machine identity or cloud credentials between controllers

## Install

Place a qualified `production` checkout in a staging directory on the controller, then run:

```bash
cd /tmp/modreef-release
sudo ./scripts/install-edge.sh
```

The installer is safe to rerun. Do not run it from `/opt/modreef/app` itself. It installs the latest verified Node.js 22 runtime from the official Node.js distribution, creates the `modreef` service account, copies the qualified Git checkout to `/opt/modreef/app`, installs runtime dependencies, creates persistent storage at `/var/lib/modreef`, installs the systemd service, and starts it. It also enables a persistent system journal capped at 128 MB with 30-day retention so power, boot, kernel, and service failures survive a reboot without allowing logs to consume the SD card.

Register the controller in the app. The one-time values returned by registration are installed with:

```bash
sudo /opt/modreef/app/scripts/configure-edge-cloud.sh EDGE_ID AQUARIUM_ID
```

The command prompts for the one-time token without echoing it. The token is written to a root-readable systemd drop-in and must never be placed in the image, repository, shell history, logs, or factory records.

Current app builds can instead claim an unconfigured controller directly over the
local network. The app creates the cloud registration, sends its one-time token to
the selected controller, and the controller validates the registration with the
cloud before saving it under `/var/lib/modreef/cloud-credentials.json`. No customer
shell access or service restart is required.

For repeated prototype claim testing only, reset modREEF state with:

```bash
sudo /opt/modreef/app/scripts/reset-edge-for-provisioning-test.sh RESET-PROTOTYPE
```

This intentionally erases all controller credentials, equipment, schedules, and
history while preserving the factory identity, printed setup secret, operating
system, and network configuration. It is not
a customer factory-reset interface.

## Factory acceptance

```bash
sudo /opt/modreef/app/scripts/edge-health-check.sh
sudo systemctl --no-pager --full status modreef-edge.service
sudo systemctl --no-pager --full status modreef-controller-onboarding.service
sudo journalctl -u modreef-edge.service -n 50 --no-pager
sudo test -d /var/log/journal
sudo grep -q '^Storage=persistent$' /etc/systemd/journald.conf.d/modreef-persistent.conf
journalctl --list-boots
```

The health check verifies the service, local HTTP API, persistent storage, and Bluetooth. Factory acceptance additionally confirms persistent diagnostics are configured. After the acceptance reboot, `journalctl --list-boots` must show both the previous and current boot. Before shipment also verify app pairing, cloud command acknowledgement, local outlet control, reboot persistence, and recovery without internet.

Prototype controllers that require factory SSH must be sanitized with
`--preserve-factory-access`. This retains the installed factory public key;
first boot generates unique SSH host keys, repairs the local hostname mapping,
and starts the already-enabled `ssh.service`. Image preparation owns SSH
enablement so first boot never performs a systemd enable/disable operation that
could block network and Bluetooth initialization. Customer images omit that
option, remove the factory key, and keep SSH disabled. Never ship a customer
image prepared with factory access preserved.

## Prototype identity labels

The prototype factory station can simulate per-unit enrollment after the clean
controller install. Run the enrollment utility once for each physical controller:

```bash
python3 scripts/enroll-prototype-controller.py modreef-01.local "Prototype 1"
```

It reads the Pi hardware serial, creates a random 256-bit setup secret, installs
the identity as `/var/lib/modreef/factory-identity.json` with `0640 root:modreef`
permissions, and writes a private Git-ignored label manifest under
`artifacts/factory-labels/private/`. Generate an Avery 5160-compatible sheet and
individual 2.625 by 1 inch PDFs with:

```bash
python3 scripts/generate-controller-labels.py \
  artifacts/factory-labels/private/controller-<setup-id>.json
```

Print at 100 percent / Actual Size. Never commit, email, or include the private
manifest or generated QR PDF in ordinary diagnostic bundles: the QR payload is a
physical-possession credential. Re-enrollment rotates the secret and requires
destroying the old label and applying the replacement.

## Qualified updates

```bash
sudo /opt/modreef/app/scripts/update-edge.sh
```

The cloud publishes the exact Edge source included in its qualified production image. The updater downloads the release without GitHub credentials, verifies its SHA-256 checksum, preserves controller state under `/var/lib/modreef`, installs it, and runs the controller health check. A failed install or health check restores the previous source. A systemd timer checks daily, and startup checks are allowed to fail without preventing local control when the internet is unavailable.

The archive is checksum-verified but is not yet cryptographically signed. Add release signing before unattended customer updates leave prototype status.

### Staging a controller candidate

The release channel is stored per controller under durable controller state;
it is not a global aquarium or account setting. Production is the default.
From System settings, open the target controller's action menu and select
**Staging**. The client confirms that the controller recorded the selection,
then requests an update. The controller verifies
the staging archive checksum, and reports both its channel and update status to
tablet and web. Select **Production** to return it to the qualified customer
channel.

Publishing requires the same high-entropy value in the Cloud API environment
variable and GitHub Actions secret named `MODREEF_RELEASE_PUBLISH_TOKEN`. The
Cloud API stores only the current staging archive and its immutable metadata in
PostgreSQL. Public downloads do not expose the publication token.

There is one deliberate bootstrap step: controllers running a release from
before channel selection existed cannot select staging remotely. Promote the
channel-support release through the normal production path once (or install a
new factory image). All later candidates can be tested on staging without SSH
or a production promotion.

## Preparing a prototype image

After the baseline controller passes factory acceptance, sanitize it immediately before shutting down and imaging its SD card:

```bash
sudo /opt/modreef/app/scripts/prepare-edge-image.sh PREPARE-FACTORY-IMAGE --preserve-factory-access
sudo poweroff
```

The explicit confirmation prevents accidental erasure. Sanitization removes controller credentials, equipment state, history, Matter state, machine identity, and SSH host keys. The prototype-only `--preserve-factory-access` option retains the factory administrator key so another prototype can be validated over SSH. Omit it for a production image. A generic master image deliberately removes `factory-identity.json`; otherwise every clone would share one setup secret.

After flashing the generic image to a physical unit, boot it on the secured factory
network, enroll that unit, print and apply its label, and run acceptance. The final
per-unit sanitization must retain only that unit's immutable identity:

```bash
sudo /opt/modreef/app/scripts/prepare-edge-image.sh \
  PREPARE-FACTORY-IMAGE --preserve-factory-identity
sudo poweroff
```

On its next boot the unit advertises `modREEF-<setup ID>` over Bluetooth. The app
scans its QR label, encrypts the entered Wi-Fi credentials for that exact hardware
identity, waits for NetworkManager to confirm the join, and then discovers and
claims the controller on the aquarium LAN. No vendor or Raspberry Pi setup app is
used.

On first boot, `modreef-first-boot.service` creates a hostname derived from the Pi serial number, then the qualified-release check runs before the Reef Controller runtime. Never boot a sanitized master card again before cloning it, because that consumes its first-boot state.

Customer Wi-Fi onboarding is specified in `docs/architecture/190-controller-onboarding.md`. The software path is implemented; a sanitized physical unit must still pass the documented Bluetooth-to-LAN acceptance test before the image is qualified for customers.

## Community image

Open-source installations use the reproducible pi-gen wrapper in
`scripts/build-community-image.sh`. It pins the Raspberry Pi OS build system to
an immutable upstream revision, installs an exact modREEF commit, sanitizes the
result, and emits a compressed 64-bit image with a checksum and build manifest.
The `Controller image` workflow also attaches GitHub build provenance.

The community image deliberately has no factory setup identity or shared SSH key.
It enables Raspberry Pi OS cloud-init, and each tagged release includes a Raspberry
Pi Imager manifest declaring `cloudinit-rpi`. The owner opens that manifest in
Raspberry Pi Imager 2.x to configure Wi-Fi and, optionally, their own SSH
credentials. Directly selecting the downloaded image as a custom image does not
provide Imager with enough metadata to offer customization. First boot derives the
hostname from the Pi serial, and the native app discovers and claims the unassigned
controller over the private aquarium LAN.
Factory-built retail controllers retain QR-authenticated Bluetooth provisioning.
See `docs/user-manual/install-community-controller.md` for the end-user procedure.
