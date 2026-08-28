import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { TcpMdpTransport } from "../src/transport.js";

const passcode = Buffer.from("ABCDEFGHIJ");

describe("TcpMdpTransport", () => {
  let server: Server | undefined;
  let sockets: Socket[] = [];

  afterEach(async () => {
    for (const socket of sockets) socket.destroy();
    sockets = [];
    if (server) await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  });

  it("requests an ephemeral passcode, controls the pump, and consumes padding", async () => {
    let poweredOn = false;
    let speed = 30;
    let passcodeRequests = 0;
    server = createServer((socket) => {
      sockets.push(socket);
      socket.on("data", (data) => {
        if (data[7] === 0x06) {
          passcodeRequests += 1;
          socket.write(frame(0x07, Buffer.concat([Buffer.from([0, 0]), passcode])));
          return;
        }
        if (data[7] === 0x08) {
          expect(data.subarray(10, 20)).toEqual(passcode);
          socket.write(frame(0x09));
          return;
        }
        if (data[7] === 0x90) {
          socket.write(Buffer.concat([
            statusFrame(poweredOn, speed),
            Buffer.alloc(129, 0xee),
          ]));
          return;
        }
        if (data.length === 323 && data[8] === 0x93) {
          if (data[21] === 0x01) poweredOn = data[22] === 1;
          if (data[21] === 0x20) speed = data[23] ?? speed;
          socket.write(frame(0x94));
        }
      });
    });
    const port = await listen(server);
    const transport = new TcpMdpTransport("127.0.0.1", { port, timeoutMs: 1_000 });

    await transport.connect();
    expect(await transport.readState()).toMatchObject({ poweredOn: false, speedPercent: 30 });
    expect(await transport.setPower(true)).toMatchObject({ poweredOn: true });
    expect(await transport.setSpeed(35)).toMatchObject({ speedPercent: 35 });
    expect(passcodeRequests).toBe(1);
    await transport.disconnect();
  });

  it("requests a new passcode after reconnecting", async () => {
    let sessions = 0;
    server = createServer((socket) => {
      sockets.push(socket);
      sessions += 1;
      socket.on("data", (data) => {
        if (data[7] === 0x06) socket.write(frame(0x07, Buffer.concat([Buffer.from([0, 0]), passcode])));
        else if (data[7] === 0x08) socket.write(frame(0x09));
        else if (data[7] === 0x90) {
          socket.write(Buffer.concat([statusFrame(false, 30), Buffer.alloc(129)]));
        }
      });
    });
    const port = await listen(server);
    const transport = new TcpMdpTransport("127.0.0.1", { port, timeoutMs: 1_000 });
    await transport.connect();
    await transport.disconnect();
    await transport.connect();
    expect(await transport.readState()).toMatchObject({ speedPercent: 30 });
    expect(sessions).toBe(2);
    await transport.disconnect();
  });
});

function frame(messageType: number, payload = Buffer.alloc(0)): Buffer {
  const body = Buffer.concat([Buffer.from([0, 0, messageType]), payload]);
  return Buffer.concat([Buffer.from([0, 0, 0, 3, body.length]), body]);
}

function statusFrame(poweredOn: boolean, speed: number): Buffer {
  return frame(0x00, Buffer.from([0, 0, poweredOn ? 0x11 : 0x10, speed]));
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  return address.port;
}
