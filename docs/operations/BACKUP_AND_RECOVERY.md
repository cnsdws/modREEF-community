# Backup and recovery

modREEF has two independent recovery layers. Cloud backups preserve accounts,
aquariums, memberships, journal history, controller registrations, and current
cloud snapshots. Reef Controller backups preserve the local-first source of
truth used to operate equipment when the internet is unavailable.

## Reef Controller backup

Run on the controller:

```bash
sudo /opt/modreef/app/scripts/backup-edge-state.sh /media/usb/modreef-edge-backup.tar.gz
```

The service pauses briefly so the SQLite database and device credentials are a
consistent set. The backup includes controller assignment, programs, schedules,
Matter state, local history, and device credentials. It deliberately excludes
the hardware-bound factory identity, first-boot markers, Wi-Fi configuration,
and transient update state. The archive contains secrets and must be stored on
encrypted media or in an encrypted backup service. Keep its `.sha256` file with
it.

## Controller replacement

1. Flash and boot a fresh community controller image and configure Wi-Fi.
2. Copy the backup and checksum to the new controller.
3. Ensure the old controller is powered off; two controllers must never run the
   same restored identity simultaneously.
4. Restore the backup:

```bash
sudo /opt/modreef/app/scripts/restore-edge-state.sh \
  modreef-edge-backup.tar.gz RESTORE-CONTROLLER-BACKUP
```

The restore preserves the new Pi's operating-system, Wi-Fi, release channel,
and factory identity. It restores the prior controller's cloud assignment and
equipment state, starts the service, and runs the normal health check. A failed
health check rolls the local state back. Confirm equipment on an isolated bench
before reconnecting life-support loads.

## Cloud database backup

Railway-managed backups remain the primary production database protection. An
operator can also create a portable PostgreSQL custom-format backup from a
trusted administration host:

```bash
MODREEF_DATABASE_URL='postgresql://…' \
  scripts/backup-cloud-database.sh modreef-cloud.dump
```

Test restoration into a newly created, empty PostgreSQL database:

```bash
MODREEF_DATABASE_URL='postgresql://…empty-test-database…' \
  scripts/restore-cloud-database.sh \
  modreef-cloud.dump RESTORE-INTO-EMPTY-DATABASE
```

The restore command intentionally refuses to clean or overwrite an existing
database. Perform a documented restore drill after schema changes and at least
quarterly. A backup is not considered usable until that drill succeeds.
