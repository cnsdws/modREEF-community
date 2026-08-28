import { createConnection, type Socket } from "node:net";
import {
  decodeMd44RawStatus,
  encodeMd44HeadPower,
  encodeMd44DayInterval,
  encodeMd44DoseSchedule,
  encodeMd44ScheduleEnabled,
  encodeMd44Login,
  extractMd44Passcode,
  inspectGizwitsFrame,
  md44HeadIsRunning,
  md44ScheduleIsEnabled,
  md44MessageType,
  md44PasscodeRequest,
  md44StatusRequest,
  type JebaoMd44RawStatus,
  type Md44DoseSlot,
} from "./protocol.js";

export interface TcpJebaoMd44TransportOptions {
  port?: number;
  timeoutMs?: number;
  socketFactory?: typeof createConnection;
}

interface FrameWaiter {
  types: ReadonlySet<number>;
  accept?: (frame: Buffer) => boolean;
  resolve: (frame: Buffer) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class TcpJebaoMd44Transport {
  private socket: Socket | undefined;
  private buffer = Buffer.alloc(0);
  private waiter: FrameWaiter | undefined;
  private operationTail: Promise<void> = Promise.resolve();
  private nextActionCounter = 1;
  private readonly port: number;
  private readonly timeoutMs: number;
  private readonly socketFactory: typeof createConnection;

  constructor(private readonly host: string, options: TcpJebaoMd44TransportOptions = {}) {
    this.port = options.port ?? 12_416;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.socketFactory = options.socketFactory ?? createConnection;
  }

  async connect(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return;
    const socket = this.socketFactory({ host: this.host, port: this.port });
    this.socket = socket;
    socket.on("data", (chunk) => this.receive(chunk));
    socket.on("error", (error) => this.rejectWaiter(error));
    socket.on("close", () => {
      if (this.socket === socket) this.socket = undefined;
      this.rejectWaiter(new Error("MD-4.4 connection closed"));
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Timed out connecting to MD-4.4 at ${this.host}:${this.port}`));
      }, this.timeoutMs);
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    try {
      const passcodeResponse = this.waitFor([md44MessageType.passcode]);
      socket.write(md44PasscodeRequest);
      const passcode = extractMd44Passcode(await passcodeResponse);
      try {
        const loginResponse = this.waitFor([md44MessageType.login]);
        const login = encodeMd44Login(passcode);
        socket.write(login);
        login.fill(0);
        const response = await loginResponse;
        const layout = inspectGizwitsFrame(response);
        if (!layout || response[layout.messageTypeOffset + 1] !== 0) {
          throw new Error("MD-4.4 rejected LAN login");
        }
      } finally {
        passcode.fill(0);
      }
    } catch (error) {
      await this.disconnect();
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    const socket = this.socket;
    this.socket = undefined;
    this.buffer = Buffer.alloc(0);
    this.rejectWaiter(new Error("MD-4.4 connection closed"));
    socket?.destroy();
  }

  async readRawStatus(): Promise<JebaoMd44RawStatus> {
    return this.exclusive(async () => {
      await this.connect();
      const response = this.waitFor(
        [md44MessageType.status],
        isFullStatusFrame,
      );
      this.write(md44StatusRequest);
      return decodeMd44RawStatus(await response);
    });
  }

  async setHeadPower(head: number, on: boolean): Promise<void> {
    await this.exclusive(async () => {
      await this.connect();
      const counter = this.nextActionCounter;
      this.nextActionCounter = counter === 0xffff_ffff ? 1 : counter + 1;
      const acknowledgement = this.waitFor([md44MessageType.actionAck]);
      this.write(encodeMd44HeadPower(head, on, counter));
      const acknowledgementFrame = await acknowledgement;
      if (
        acknowledgementFrame.length < 12 ||
        acknowledgementFrame.readUInt32BE(acknowledgementFrame.length - 4) !== counter
      ) {
        throw new Error("MD-4.4 returned an invalid action acknowledgement");
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      const statusResponse = this.waitFor(
        [md44MessageType.status],
        isFullStatusFrame,
      );
      this.write(md44StatusRequest);
      const status = decodeMd44RawStatus(await statusResponse);
      if (md44HeadIsRunning(status, head) !== on) {
        throw new Error(
          `MD-4.4 head ${head} did not confirm ${on ? "ON" : "OFF"}`,
        );
      }
    });
  }

  async setHeadSchedule(
    head: number,
    dayInterval: number,
    slots: readonly Md44DoseSlot[],
    enabled: boolean,
  ): Promise<void> {
    await this.exclusive(async () => {
      await this.connect();
      await this.writeAction((counter) => encodeMd44DayInterval(head, dayInterval, counter));
      await this.writeAction((counter) => encodeMd44DoseSchedule(head, slots, counter));
      // The Jebao app commits a table by cycling its schedule flag.
      await this.writeAction((counter) => encodeMd44ScheduleEnabled(head, false, counter));
      if (enabled) {
        await this.writeAction((counter) => encodeMd44ScheduleEnabled(head, true, counter));
      }
      const statusResponse = this.waitFor(
        [md44MessageType.status],
        isFullStatusFrame,
      );
      this.write(md44StatusRequest);
      const status = decodeMd44RawStatus(await statusResponse);
      if (md44ScheduleIsEnabled(status, head) !== enabled) {
        throw new Error(
          `MD-4.4 head ${head} did not confirm its program ${enabled ? "ON" : "OFF"}`,
        );
      }
    });
  }

  private async writeAction(encode: (counter: number) => Buffer): Promise<void> {
    const counter = this.nextActionCounter;
    this.nextActionCounter = counter === 0xffff_ffff ? 1 : counter + 1;
    const acknowledgement = this.waitFor([md44MessageType.actionAck]);
    this.write(encode(counter));
    const frame = await acknowledgement;
    if (frame.length < 12 || frame.readUInt32BE(frame.length - 4) !== counter) {
      throw new Error("MD-4.4 returned an invalid action acknowledgement");
    }
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  private receive(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length > 0) {
      const start = this.buffer.indexOf(Buffer.from([0, 0, 0, 3]));
      if (start < 0) {
        this.buffer = this.buffer.subarray(Math.max(0, this.buffer.length - 3));
        return;
      }
      if (start > 0) this.buffer = this.buffer.subarray(start);
      const layout = inspectGizwitsFrame(this.buffer);
      if (!layout || this.buffer.length < layout.frameLength) return;
      const frame = Buffer.from(this.buffer.subarray(0, layout.frameLength));
      this.buffer = this.buffer.subarray(layout.frameLength);
      const messageType = frame[layout.messageTypeOffset];
      if (messageType === undefined || !this.waiter?.types.has(messageType)) continue;
      if (this.waiter.accept && !this.waiter.accept(frame)) continue;
      const waiter = this.waiter;
      this.waiter = undefined;
      clearTimeout(waiter.timer);
      waiter.resolve(frame);
    }
  }

  private waitFor(
    types: readonly number[],
    accept?: (frame: Buffer) => boolean,
  ): Promise<Buffer> {
    if (this.waiter) throw new Error("MD-4.4 request overlap detected");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.waiter?.timer === timer) this.waiter = undefined;
        reject(new Error(
          `Timed out waiting for MD-4.4 response ${types.map((type) => `0x${type.toString(16)}`).join(" or ")}`,
        ));
      }, this.timeoutMs);
      this.waiter = {
        types: new Set(types),
        ...(accept ? { accept } : {}),
        resolve,
        reject,
        timer,
      };
    });
  }

  private write(frame: Buffer): void {
    if (!this.socket || this.socket.destroyed) throw new Error("MD-4.4 is disconnected");
    this.socket.write(frame);
  }

  private rejectWaiter(error: Error): void {
    const waiter = this.waiter;
    if (!waiter) return;
    this.waiter = undefined;
    clearTimeout(waiter.timer);
    waiter.reject(error);
  }
}

function isFullStatusFrame(frame: Buffer): boolean {
  try {
    decodeMd44RawStatus(frame);
    return true;
  } catch {
    return false;
  }
}
