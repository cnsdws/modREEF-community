# Public community release process

The private development repository and public community repository have
deliberately unrelated Git histories. Never push, mirror, or expose private
development history to the public repository.

## Source release

1. Select the exact production-qualified source commit.
2. Run all CI, container, factory, license, and secret checks.
3. Complete the human approval checklist in `PUBLICATION_REVIEW.md`.
4. Generate a source archive with `scripts/create-public-snapshot.sh`.
5. Record its SHA-256 hash, source commit, reviewer, and date in the release
   decision and GitHub release notes.
6. Extract the archive into a fresh checkout of the public repository, keeping
   only the public repository's `.git` directory.
7. Submit the resulting change through a pull request and require public CI.

The signed staging channel is the authoritative immutable Edge candidate.
GitHub Actions also mirrors each candidate for seven days when artifact storage
is available; failure of that convenience mirror does not invalidate a signed
candidate that was successfully published to staging.

## Controller image release

1. Merge the approved public source snapshot.
2. Create a signed `controller-vMAJOR.MINOR.PATCH` tag on the approved public
   commit. The workflow publishes the result as a prerelease.
3. The Controller image workflow builds and verifies the compressed image,
   checksum, Raspberry Pi Imager manifest, installation guide, and provenance
   attestation. Its seven-day GitHub Actions mirror is non-blocking because the
   immutable release asset and attestation are the authoritative public copies.
4. Flash the published artifact through Raspberry Pi Imager—not a local build—
   onto clean media for both Raspberry Pi 4 and Raspberry Pi 5 acceptance.
5. Confirm first boot, discovery, claim, update, restart, backup, restore, and
   removal behavior on both models.
6. Record the acceptance result in the release notes, clear the prerelease flag,
   and mark the GitHub release as latest only after both models pass.

## Release authority

The project steward approves public source and controller-image releases. A
release must never bypass required checks, expose private material, or depend on
cloud availability for aquarium safety.
