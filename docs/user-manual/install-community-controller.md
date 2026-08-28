# Install a community Reef Controller

The community controller image turns a Raspberry Pi 4 or Raspberry Pi 5 into a
fresh modREEF Reef Controller. It contains no modREEF factory key, customer
credentials, aquarium assignment, or reusable controller identity. Community
installation does not require a QR code or Bluetooth provisioning.

## What you need

- Raspberry Pi 4 or Raspberry Pi 5 and a reliable 16 GB or larger microSD card
- macOS, Windows, or Linux computer with an SD-card reader
- Raspberry Pi Imager 2.x
- the `modreef-controller.rpi-imager-manifest` release file
- phone or tablet running the native modREEF app

## 1. Open the modREEF image in Raspberry Pi Imager

Open <https://www.modreef.net/download> on a Windows, macOS, or Linux computer.
The page includes the official Windows and macOS Raspberry Pi Imager installers
and complete installation instructions. Install Imager, then select **Open in
Raspberry Pi Imager** for the guided path.

Download and double-click `modreef-controller.rpi-imager-manifest`. Choose the
Raspberry Pi model in Imager; **modREEF Community Reef Controller** is then
selected and Imager downloads the matching verified image when it writes the
card.

Do not choose **Use custom image** for a separately downloaded image. Imager 2.x
cannot infer a local third-party image's customization format, so that path does
not offer Wi-Fi setup. The modREEF manifest identifies the image as
`cloudinit-rpi`, supplies its checksums, and enables the customization screens.

Advanced users who download the image directly can verify it independently:

On macOS:

```bash
shasum -a 256 -c modreef-controller-*.img.xz.sha256
```

On Linux:

```bash
sha256sum --check modreef-controller-*.img.xz.sha256
```

The GitHub release also includes build provenance tying the image to its exact
modREEF and Raspberry Pi OS build-system commits.

## 2. Configure and flash the card

Open Raspberry Pi Imager and:

1. Select the intended SD card.
2. Open OS customization and configure the aquarium's Wi-Fi network, country,
   and time zone. An Ethernet connection can be used instead.
3. Optionally enable administration using the existing `admin` username, a
   unique password, and your own SSH public key. Do not rename this service
   account. The image contains no shared modREEF SSH key.
4. Write and verify the card.

Wi-Fi is configured locally by Raspberry Pi Imager and is never sent through
modREEF Cloud. Safely eject the card, insert it into the Pi, and power it on.

## 3. Add the controller to modREEF

On first boot, the controller derives a unique hostname from the Pi hardware,
generates unique SSH host keys, and advertises itself on the local network. In
the modREEF app:

1. Select **Add Reef Controller**.
2. Choose the unassigned controller shown under nearby network controllers.
3. Select the aquarium and enter a friendly controller name.
4. Wait for the local/cloud claim handshake to report **Ready**.

The unassigned controller accepts its first ownership claim from the private LAN.
Do not perform initial setup on a public or untrusted network. After the claim,
controller credentials bind it to the selected aquarium and prevent another
account from claiming it.

Normal software updates then arrive through the production release channel.
Reflashing is only needed for operating-system recovery.

## Recovery and replacement

Reimaging creates a fresh, unassigned controller installation. Before replacing
an existing installation, remove its physical devices and then remove the old
Reef Controller from the aquarium. Journal history remains with the aquarium.

Prebuilt retail controllers use a different factory path: their printed QR code
provides proof of physical possession and securely sends Wi-Fi credentials over
Bluetooth. The community path intentionally uses the owner's imaging process and
private LAN instead.
