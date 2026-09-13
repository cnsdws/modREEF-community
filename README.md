# modREEF

modREEF is a local-first aquarium controller, equipment integration platform,
and Smart Reef Coach. It combines a Raspberry Pi Reef Controller, an adaptive
Expo application for tablet, phone, and web, and an optional self-hosted cloud
service.

> **Release status:** active developer preview. Do not rely on experimental
> integrations as the only safeguard for aquarium life-support equipment.

## First run

```bash
pnpm install
pnpm fix:expo
pnpm typecheck
pnpm test
pnpm web
```

`pnpm fix:expo` allows Expo to align dependency patch versions with the installed SDK.

## Boundaries

- `@modreef/foundation`: shared primitives only
- `@modreef/digital-twin`: aquarium concepts, equipment, measurements, recommendations
- `@modreef/mobile`: tablet/phone presentation

The UI controls logical equipment such as **Return Pump**, not physical outlet numbers.

## Project guidelines

All contributions and integrations must follow [PROJECT_GUIDELINES.md](PROJECT_GUIDELINES.md).

## Licensing and third-party services

modREEF source is licensed under the [Apache License 2.0](LICENSE). The modREEF
name and logo are not granted for use as the identity of unofficial builds.

Some integrations require separately licensed software or external services.
In particular, Tuya provisioning currently calls Tuya's official SmartLife App
SDK. The Tuya SDK and developer credentials are not included in this repository
or licensed by modREEF. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Security reports and contributions are governed by [SECURITY.md](SECURITY.md),
[CONTRIBUTING.md](CONTRIBUTING.md), and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). See the
[public-source publication review](docs/open-source/PUBLICATION_REVIEW.md) before
publishing a source snapshot.

## Community resources

- [Install a community Reef Controller](docs/user-manual/install-community-controller.md)
- [Supported devices and platforms](docs/SUPPORT_MATRIX.md)
- [Changelog](CHANGELOG.md)
- [Contributing a device integration](docs/architecture/210-device-integrations.md)
- [Public release process](docs/open-source/RELEASE_PROCESS.md)
