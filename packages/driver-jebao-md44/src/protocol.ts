const magic = Buffer.from([0, 0, 0, 3]);

export const md44PasscodeRequest = Buffer.from("0000000303000006", "hex");
export const md44StatusRequest = Buffer.from("000000030400009002", "hex");

export interface Md44DoseSlot {
  hour: number;
  minute: number;
  milliliters: number;
}

export interface Md44IntervalProgramInput {
  startTime: string;
  intervalSeconds: number;
  weekdays: readonly number[];
  doseMilliliters?: number;
}

export function translateMd44IntervalProgram(
  program: Md44IntervalProgramInput,
): { dayInterval: number; slots: Md44DoseSlot[] } {
  if ([...new Set(program.weekdays)].sort().join(",") !== "0,1,2,3,4,5,6") {
    throw new Error("The MD-4.4 native scheduler requires all active days");
  }
  if (!Number.isInteger(program.doseMilliliters) || program.doseMilliliters! < 1 ||
      program.doseMilliliters! > 0xffff) {
    throw new Error("The MD-4.4 native scheduler requires a whole-milliliter dose");
  }
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(program.startTime);
  if (!match || !Number.isInteger(program.intervalSeconds) || program.intervalSeconds < 60 ||
      program.intervalSeconds % 60 !== 0) {
    throw new Error("The MD-4.4 native scheduler requires whole-minute times and intervals");
  }
  const day = 86_400;
  const startMinutes = Number(match[1]) * 60 + Number(match[2]);
  if (program.intervalSeconds < day) {
    if (day % program.intervalSeconds !== 0) {
      throw new Error("The MD-4.4 repeat interval must divide evenly into 24 hours");
    }
    const count = day / program.intervalSeconds;
    if (count > 20) throw new Error("The MD-4.4 supports at most 20 doses per day");
    const stepMinutes = program.intervalSeconds / 60;
    const slots = Array.from({ length: count }, (_, index) => {
      const minutes = (startMinutes + index * stepMinutes) % 1_440;
      return {
        hour: Math.floor(minutes / 60),
        minute: minutes % 60,
        milliliters: program.doseMilliliters!,
      };
    }).sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
    return { dayInterval: 1, slots };
  }
  if (program.intervalSeconds % day !== 0 || program.intervalSeconds / day > 255) {
    throw new Error("The MD-4.4 multi-day interval must be a whole number from 1 to 255 days");
  }
  return {
    dayInterval: program.intervalSeconds / day,
    slots: [{
      hour: Math.floor(startMinutes / 60),
      minute: startMinutes % 60,
      milliliters: program.doseMilliliters!,
    }],
  };
}

function actionFrame(counter: number): Buffer {
  if (!Number.isInteger(counter) || counter < 0 || counter > 0xffff_ffff) {
    throw new Error("MD-4.4 action counter must be an unsigned 32-bit integer");
  }
  const frame = Buffer.alloc(808);
  Buffer.from("00000003a206000093", "hex").copy(frame);
  frame.writeUInt32BE(counter, 9);
  frame[13] = 1;
  return frame;
}

export function encodeMd44HeadPower(
  head: number,
  on: boolean,
  counter: number,
): Buffer {
  if (!Number.isInteger(head) || head < 1 || head > 4) {
    throw new Error("MD-4.4 head must be 1 through 4");
  }
  // Captured from the Jebao iPad app against firmware 4.1.4. This firmware
  // uses an 808-byte frame and 32-bit selector/value bitmaps. The older
  // 416-byte, 16-bit community frame is acknowledged but ignored.
  const selector = 1 << head;
  const frame = actionFrame(counter);
  // Firmware 4.1.4 packs its expanded Boolean selector and value maps at
  // bytes 18 and 21 respectively (captured app frames 6 and 7).
  frame[18] = selector;
  frame[21] = on ? selector : 0;
  return frame;
}

export function encodeMd44DayInterval(
  head: number,
  dayInterval: number,
  counter: number,
): Buffer {
  assertHead(head);
  if (!Number.isInteger(dayInterval) || dayInterval < 1 || dayInterval > 255) {
    throw new Error("MD-4.4 day interval must be 1 through 255");
  }
  const frame = actionFrame(counter);
  frame[16] = 0x10 << (head - 1);
  frame[22 + head] = dayInterval;
  return frame;
}

export function encodeMd44DoseSchedule(
  head: number,
  slots: readonly Md44DoseSlot[],
  counter: number,
): Buffer {
  assertHead(head);
  if (slots.length > 20) throw new Error("MD-4.4 supports at most 20 daily doses");
  const frame = actionFrame(counter);
  frame.writeUInt16BE(0x20 << (head - 1), 14);
  slots.forEach((slot, index) => {
    if (!Number.isInteger(slot.hour) || slot.hour < 0 || slot.hour > 23 ||
        !Number.isInteger(slot.minute) || slot.minute < 0 || slot.minute > 59 ||
        !Number.isInteger(slot.milliliters) || slot.milliliters < 1 || slot.milliliters > 0xffff) {
      throw new Error("MD-4.4 dose slots require a valid time and whole milliliters");
    }
    // Each head owns a 96-byte table. A fresh four-head capture from the
    // Jebao app confirmed that the active tables begin at bytes 32, 128,
    // 224, and 320. Bytes 36+ can be echoed by the device but do not run.
    const offset = 32 + (head - 1) * 96 + index * 4;
    frame[offset] = slot.hour;
    frame[offset + 1] = slot.minute;
    frame.writeUInt16BE(slot.milliliters, offset + 2);
  });
  return frame;
}

export function encodeMd44ScheduleEnabled(
  head: number,
  enabled: boolean,
  counter: number,
): Buffer {
  assertHead(head);
  const frame = actionFrame(counter);
  const flag = 0x02 << (head - 1);
  frame[17] = flag;
  frame[20] = enabled ? flag : 0;
  return frame;
}

function assertHead(head: number): void {
  if (!Number.isInteger(head) || head < 1 || head > 4) {
    throw new Error("MD-4.4 head must be 1 through 4");
  }
}

export const md44MessageType = {
  passcode: 0x07,
  login: 0x09,
  pong: 0x16,
  subscription: 0x62,
  status: 0x91,
  actionAck: 0x94,
} as const;

export interface GizwitsFrameLayout {
  frameLength: number;
  messageTypeOffset: number;
}

export interface JebaoMd44RawStatus {
  messageType: number;
  action: number;
  payload: Buffer;
  frame: Buffer;
}

export function encodeMd44Login(passcode: Buffer): Buffer {
  if (passcode.length < 10 || passcode.length > 32) {
    throw new Error("MD-4.4 LAN passcode must contain 10 through 32 bytes");
  }
  return Buffer.concat([
    Buffer.from([0, 0, 0, 3, 5 + passcode.length, 0, 0, 0x08, 0, passcode.length]),
    passcode,
  ]);
}

export function inspectGizwitsFrame(buffer: Buffer): GizwitsFrameLayout | undefined {
  if (buffer.length < 5 || !buffer.subarray(0, 4).equals(magic)) return undefined;
  const length = decodeVarint(buffer, 4);
  if (!length) return undefined;
  return {
    frameLength: 4 + length.bytes + length.value,
    messageTypeOffset: 6 + length.bytes,
  };
}

export function extractMd44Passcode(frame: Buffer): Buffer {
  const layout = inspectCompleteFrame(frame);
  if (frame[layout.messageTypeOffset] !== md44MessageType.passcode) {
    throw new Error("Invalid MD-4.4 passcode response");
  }
  const lengthOffset = layout.messageTypeOffset + 2;
  const passcodeLength = frame[lengthOffset];
  if (
    passcodeLength === undefined ||
    passcodeLength < 10 ||
    passcodeLength > 32 ||
    lengthOffset + 1 + passcodeLength > frame.length
  ) throw new Error("Invalid MD-4.4 passcode length");
  return Buffer.from(frame.subarray(lengthOffset + 1, lengthOffset + 1 + passcodeLength));
}

export function decodeMd44RawStatus(frame: Buffer): JebaoMd44RawStatus {
  const layout = inspectCompleteFrame(frame);
  const messageType = frame[layout.messageTypeOffset];
  if (messageType !== md44MessageType.status) {
    throw new Error("Invalid MD-4.4 status response");
  }
  const action = frame[layout.messageTypeOffset + 1];
  if (action === undefined) throw new Error("MD-4.4 status response has no action");
  return {
    messageType,
    action,
    payload: Buffer.from(frame.subarray(layout.messageTypeOffset + 2)),
    frame: Buffer.from(frame),
  };
}

export function md44HeadIsRunning(status: JebaoMd44RawStatus, head: number): boolean {
  if (!Number.isInteger(head) || head < 1 || head > 4) {
    throw new Error("MD-4.4 head must be 1 through 4");
  }
  const activeBitmap = status.payload[2];
  if (activeBitmap === undefined) {
    throw new Error("MD-4.4 status has no active-head bitmap");
  }
  return (activeBitmap & (1 << head)) !== 0;
}

export function md44ScheduleIsEnabled(status: JebaoMd44RawStatus, head: number): boolean {
  assertHead(head);
  const enabledBitmap = status.payload[1];
  if (enabledBitmap === undefined) {
    throw new Error("MD-4.4 status has no schedule-enable bitmap");
  }
  return (enabledBitmap & (0x02 << (head - 1))) !== 0;
}

function inspectCompleteFrame(frame: Buffer): GizwitsFrameLayout {
  const layout = inspectGizwitsFrame(frame);
  if (!layout || frame.length < layout.frameLength) {
    throw new Error("Incomplete or invalid GizWits frame");
  }
  return layout;
}

function decodeVarint(
  buffer: Buffer,
  offset: number,
): { value: number; bytes: number } | undefined {
  let value = 0;
  let multiplier = 1;
  for (let index = offset; index < buffer.length && index < offset + 5; index += 1) {
    const byte = buffer[index];
    if (byte === undefined) return undefined;
    value += (byte & 0x7f) * multiplier;
    if ((byte & 0x80) === 0) return { value, bytes: index - offset + 1 };
    multiplier *= 128;
  }
  return undefined;
}
