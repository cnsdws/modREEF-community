import { createConnection, type Socket } from "node:net";
import {
  decodeMdpState,
  encodeMdpLogin,
  encodeMdpPower,
  encodeMdpSpeed,
  extractMdpPasscode,
  mdpFrameLength,
  mdpFrameStart,
  mdpMessageType,
  mdpPasscodeRequest,
  mdpStatusRequest,
  type MdpPumpState,
} from "./protocol.js";

export interface MdpTransport {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  readState(): Promise<MdpPumpState>;
  setPower(on: boolean): Promise<MdpPumpState>;
  setSpeed(percent: number): Promise<MdpPumpState>;
}

export interface TcpMdpTransportOptions {
  port?: number;
  timeoutMs?: number;
  socketFactory?: typeof createConnection;
  resolveHost?: () => Promise<string>;
}

interface FrameWaiter {
  types: ReadonlySet<number>;
  resolve: (frame: Buffer) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class TcpMdpTransport implements MdpTransport {
  private socket: Socket | undefined;
  private buffer = Buffer.alloc(0);
  private sequence = 1;
  private connecting: Promise<void> | undefined;
  private operationTail: Promise<void> = Promise.resolve();
  private waiter: FrameWaiter | undefined;
  private rediscoverOnNextConnect = false;
  private readonly port: number;
  private readonly timeoutMs: number;
  private readonly socketFactory: typeof createConnection;
  private readonly resolveHost: (() => Promise<string>) | undefined;

  constructor(private host: string, options: TcpMdpTransportOptions = {}) {
    this.port = options.port ?? 12_416;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.socketFactory = options.socketFactory ?? createConnection;
    this.resolveHost = options.resolveHost;
  }

  async connect(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return;
    if (this.connecting) return await this.connecting;
    this.connecting = this.openAuthenticatedSession();
    try {
      await this.connecting;
    } finally {
      this.connecting = undefined;
    }
  }

  async disconnect(): Promise<void> {
    const socket = this.socket;
    this.socket = undefined;
    this.buffer = Buffer.alloc(0);
    this.rejectWaiter(new Error("MDP connection closed"));
    socket?.destroy();
  }

  async readState(): Promise<MdpPumpState> {
    return await this.runExclusive(() => this.withReconnect(() => this.queryState()));
  }

  async setPower(on: boolean): Promise<MdpPumpState> {
    return await this.runExclusive(() => this.withReconnect(async () => {
      await this.sendControl(encodeMdpPower(this.nextSequence(), on));
      return await this.confirmState((state) => state.poweredOn === on);
    }));
  }

  async setSpeed(percent: number): Promise<MdpPumpState> {
    return await this.runExclusive(() => this.withReconnect(async () => {
      await this.sendControl(encodeMdpSpeed(this.nextSequence(), percent));
      return await this.confirmState((state) => state.speedPercent === percent);
    }));
  }

  private async openAuthenticatedSession(): Promise<void> {
    if (this.rediscoverOnNextConnect && this.resolveHost) {
      this.host = await this.resolveHost();
    }
    this.rediscoverOnNextConnect = false;
    const socket = this.socketFactory({ host: this.host, port: this.port });
    this.socket = socket;
    socket.on("data", (chunk) => this.receive(chunk));
    socket.on("error", (error) => this.rejectWaiter(error));
    socket.on("close", () => {
      if (this.socket === socket) this.socket = undefined;
      this.rejectWaiter(new Error("MDP connection closed"));
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Timed out connecting to MDP pump at ${this.host}:${this.port}`));
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
      const passcodeResponse = this.waitFor([mdpMessageType.passcode]);
      socket.write(mdpPasscodeRequest);
      const passcode = extractMdpPasscode(await passcodeResponse);
      try {
        const loginResponse = this.waitFor([mdpMessageType.loginSuccess]);
        socket.write(encodeMdpLogin(passcode));
        await loginResponse;
      } finally {
        passcode.fill(0);
      }
    } catch (error) {
      await this.disconnect();
      throw error;
    }
  }

  private async queryState(): Promise<MdpPumpState> {
    await this.connect();
    const response = this.waitFor([
      mdpMessageType.simpleStatus,
      mdpMessageType.extendedStatus,
    ]);
    this.write(mdpStatusRequest);
    const state = decodeMdpState(await response);
    if (!state) throw new Error("MDP returned an invalid or transitional state");
    return state;
  }

  private async sendControl(frame: Buffer): Promise<void> {
    await this.connect();
    const acknowledgement = this.waitFor([mdpMessageType.controlAcknowledgement]);
    this.write(frame);
    await acknowledgement;
  }

  private async confirmState(
    predicate: (state: MdpPumpState) => boolean,
  ): Promise<MdpPumpState> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (attempt > 0) await delay(250);
      try {
        const state = await this.queryState();
        if (predicate(state)) return state;
      } catch (error) {
        if (attempt === 4) throw error;
      }
    }
    throw new Error("MDP did not confirm the requested state");
  }

  private async withReconnect<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (firstError) {
      await this.disconnect();
      this.rediscoverOnNextConnect = true;
      try {
        return await operation();
      } catch (retryError) {
        await this.disconnect();
        throw new AggregateError(
          [firstError, retryError],
          "MDP request failed after one authenticated reconnect",
        );
      }
    }
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationTail.then(operation, operation);
    this.operationTail = result.then(() => undefined, () => undefined);
    return await result;
  }

  private receive(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length > 0) {
      const start = mdpFrameStart(this.buffer);
      if (start < 0) {
        this.buffer = this.buffer.subarray(Math.max(0, this.buffer.length - 3));
        return;
      }
      if (start > 0) this.buffer = this.buffer.subarray(start);
      const totalLength = mdpFrameLength(this.buffer);
      if (totalLength === undefined || this.buffer.length < totalLength) return;
      const primaryLength = 5 + (this.buffer[4] ?? 0);
      const frame = Buffer.from(this.buffer.subarray(0, primaryLength));
      this.buffer = this.buffer.subarray(totalLength);
      const messageType = frame[7];
      if (messageType === undefined || !this.waiter?.types.has(messageType)) continue;
      const waiter = this.waiter;
      this.waiter = undefined;
      clearTimeout(waiter.timer);
      waiter.resolve(frame);
    }
  }

  private waitFor(types: readonly number[]): Promise<Buffer> {
    if (this.waiter) throw new Error("MDP request overlap detected");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.waiter?.timer === timer) this.waiter = undefined;
        reject(new Error(
          `Timed out waiting for MDP response ${types.map((type) => `0x${type.toString(16)}`).join(" or ")}`,
        ));
      }, this.timeoutMs);
      this.waiter = { types: new Set(types), resolve, reject, timer };
    });
  }

  private write(frame: Buffer): void {
    if (!this.socket || this.socket.destroyed) throw new Error("MDP pump is disconnected");
    this.socket.write(frame);
  }

  private rejectWaiter(error: Error): void {
    const waiter = this.waiter;
    if (!waiter) return;
    this.waiter = undefined;
    clearTimeout(waiter.timer);
    waiter.reject(error);
  }

  private nextSequence(): number {
    const current = this.sequence;
    this.sequence = this.sequence === 0xffff_ffff ? 1 : this.sequence + 1;
    return current;
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
