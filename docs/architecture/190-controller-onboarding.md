# Reef Controller onboarding

## Product requirement

A customer must not need a hostname, IP address, shell, factory Wi-Fi network,
or pasted cloud token to install a Reef Controller. The normal flow is entirely
inside the authenticated modREEF phone or tablet app.

## Two discovery states

### Owner-imaged community controller

A community user controls the SD-card image and configures Wi-Fi or Ethernet in
Raspberry Pi Imager before first boot. The image contains no factory identity,
claim secret, shared SSH key, customer state, or aquarium assignment. On first
boot it creates unique machine and SSH identities and advertises
`_modreef._tcp.local` as an unclaimed controller, using the final six characters
of the Pi serial as its visible setup ID. The authenticated native app
discovers it on the private aquarium LAN and uses the normal local/cloud claim
handshake. No QR scan or Bluetooth Wi-Fi transfer is required.

This flow treats the private LAN as the initial ownership boundary and must not
be used on public or untrusted networks. It does not replace the stronger
physical-possession flow for prebuilt hardware.

### Controller already on the aquarium LAN

Every controller advertises `_modreef._tcp.local` with its local API port. The
app resolves that service, verifies `/health`, and displays only unclaimed
controllers. The user selects the physical controller by its short setup
identifier, supplies a friendly name, and chooses the aquarium. The app creates
the cloud registration and sends the one-time credential directly to the local
controller. The controller validates the registration with the cloud before
persisting it.

Hostname and IP address are implementation details. Manual address entry is a
support fallback, not part of normal onboarding.

### Factory-fresh controller without Wi-Fi

Production images must not contain factory or customer Wi-Fi credentials. A
factory-fresh controller instead advertises a dedicated Bluetooth onboarding
service containing its stable hardware identity and setup identifier. The
printed QR code contains a unique, random claim secret generated for that
controller; discovery itself is public, but configuration is not.

The authenticated native app performs this sequence:

1. Scan the QR code and discover the matching controller over Bluetooth.
2. Establish an encrypted session derived from the controller claim secret.
3. Let the user select or enter the 2.4 GHz Wi-Fi network and password.
4. Send credentials to the controller over the encrypted Bluetooth session.
5. Show explicit progress while the controller joins Wi-Fi.
6. Rediscover the same hardware identity through `_modreef._tcp.local`.
7. Ask for a friendly controller name and aquarium assignment.
8. Register and claim it through the normal local/cloud handshake.
9. Disable factory provisioning after successful network setup and reject further
   ownership claims once the controller is assigned.

The controller must never expose Wi-Fi credentials through logs, cloud APIs,
Bluetooth advertisements, or diagnostic exports. Failed onboarding keeps the
controller unclaimed and permits a retry. Customer factory reset erases network
and ownership credentials but preserves the immutable factory identity and
printed claim secret. Secret rotation is a controlled rework operation that also
requires printing and applying a replacement label.

## User interface

Controller names default to `Reef Controller`; users never type a provisioned
hostname. Naming is displayed in a keyboard-aware scroll view with the active
field, current value, and completion action visible above the software keyboard.

The setup screen reports distinct phases: looking nearby, configuring Wi-Fi,
joining the network, verifying the controller, registering ownership, and ready.
Each phase has a bounded timeout, retry, and cancel path.

## Ownership and lifecycle

The hierarchy is Account → Aquarium → Reef Controller → Physical Device →
Equipment Channel. Claiming assigns one unclaimed controller to one aquarium.
Moving it requires an explicit removal or transfer. Removal revokes cloud access
and removes active device/equipment state while retaining aquarium history.
Factory reset affects the physical controller but does not silently delete cloud
history.

## Bluetooth protocol

The factory service advertises as `modREEF-<setup ID>` and exposes one private
modREEF GATT service with three characteristics: identity (read), provisioning
(write), and status (read). Identity includes a fresh server nonce. The app adds
a fresh client nonce and derives a session key from both nonces and the unique QR
secret with HKDF-SHA256. Wi-Fi credentials are authenticated and encrypted with
XChaCha20-Poly1305 and bound to the hardware serial and setup ID. A QR label for
one controller therefore cannot configure another controller.

The controller writes a mode-0600 NetworkManager keyfile atomically; the password
is never placed in a command argument. After NetworkManager confirms the join it
creates `/var/lib/modreef/wifi-provisioned`, reports success briefly over
Bluetooth, and stops the factory service. Factory-image sanitization removes that
marker and customer state while preserving the immutable per-unit factory identity.

## Delivery boundary

LAN discovery, keyboard-safe naming, per-unit QR generation, QR scanning, setup-ID
matching, claim-secret enforcement, encrypted Bluetooth Wi-Fi provisioning, and
automatic LAN handoff are implemented together. Hardware acceptance testing remains
required on a sanitized prototype image before this flow is described as production
ready.
