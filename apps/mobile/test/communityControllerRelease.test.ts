import { describe, expect, it } from "vitest";

import {
  communityControllerImagerUrl,
  communityControllerRelease,
  isCommunityDownloadPath,
} from "../src/communityControllerRelease";

describe("community controller release links", () => {
  it("uses stable public HTTPS release assets", () => {
    expect(communityControllerRelease.manifestUrl).toBe(
      "https://github.com/cnsdws/modREEF-community/releases/latest/download/modreef-controller.rpi-imager-manifest",
    );
    expect(communityControllerRelease.imageUrl).toMatch(/^https:\/\//);
    expect(communityControllerRelease.imagerMacUrl).toBe(
      "https://downloads.raspberrypi.com/imager/imager_latest.dmg",
    );
    expect(communityControllerRelease.imagerWindowsUrl).toBe(
      "https://downloads.raspberrypi.com/imager/imager_latest.exe",
    );
    expect(communityControllerImagerUrl()).toBe(
      `rpi-imager://open?repo=${encodeURIComponent(communityControllerRelease.manifestUrl)}`,
    );
  });

  it("exposes only the public download route", () => {
    expect(isCommunityDownloadPath("/download")).toBe(true);
    expect(isCommunityDownloadPath("/download/")).toBe(true);
    expect(isCommunityDownloadPath("/downloads")).toBe(false);
    expect(isCommunityDownloadPath("/")).toBe(false);
  });
});
