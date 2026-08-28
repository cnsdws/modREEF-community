import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getControllerReleaseChannel,
  getControllerUpdateStatus,
  requestControllerUpdate,
  setControllerReleaseChannel,
} from "../src/controller-update.js";

let directory: string | undefined;

afterEach(() => {
  vi.unstubAllEnvs();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});

describe("controller update request", () => {
  it("persists requested status and creates the systemd path trigger", async () => {
    directory = mkdtempSync(join(tmpdir(), "modreef-controller-update-"));
    vi.stubEnv("MODREEF_DATA_DIR", directory);
    const release = "a".repeat(64);
    writeFileSync(join(directory, "release.sha256"), `${release}\n`);

    await requestControllerUpdate();

    expect(readFileSync(join(directory, "update.request"), "utf8")).toContain("T");
    expect(getControllerUpdateStatus()).toMatchObject({
      status: "requested",
      installedRelease: release,
      automaticUpdatesEnabled: true,
      releaseChannel: "production",
    });
  });

  it("persists a staging channel atomically", async () => {
    const testDirectory = mkdtempSync(join(tmpdir(), "modreef-controller-update-"));
    directory = testDirectory;
    vi.stubEnv("MODREEF_DATA_DIR", testDirectory);

    await setControllerReleaseChannel("staging");

    expect(getControllerReleaseChannel()).toBe("staging");
    expect(readFileSync(join(testDirectory, "release-channel"), "utf8")).toBe("staging\n");
    expect(() => readFileSync(join(testDirectory, "update.request"), "utf8")).toThrow();
    expect(getControllerUpdateStatus().releaseChannel).toBe("staging");
  });
});
