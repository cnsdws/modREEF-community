# ADR 0003: Resource ownership and Reef Controller lifecycle

Status: Accepted for implementation

## Context

modREEF manages four nested resource types:

```text
Aquarium
└── Reef Controller
    └── Physical Device
        └── Equipment Channel
```

The cloud currently permits more than one aquarium and more than one controller,
and each Edge runtime permits more than one physical device and equipment
channel. Their lifecycle operations are not yet one coherent contract.

In particular, retiring a cloud controller record revokes its token and removes
its cloud equipment snapshots, but it does not unclaim the physical controller.
The controller therefore continues operating its local aquarium and cannot be
claimed by another aquarium. A controller transfer cannot be made reliable by
performing those two mutations independently: a network interruption between
them can strand either the cloud record or the controller.

## Decision

### Ownership hierarchy

- An aquarium may have zero or more active Reef Controllers.
- A Reef Controller may be actively assigned to exactly one aquarium.
- A physical device belongs to exactly one Reef Controller.
- An equipment channel belongs to exactly one physical device.
- Historical aquarium events remain associated with the aquarium where they
  occurred even after a controller or device is removed.
- Physical identity is independent of display name and aquarium assignment.

Every resource exposed to a client carries its complete ownership identity:

- aquarium: `aquariumId`
- controller: `aquariumId`, `controllerId`, immutable `hardwareId`
- device: `aquariumId`, `controllerId`, `deviceId`
- equipment: `aquariumId`, `controllerId`, `deviceId`, `equipmentId`

Identifiers are stable and globally unique within their resource type. Display
names are never used as identity or ownership keys.

### Shared CRUD semantics

Tablet and WWW use the same cloud-client operations and receive the same result
documents. Neither client implements a second lifecycle policy.

#### Aquarium

- Create produces an empty aquarium.
- Rename changes only its display name.
- Archive and delete are rejected while any controller remains assigned.
- Archive is the normal user operation. It removes an empty aquarium from the
  normal selector while retaining its settings and historical records.
- Restore returns an archived aquarium to the normal selector.
- Permanent deletion is a separate administrative operation governed by the
  product retention policy.

#### Reef Controller

- Claim binds an unclaimed hardware identity to one aquarium.
- Rename changes only its cloud display name.
- Unassign and remove are rejected while any physical device remains registered
  to the controller. Devices must be deliberately removed first.
- Unassign removes cloud ownership after the controller is empty; the controller
  becomes discoverable as an unclaimed controller.
- Transfer preserves local device configuration and atomically changes the
  aquarium assignment. Transfer is not removal: it moves the controller and its
  complete physical-device/equipment tree together.
- Delete is a cloud-record operation allowed only after the physical controller
  is unassigned, except for an explicit administrative lost-controller workflow.
- Factory reset is a separate physical operation. It erases controller-owned
  devices, credentials, schedules, and cloud assignment but preserves immutable
  factory identity.

#### Physical device

- Pair is complete only after identity, credentials, live communication,
  equipment creation, persistence, and cloud synchronization are confirmed.
- Rename changes the physical-device display name and its equipment provenance.
- Repair refreshes transport credentials or addressing without creating a new
  physical-device identity or duplicate equipment.
- Remove deletes the Edge credential/registration, all child equipment and
  schedules, and then lets the Edge's authoritative snapshot remove cloud
  copies. Vendor factory reset is a separate optional action.

#### Equipment channel

- Equipment is derived from the capabilities of its physical device.
- Mutable properties include display name, role, display order, visibility,
  program, schedule, calibration, and control mode when supported.
- Hardware-locked channel type and capabilities cannot be changed by a client.
- Removing a physical device removes all of its equipment. A channel may be
  hidden or disabled independently, but is not orphaned from its device.
- Copy and binding-swap operations apply only to compatible controllable outlet
  channels. They preserve physical capability and update ownership metadata.
- Cloud commands are accepted only when the equipment or device snapshot belongs
  to both the requested aquarium and Reef Controller.

### Controller lifecycle state machine

The cloud records one of these states for every non-retired controller:

```text
provisioning -> active -> unassigning -> unclaimed
                       \-> transferring -> active
active/offline --------> lost -> retired
```

`online` and `offline` are connectivity observations, not ownership states.

Claim, unassign, and transfer are persisted, idempotent operations identified by
an operation ID. Repeating a request with the same operation ID returns the same
operation and cannot create another controller record.

### Reliable transfer protocol

A transfer is a recoverable handoff rather than two unrelated CRUD calls:

1. The owner starts a transfer with source aquarium, destination aquarium,
   controller hardware identity, and operation ID.
2. The cloud verifies access to both aquariums, records `transferring`, and
   stages destination credentials without revoking the active credentials.
3. The controller receives the transfer intent through its authenticated sync,
   validates the staged credentials, and durably records the pending handoff.
4. The controller acknowledges readiness while continuing to operate and sync
   with the source assignment.
5. The cloud commits the assignment and returns a durable commit receipt.
6. The controller atomically activates destination credentials, clears the
   pending handoff, and synchronizes its complete authoritative snapshot to the
   destination aquarium.
7. The cloud marks the operation complete and removes active source snapshots.

Any interrupted step is safe to retry. Until commit, the source assignment
remains authoritative. After commit, the staged destination credential and
operation receipt allow either side to finish without user re-pairing.

Unassign uses the same protocol with no destination aquarium. The controller
becomes unclaimed only after receiving a durable commit receipt.

### Deletion order

The dependency order is explicit and non-cascading:

```text
remove physical devices and their child equipment
-> unassign/remove the now-empty controller
-> archive/delete the now-empty aquarium
```

An attempted parent removal returns a conflict containing the blocking child
resource IDs. No parent deletion silently cascades through live hardware.

After dependency validation, deletes proceed from the owner of the
authoritative state outward:

```text
equipment/device: Edge commit -> Edge sync -> Cloud reconciliation -> UI refresh
controller: Cloud intent -> Edge commit acknowledgement -> Cloud retirement
aquarium: verify no active controllers -> Cloud delete
```

A client never treats an HTTP request being accepted as completion. It displays
the operation state until the authoritative owner confirms the final state.

### Update and health observability

Every controller reports:

- installed immutable release identifier and checksum
- updater enabled/disabled state
- last check, last success, and last failure
- pending release identifier
- boot ID and service start time

An owner can request `check now` through the authenticated controller command
channel. The command runs the same qualified, checksum-verified updater used by
the timer and reports a durable result. SSH is not part of customer recovery.

## Required acceptance matrix

Automated system tests use two aquariums (`A`, `B`) and two controllers (`C1`,
`C2`) and prove:

1. Claim C1 to A and C2 to B.
2. Add two physical devices of the same supported family to one controller
   without ID or snapshot collisions.
3. Rename every level and observe identical Tablet and WWW results.
4. Remove and re-pair each device family without resurrected credentials or
   duplicate equipment.
5. Transfer C1 from A to B with all child devices and equipment preserved.
6. Interrupt transfer before and after commit and recover by retrying the same
   operation ID.
7. Unassign C1 and claim it to A again without shell access or factory reset.
8. Reject unassignment or removal of C1 while it owns a physical device.
9. Remove C1's devices, then successfully unassign C1.
10. Reject archival or deletion of A while C1 remains assigned.
11. Archive and restore empty A without changing retained journal history.
12. Delete an unassigned controller record without changing retained journal
   history.
13. Factory-reset C1 and verify controller-owned device state is erased while
    its immutable hardware identity and setup credential remain valid.
14. Keep C2 and all B-owned resources unchanged throughout every C1 operation.
15. Request an update, observe its progress, reboot, and confirm the immutable
    installed release identifier.

Each scenario is run through the shared client contract used by both Tablet and
WWW, plus direct Edge/cloud recovery tests for interrupted operations.

## Consequences

- Existing cloud-only controller DELETE behavior must not remain the normal UI
  path for a connected controller.
- Controller hardware identity and assignment must be represented separately in
  cloud storage.
- Edge sync and command-result acknowledgement need idempotent operation receipts.
- Device drivers must implement one common lifecycle contract before additional
  device families are added.
- Existing prototype records require an explicit migration and reconciliation
  report; records must not be silently guessed or merged by display name.
