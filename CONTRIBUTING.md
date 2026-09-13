# Contributing to modREEF

modREEF welcomes focused, testable contributions that preserve safe local
control of aquarium equipment.

## Before changing code

1. Open or reference an issue describing the user-visible problem.
2. Read `PROJECT_GUIDELINES.md` and the relevant architecture decision records.
3. For a device integration, document the source and legal basis before adding
   protocol code, captures, identifiers, or compatibility claims.
4. Use isolated bench equipment for commands that can switch physical loads.

Never contribute vendor application code, decompiled code, proprietary SDK
binaries, credentials, unredacted packet captures, copyrighted manuals, or
assets you do not have permission to distribute.

## Development checks

```bash
pnpm install --frozen-lockfile
pnpm test:factory
pnpm typecheck
pnpm test
pnpm --filter @modreef/mobile export:web
```

Native and physical-device changes also require the applicable acceptance test
and a written record of the hardware and firmware used.

## Adding a device integration

Read `docs/architecture/210-device-integrations.md`, then scaffold a driver and
device profile:

```bash
pnpm create:device vendor-model
```

New integrations begin as experimental. Keep device-specific discovery,
protocol, state mapping, and commands inside the generated package. Do not add
manufacturer checks to the tablet, web, cloud, or general Edge runtime when the
integration manifest or capability model can express the behavior.

## Contributions and provenance

By submitting a contribution, you agree that it is licensed under the project
license and that you have the right to submit it. Commits should include a
Developer Certificate of Origin sign-off:

```text
Signed-off-by: Your Name <you@example.com>
```

Add it with `git commit -s`. A sign-off is not a claim that a device protocol or
third-party asset is freely redistributable; those still require documented
provenance and review.
