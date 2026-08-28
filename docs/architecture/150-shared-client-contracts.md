# Shared Client Contracts

## Status

Implemented foundation for the shared modREEF cloud, Edge, web, phone, and
tablet infrastructure.

## Packages

- `@modreef/api-contract` owns HTTP request and response shapes shared by
  clients and services.
- `@modreef/realtime-events` owns the ordered event envelopes that will cross
  the future cloud-to-Edge and cloud-to-client realtime connections.
- `@modreef/cloud-client` defines the transport-neutral request boundary that
  the local Edge client and future cloud client can implement.

The contracts may depend on the public Digital Twin model. They must not
depend on Edge drivers, equipment credentials, storage implementations, or
platform-specific client libraries.

## Command identity

Every command that can change physical equipment carries a client-generated
`commandId`. A command ID is stable across retries of the same user intent.

Edge records the command ID, a fingerprint of its input, and the result
promise before waiting for physical execution to finish. Consequently:

1. The first request executes the physical operation.
2. A concurrent or later retry with the same ID and input shares or replays
   the original result.
3. Reusing the same ID with different input returns a conflict.
4. A client must create a new ID only for a new user intent.

This is especially important for dosing operations: reconnecting or retrying
an HTTP request must never run a dose twice.

The initial Edge registry is memory-bounded and process-local. Before remote
cloud commands are enabled, completed command records must be persisted in
SQLite so deduplication also survives an Edge restart.

## Reported state

Physical operation is not complete merely because a command was accepted.
Command responses represent an Edge-confirmed result and include the same
command ID. Future realtime status events use the lifecycle:

- `pending`
- `accepted`
- `completed`
- `failed`

Edge remains authoritative for physical equipment state. Cloud and client
state are synchronized representations with explicit observation times.

## Realtime ordering

Every realtime envelope includes:

- globally unique event ID
- aquarium ID
- Edge ID
- monotonically increasing Edge sequence
- occurrence timestamp
- event type and typed data

Consumers will use the sequence to detect missing or out-of-order events and
request a fresh state snapshot when necessary.

## Client distribution

All client surfaces use the same API and realtime contracts, but are
distributed through the channel appropriate to their platform:

- `www.modreef.net` hosts the web application/PWA and a common download page.
- TestFlight distributes the universal iPhone and iPad beta application.
- Google Play internal testing distributes the adaptive Android phone and
  tablet beta application.
- Direct Android APK and iOS ad hoc builds remain developer fallbacks rather
  than the normal tester experience.

Beta and stable builds are release profiles of the same applications. They
must use distinct application identifiers and environment configuration so a
tester can install a beta alongside a future production release without
mixing cloud environments.
