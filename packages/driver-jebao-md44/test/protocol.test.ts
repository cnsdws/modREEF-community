import { describe, expect, it } from "vitest";
import {
  decodeMd44RawStatus,
  encodeMd44HeadPower,
  encodeMd44DayInterval,
  encodeMd44DoseSchedule,
  encodeMd44ScheduleEnabled,
  encodeMd44Login,
  extractMd44Passcode,
  inspectGizwitsFrame,
  md44PasscodeRequest,
  md44StatusRequest,
  md44HeadIsRunning,
  translateMd44IntervalProgram,
} from "../src/protocol.js";

describe("MD-4.4 protocol", () => {
  it("encodes the verified authentication and status requests", () => {
    expect(md44PasscodeRequest.toString("hex")).toBe("0000000303000006");
    expect(md44StatusRequest.toString("hex")).toBe("000000030400009002");
    const response = Buffer.from("000000030f000007000a4142434445464748494a", "hex");
    const passcode = extractMd44Passcode(response);
    expect(passcode.toString()).toBe("ABCDEFGHIJ");
    expect(encodeMd44Login(passcode).toString("hex")).toBe(
      "000000030f000008000a4142434445464748494a",
    );
  });

  it("decodes GizWits base-128 long-frame lengths", () => {
    const frame = Buffer.concat([
      Buffer.from("000000039c0600009103", "hex"),
      Buffer.alloc(792),
    ]);
    expect(frame).toHaveLength(802);
    expect(inspectGizwitsFrame(frame)).toEqual({
      frameLength: 802,
      messageTypeOffset: 8,
    });
    const status = decodeMd44RawStatus(frame);
    expect(status.messageType).toBe(0x91);
    expect(status.action).toBe(3);
    expect(status.payload).toHaveLength(792);
  });

  it("rejects truncated long frames", () => {
    const frame = Buffer.from("000000039c0600009103", "hex");
    expect(() => decodeMd44RawStatus(frame)).toThrow(/Incomplete/);
  });

  it("encodes the four verified per-head power flags", () => {
    const head1On = encodeMd44HeadPower(1, true, 6);
    expect(head1On).toHaveLength(808);
    expect(head1On.subarray(0, 24).toString("hex")).toBe(
      "00000003a206000093000000060100000000020000020000",
    );
    expect(encodeMd44HeadPower(1, false, 7).subarray(0, 24).toString("hex"))
      .toBe("00000003a206000093000000070100000000020000000000");
    expect(encodeMd44HeadPower(2, true, 8).subarray(16, 24).toString("hex"))
      .toBe("0000040000040000");
    expect(encodeMd44HeadPower(3, false, 9).subarray(16, 24).toString("hex"))
      .toBe("0000080000000000");
    expect(encodeMd44HeadPower(4, false, 10).subarray(16, 24).toString("hex"))
      .toBe("0000100000000000");
    expect(() => encodeMd44HeadPower(5, true, 1)).toThrow(/1 through 4/);
  });

  it("reads the four running-head bits from live status", () => {
    const frame = Buffer.concat([
      Buffer.from("000000039c0600009103007e0b", "hex"),
      Buffer.alloc(789),
    ]);
    const status = decodeMd44RawStatus(frame);
    expect(md44HeadIsRunning(status, 1)).toBe(true);
    expect(md44HeadIsRunning(status, 2)).toBe(false);
    expect(md44HeadIsRunning(status, 3)).toBe(true);
    expect(md44HeadIsRunning(status, 4)).toBe(false);
  });

  it("encodes the captured native Pump 1 schedule", () => {
    const interval = encodeMd44DayInterval(1, 2, 13);
    expect(interval.subarray(9, 24).toString("hex"))
      .toBe("0000000d0100001000000000000002");
    const schedule = encodeMd44DoseSchedule(1, [
      { hour: 13, minute: 11, milliliters: 7 },
      { hour: 14, minute: 11, milliliters: 8 },
      { hour: 15, minute: 11, milliliters: 10 },
    ], 14);
    expect(schedule.subarray(9, 24).toString("hex"))
      .toBe("0000000e0100200000000000000000");
    expect(schedule.subarray(32, 44).toString("hex"))
      .toBe("0d0b00070e0b00080f0b000a");
    expect(encodeMd44ScheduleEnabled(1, false, 17).subarray(9, 24).toString("hex"))
      .toBe("000000110100000002000000000000");
    expect(encodeMd44ScheduleEnabled(1, true, 18).subarray(9, 24).toString("hex"))
      .toBe("000000120100000002000002000000");
  });

  it("encodes each head using the offsets captured from the Jebao app", () => {
    const captures = [
      { head: 1, day: 1, time: [14, 25], ml: 5, table: 32, selector: 0x20, flag: 0x02 },
      { head: 2, day: 2, time: [14, 30], ml: 6, table: 128, selector: 0x40, flag: 0x04 },
      { head: 3, day: 3, time: [14, 35], ml: 7, table: 224, selector: 0x80, flag: 0x08 },
      { head: 4, day: 4, time: [14, 40], ml: 8, table: 320, selector: 0x100, flag: 0x10 },
    ] as const;

    for (const capture of captures) {
      const interval = encodeMd44DayInterval(capture.head, capture.day, 1);
      expect(interval[16]).toBe(0x10 << (capture.head - 1));
      expect(interval[22 + capture.head]).toBe(capture.day);

      const schedule = encodeMd44DoseSchedule(capture.head, [{
        hour: capture.time[0], minute: capture.time[1], milliliters: capture.ml,
      }], 2);
      expect(schedule.readUInt16BE(14)).toBe(capture.selector);
      expect(schedule.subarray(capture.table, capture.table + 4).toString("hex"))
        .toBe(`${capture.time[0].toString(16).padStart(2, "0")}${capture.time[1].toString(16).padStart(2, "0")}000${capture.ml}`);

      const enabled = encodeMd44ScheduleEnabled(capture.head, true, 3);
      expect(enabled[17]).toBe(capture.flag);
      expect(enabled[20]).toBe(capture.flag);
    }
  });

  it("translates modREEF repeat programs without changing their meaning", () => {
    expect(translateMd44IntervalProgram({
      startTime: "13:11", intervalSeconds: 2 * 86_400,
      weekdays: [0, 1, 2, 3, 4, 5, 6], doseMilliliters: 7,
    })).toEqual({
      dayInterval: 2,
      slots: [{ hour: 13, minute: 11, milliliters: 7 }],
    });
    expect(translateMd44IntervalProgram({
      startTime: "01:00", intervalSeconds: 6 * 3_600,
      weekdays: [0, 1, 2, 3, 4, 5, 6], doseMilliliters: 8,
    }).slots.map(({ hour }) => hour)).toEqual([1, 7, 13, 19]);
    expect(() => translateMd44IntervalProgram({
      startTime: "01:00", intervalSeconds: 5 * 3_600,
      weekdays: [0, 1, 2, 3, 4, 5, 6], doseMilliliters: 8,
    })).toThrow(/divide evenly/);
  });
});
