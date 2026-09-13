## Summary

Describe the user-visible change and why it is needed.

## Validation

- [ ] `pnpm test:factory`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] `pnpm --filter @modreef/mobile export:web`
- [ ] Physical commands were tested only on isolated bench equipment, or this change does not control hardware.

## Safety and provenance

- [ ] Local aquarium control remains safe when cloud or network access is unavailable.
- [ ] New device behavior includes lawful interoperability provenance and sanitized fixtures.
- [ ] No credentials, setup codes, private QR payloads, packet captures, databases, proprietary SDKs, or copyrighted manuals are included.
- [ ] My commits include a Developer Certificate of Origin sign-off.
