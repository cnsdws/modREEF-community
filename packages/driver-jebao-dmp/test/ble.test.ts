import { describe, expect, it } from "vitest";

import {
  buildDmpChallengeResponse,
  buildDmpModeFrame,
  buildDmpPowerFrame,
} from "../src/ble.js";

describe("DMP-40 Bluetooth frames", () => {
  it("echoes the captured eight-byte authentication token", () => {
    expect(buildDmpChallengeResponse(
      Buffer.from("000000030d00000700086530373465666534", "hex"),
    ).toString("hex")).toBe("000000030d00000800086530373465666534");
  });

  it.each([
    ["M1", "20"],
    ["M2", "28"],
    ["M3", "38"],
    ["M4", "30"],
    ["M5", "21"],
  ] as const)("encodes %s using its captured mode byte", (mode, expected) => {
    expect(buildDmpModeFrame(0x0b, mode, 100).toString("hex")).toBe(
      `00000003140000930000000b1100000000000001b406${expected}6464`,
    );
  });

  it("encodes flow percentage in the acknowledged mode frame", () => {
    expect(buildDmpModeFrame(0x11, "M3", 30).toString("hex")).toBe(
      "0000000314000093000000111100000000000001b406381e64",
    );
  });

  it("encodes pulse frequency in the mode frame", () => {
    expect(buildDmpModeFrame(0x12, "M2", 65, 35).toString("hex")).toBe(
      "0000000314000093000000121100000000000001b406284123",
    );
  });

  it("encodes the captured power values", () => {
    expect(buildDmpPowerFrame(3, true).toString("hex")).toBe(
      "000000031200009300000003110000000000000000010100",
    );
    expect(buildDmpPowerFrame(4, false).toString("hex")).toBe(
      "000000031200009300000004110000000000000000010000",
    );
  });
});
