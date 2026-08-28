# Feed Mode Acceptance

## Software acceptance

Automated acceptance coverage verifies that Feed Mode:

- targets configured return-pump and skimmer equipment on generic power channels;
- shuts the skimmer down before the return pump;
- persists the active plan before issuing device commands;
- rolls back equipment already paused when startup fails partway through;
- restores the return pump before the skimmer;
- keeps the skimmer off for the configured 0–30 minute restart delay;
- persists and resumes the recovery delay after an Edge restart;
- reports the recovery phase and remaining time to the app;
- preserves manual control-mode overrides made during the cycle;
- resumes an active persisted cycle after an Edge restart; and
- records cycle start and completion in the aquarium activity log.

Coverage: `apps/edge/test/feed-mode-runtime.test.ts` and
`packages/automation/test/feed-mode.test.ts`.

## Physical acceptance — pending

Do not mark the physical Feed Mode milestone complete until all of the following
have been observed on a qualified device:

- [ ] Assign a return pump and skimmer to separate WP12 outlets.
- [ ] Confirm both devices begin online, in AUTO, and powered on.
- [ ] Start Feed Mode and observe skimmer OFF before return pump OFF.
- [ ] Cancel Feed Mode and observe return pump ON immediately.
- [ ] Confirm the app displays Feed Mode recovery and its remaining time.
- [ ] Confirm the skimmer remains OFF for the configured restart delay, then turns ON.
- [ ] Repeat and allow the cycle to finish automatically.
- [ ] Apply a manual OFF override during the cycle and confirm it is preserved.
- [ ] Restart Edge during the cycle and confirm the paused state is recovered.
- [ ] Interrupt network access and confirm behavior is reported without an unsafe state change.
- [ ] Confirm the activity log contains the start, device transitions, and completion.

Live WP12 validation requires local credentials stored outside source control.
