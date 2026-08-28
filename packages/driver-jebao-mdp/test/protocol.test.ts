import { describe, expect, it } from "vitest";
import {
  decodeMdpState,
  encodeMdpLogin,
  encodeMdpPower,
  encodeMdpSpeed,
  extractMdpPasscode,
  mdpFrameLength,
  mdpPasscodeRequest,
  mdpStatusRequest,
} from "../src/protocol.js";

describe("MDP protocol", () => {
  it("encodes the verified passcode request and login", () => {
    expect(mdpPasscodeRequest.toString("hex")).toBe("00000003050000060100");
    const response = Buffer.from("000000030f000007000a4142434445464748494a", "hex");
    const passcode = extractMdpPasscode(response);
    expect(passcode.toString()).toBe("ABCDEFGHIJ");
    expect(encodeMdpLogin(passcode).toString("hex")).toBe(
      "000000030f000008000a4142434445464748494a",
    );
  });

  it("encodes the verified status, power, and speed messages", () => {
    expect(mdpStatusRequest.toString("hex")).toBe("000000030400009002");
    const power = encodeMdpPower(0x01020304, true);
    expect(power).toHaveLength(323);
    expect(power.readUInt32BE(9)).toBe(0x01020304);
    expect([...power.subarray(21, 25)]).toEqual([0x01, 0x01, 0, 0]);
    const speed = encodeMdpSpeed(2, 35);
    expect([...speed.subarray(21, 25)]).toEqual([0x20, 0, 35, 0]);
  });

  it("rejects unverified speeds below 30 percent", () => {
    expect(() => encodeMdpSpeed(1, 29)).toThrow(/30 through 100/);
  });

  it("decodes stable states and rejects transitional zero state", () => {
    const stable = Buffer.from([0, 0, 0, 3, 7, 0, 0, 0, 0, 0, 0x11, 35]);
    expect(decodeMdpState(stable)).toEqual({
      poweredOn: true,
      feeding: false,
      programmed: false,
      speedPercent: 35,
    });
    const transitional = Buffer.from(stable);
    transitional[10] = 0;
    transitional[11] = 0;
    expect(decodeMdpState(transitional)).toBeUndefined();
  });

  it("includes the 129-byte extended-status padding in stream length", () => {
    const frame = Buffer.concat([
      Buffer.from([0, 0, 0, 3, 7, 0, 0, 0, 0, 0, 0x10, 30]),
      Buffer.alloc(129, 0xee),
    ]);
    expect(mdpFrameLength(frame)).toBe(frame.length);
  });
});
