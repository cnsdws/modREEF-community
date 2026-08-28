const magic = Buffer.from([0, 0, 0, 3]);
const controlFrameLength = 323;

export const mdpPasscodeRequest = Buffer.from([
  0, 0, 0, 3, 5, 0, 0, 0x06, 1, 0,
]);
export const mdpStatusRequest = Buffer.from([
  0, 0, 0, 3, 4, 0, 0, 0x90, 2,
]);

export const mdpMessageType = {
  extendedStatus: 0x00,
  passcode: 0x07,
  loginSuccess: 0x09,
  simpleStatus: 0x91,
  controlAcknowledgement: 0x94,
} as const;

export interface MdpPumpState {
  poweredOn: boolean;
  feeding: boolean;
  programmed: boolean;
  speedPercent: number;
}

export function encodeMdpLogin(passcode: Buffer): Buffer {
  if (passcode.length !== 10) {
    throw new Error("MDP LAN passcode must contain exactly 10 bytes");
  }
  return Buffer.concat([
    Buffer.from([0, 0, 0, 3, 0x0f, 0, 0, 0x08, 0, 0x0a]),
    passcode,
  ]);
}

export function extractMdpPasscode(frame: Buffer): Buffer {
  assertFrame(frame);
  if (frame[7] !== mdpMessageType.passcode || frame.length < 20) {
    throw new Error("Invalid MDP passcode response");
  }
  return Buffer.from(frame.subarray(10, 20));
}

export function encodeMdpPower(sequence: number, on: boolean): Buffer {
  return encodeControl(sequence, 0x01, on ? 0x01 : 0x00);
}

export function encodeMdpSpeed(sequence: number, percent: number): Buffer {
  if (!Number.isInteger(percent) || percent < 30 || percent > 100) {
    throw new Error("MDP speed must be an integer from 30 through 100 percent");
  }
  return encodeControl(sequence, 0x20, 0, percent);
}

export function decodeMdpState(frame: Buffer): MdpPumpState | undefined {
  assertFrame(frame);
  if (
    frame[7] !== mdpMessageType.extendedStatus &&
    frame[7] !== mdpMessageType.simpleStatus
  ) {
    return undefined;
  }
  const state = frame[10];
  const speedPercent = frame[11];
  if (
    state === undefined ||
    speedPercent === undefined ||
    ![0x10, 0x11, 0x15, 0x19].includes(state) ||
    speedPercent > 100
  ) {
    return undefined;
  }
  return {
    poweredOn: state === 0x11 || state === 0x15,
    feeding: state === 0x15,
    programmed: state === 0x19,
    speedPercent,
  };
}

export function mdpFrameLength(buffer: Buffer): number | undefined {
  const start = buffer.indexOf(magic);
  if (start < 0 || buffer.length - start < 5) return undefined;
  const bodyLength = buffer[start + 4];
  if (bodyLength === undefined) return undefined;
  const primaryLength = 5 + bodyLength;
  if (buffer.length - start < primaryLength) return undefined;
  const messageType = buffer[start + 7];
  return start + primaryLength +
    (messageType === mdpMessageType.extendedStatus ? 129 : 0);
}

export function mdpFrameStart(buffer: Buffer): number {
  return buffer.indexOf(magic);
}

function encodeControl(
  sequence: number,
  opcode1: number,
  opcode2 = 0,
  parameter1 = 0,
  parameter2 = 0,
): Buffer {
  if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > 0xffff_ffff) {
    throw new Error("MDP sequence must be an unsigned 32-bit integer");
  }
  const frame = Buffer.alloc(controlFrameLength);
  magic.copy(frame);
  frame[4] = 0xbd;
  frame[5] = 0x02;
  frame[8] = 0x93;
  frame.writeUInt32BE(sequence, 9);
  frame[13] = 0x01;
  frame[21] = opcode1;
  frame[22] = opcode2;
  frame[23] = parameter1;
  frame[24] = parameter2;
  return frame;
}

function assertFrame(frame: Buffer): void {
  if (frame.length < 8 || !frame.subarray(0, 4).equals(magic)) {
    throw new Error("Invalid MDP frame signature");
  }
}
