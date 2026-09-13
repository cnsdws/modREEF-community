# Data lifecycle and account recovery

## User-owned exports

System settings exposes **Export aquarium data** on tablet, phone, and web. The
versioned JSON export contains the aquarium, controller inventory, physical
devices, equipment state, water-alarm rules, journal and measurement events,
membership visible to the requester, and the authorization audit visible to an
administrator. It never contains controller tokens, local device keys, Wi-Fi
passwords, Auth0 tokens, or Matter fabric secrets.

Exports are snapshots for portability and support. Restoring an export into a
live aquarium is intentionally a separate, administrator-controlled operation;
blindly importing hardware bindings could send commands to the wrong device.

## Retention

- Reef Controllers retain aquarium events for 24 months and purge them daily.
- Persistent systemd logs are capped at 128 MB and 30 days.
- The cloud currently retains synchronized aquarium events while the aquarium
  exists. Authorization audit rows cannot be cleared through the ordinary
  journal UI.
- Controller backups and database backups are retained according to the
  operator's encrypted backup policy; they must not be placed in source control.
- Archived aquariums retain data. Deleting a membership does not delete the
  aquarium's operational journal.

## Account deletion

**Delete modREEF account data** removes a user's cloud profile and remaining
non-owner memberships. It is blocked while the user owns any aquarium. The user
must transfer ownership to an accepted Manage user, or remove the empty aquarium,
before deletion. This prevents orphaned tanks and controllers.

The community deployment uses an external OpenID Connect identity provider.
Deleting modREEF data does not silently delete the upstream identity-provider
account; that identity must be deleted using the provider's own account process.
Signing in again can create a new, empty modREEF profile.

## Controller credential rotation and replacement

The **Reprovision** controller action creates a new random controller token and
immediately invalidates the previous hash in the cloud database. Use it only
while locally connected to the intended physical controller. A replacement
controller must have the same aquarium selected deliberately; device records are
not copied to different hardware automatically.

If an owner's authentication account becomes inaccessible, an operator must
verify ownership outside the application before changing memberships directly.
The supported recovery sequence is: restore identity-provider access when
possible; otherwise take a database backup, document the authorization, add a
verified replacement owner transactionally, and record the recovery in the
authorization audit. Never promote a pending invitation directly to Owner.
