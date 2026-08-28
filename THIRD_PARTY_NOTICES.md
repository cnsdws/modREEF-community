# Third-party notices

modREEF uses open-source dependencies recorded in `pnpm-lock.yaml`, Python
environment setup scripts, CocoaPods specifications, and native build files.
Those components remain under their respective licenses.

CI checks installed JavaScript dependency license metadata against an explicit
reviewed set. Permissive licenses make up nearly all current dependencies. The
remaining reviewed classifications include MPL-2.0 build tooling, CC-BY-4.0
browser compatibility data, Python-2.0 utilities, public-domain components,
and packages offering a permissive license choice. This check is an inventory
control and does not replace preserving notices required by each dependency.

## Tuya provisioning boundary

The repository contains an interoperability bridge that calls Tuya's official
SmartLife App SDK. The proprietary Tuya SDK, its cryptographic support package,
developer credentials, and any Tuya service entitlement are **not** included,
sublicensed, or covered by the modREEF Apache-2.0 license.

Building Tuya provisioning support requires the builder to obtain the SDK and
credentials directly from Tuya and comply with Tuya's applicable terms. The
standard source build excludes that native module. An authorized builder can
set `MODREEF_ENABLE_TUYA_PROVISIONING=1` and provide
`TUYA_IOS_CORE_SDK_PATH`, `TUYA_IOS_APP_KEY`, and `TUYA_IOS_APP_SECRET`.

The MIT license in `apps/mobile/modules/tuya-bridge/LICENSE` preserves the
notice supplied with the Expo module scaffold. It does not license Tuya's SDK.

## Device compatibility

Jebao/Jecod, Tuya, GHome, YINMIK, TP-Link, Tapo, Matter, Apple, Android, Auth0,
OpenAI, Railway, Raspberry Pi, and other third-party names belong to their
respective owners. Their use in modREEF documentation describes compatibility
or an optional service integration and does not imply endorsement.
