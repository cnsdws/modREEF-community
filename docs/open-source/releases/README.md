# Public release decisions

Each public release decision records:

- semantic version and controller tag;
- exact private production source commit;
- exact clean-history public repository commit;
- source archive SHA-256;
- controller image SHA-256;
- automated qualification links;
- physical Raspberry Pi 4 and Raspberry Pi 5 acceptance results;
- approving project steward and date.

The archive hash is recorded after the final source commit exists, so it is not
stored inside the archive whose digest it describes. The authoritative record
is the immutable GitHub release and its checksum asset.
