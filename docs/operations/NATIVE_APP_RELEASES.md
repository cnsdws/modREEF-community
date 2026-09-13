# Native application releases

The same Expo application serves iPhone, iPad, Android, and the web UI. Native
release builds use `apps/mobile/eas.json`; developer builds remain local and are
never promoted as store binaries.

## One-time project setup

1. Create the organization-owned Apple Developer and Google Play accounts.
2. From `apps/mobile`, run `pnpm exec eas login` and then
   `pnpm exec eas build:configure`. Commit only the generated public project
   identifier; never commit signing certificates, private keys, or passwords.
3. Register `com.modreef.app` in both stores and complete privacy, local-network,
   Bluetooth, camera, and biometric disclosures.
4. Require a protected production environment and two-person approval for store
   submissions.

## Candidate and production commands

Use `pnpm exec eas build --profile preview --platform all` for installable QA
candidates. After the exact commit passes repository qualification and real-device
acceptance, use `pnpm exec eas build --profile production --platform all`.
Submit the immutable artifacts with `pnpm exec eas submit --profile production`.

TestFlight distribution requires the paid Apple Developer Program. Android
internal testing requires a Google Play Console account. Community contributors
can run development builds without receiving store-signing credentials.

Record the source commit, EAS build URLs, app version/build number, qualification
evidence, and approving operator in the release record. Roll back by promoting a
new build containing the last qualified source; app stores do not support
replacing an already published binary in place.
