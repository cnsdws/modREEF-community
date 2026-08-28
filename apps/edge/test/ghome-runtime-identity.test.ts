import { describe, expect, it } from "vitest";

import {
  ghomeCredentialDeviceIdForRuntime,
  ghomeRuntimeDeviceId,
} from "../src/ghome-runtime-identity.js";

const credential = (deviceId: string, runtimeDeviceId?: string) => ({
  deviceId,
  networkAddress: "10.0.0.110",
  localKey: "secret",
  ...(runtimeDeviceId ? { runtimeDeviceId } : {}),
});

describe("ghomeRuntimeDeviceId", () => {
  it("uses the legacy alias for the first GHome strip", () => {
    expect(ghomeRuntimeDeviceId("strip-1", [])).toBe("ghome-wp12");
  });

  it("retains that alias when the same strip is paired again", () => {
    expect(ghomeRuntimeDeviceId("strip-1", [credential("strip-1", "ghome-wp12")]))
      .toBe("ghome-wp12");
  });

  it("does not count a water sensor as the first GHome strip", () => {
    expect(ghomeRuntimeDeviceId("strip-1", [{
      ...credential("water-1"),
      deviceKind: "yinmik-water",
    }])).toBe("ghome-wp12");
  });

  it("gives later strips their stable Tuya device ids", () => {
    expect(ghomeRuntimeDeviceId("strip-2", [credential("strip-1", "ghome-wp12")]))
      .toBe("strip-2");
  });

  it("does not assign a credential to an orphaned legacy runtime card", () => {
    const stored = [credential("strip-1", "strip-1")];
    expect(ghomeCredentialDeviceIdForRuntime("ghome-wp12", stored)).toBeUndefined();
    expect(ghomeCredentialDeviceIdForRuntime("strip-1", stored)).toBe("strip-1");
  });
});
