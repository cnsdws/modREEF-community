# modREEF Roadmap

## In progress: Platform reliability and recovery

- Build the exact production Cloud API and web containers during immutable
  release qualification.
- Maintain tested Cloud and Reef Controller backup and restore procedures.
- Sign Edge releases with an offline-backed key and verify signatures before
  installation.
- Monitor public production health, provider deployment failures, and stale
  controller heartbeats.
- Apply documented evidence levels and repeatable bench acceptance to every
  device integration.
- Maintain the implemented account deletion, aquarium export, retention,
  credential rotation, and native application release procedures.

## In progress: Multi-user aquarium authorization

Complete the tank-scoped `view`, `control`, `program`, `manage`, and `owner`
access model across tablet, phone, web, cloud, and Reef Controller workflows.

### Invitation lifecycle

- Provide a secure, shareable invitation link and optional automatic email
  delivery when an operator configures a transactional mail provider.
- Display pending, accepted, and expired invitation states.
- Allow authorized users to resend or cancel a pending invitation.
- Activate access only when the authenticated account owns the invited email.

### Alarm delivery

- Deliver aquarium alert emails only to members who have opted in, using a
  durable retry outbox when transactional email is configured.
- Support independently selectable push and email delivery channels.
- Keep alarm acknowledgement and history consistent across users and clients.
- Record email delivery attempts without making cloud notification availability
  part of the Reef Controller's local safety path.

### Authorization audit trail

- Journal invitations, acceptance, role changes, access removal, ownership
  transfer, and notification-preference changes.
- Record the acting user, affected user, aquarium, old and new values, and time.
- Make authorization audit records permanent even when ordinary UI history is
  cleared.

### Ownership transfer and recovery

- Allow the owner to transfer ownership to an existing `manage` member with an
  explicit confirmation step.
- Enforce exactly one owner and prevent an aquarium from being orphaned.
- Define a documented recovery process for an inaccessible owner account.

### Permission-aware UI

- Hide or disable unavailable actions consistently on tablet, phone, and web.
- Explain the member's current access level instead of allowing predictable
  authorization failures.
- Continue treating Cloud and Reef Controller authorization checks as the
  authority; client-side gating is presentation only.

### Multi-user acceptance coverage

- Test invitation and first sign-in with two real authentication accounts.
- Exercise every access level on tablet and web.
- Verify revocation while the affected user is signed in.
- Verify one user can access multiple aquariums without data crossing between
  them.
- Cover duplicate invitations, email case normalization, expired invitations,
  owner protection, and concurrent membership updates.

## Completed: Cloud-managed routines

Enable users to list, create, edit, delete, run, and stop Reef Controller routines from the web application.

Requirements:

- Routine definitions and execution remain on the Reef Controller so automation continues without internet access.
- Every web change is routed to the selected Reef Controller through the cloud command channel.
- The UI reports success only after the Reef Controller validates and confirms the committed change.
- Commands are scoped to the correct aquarium and Reef Controller.
- Create, read, update, delete, run, and stop behavior receives API, controller, and UI regression coverage.
- Existing direct-local routine control on phone and tablet remains available when cloud access is interrupted.
