#!/usr/bin/env node

import { createConnection } from "node:net";

const host = process.argv[2];
const summaryOnly = process.argv.includes("--summary");
if (!host) {
  console.error("Usage: probe-jebao-md44-status.mjs <device-ip>");
  process.exitCode = 2;
} else {
  const magic = Buffer.from([0, 0, 0, 3]);
  const passcodeRequest = Buffer.from("0000000303000006", "hex");
  const statusRequest = Buffer.from("000000030400009002", "hex");
  const socket = createConnection({ host, port: 12_416 });
  let buffer = Buffer.alloc(0);
  let phase = "passcode";
  const timeout = setTimeout(
    () => fail(new Error(`Timed out waiting for MD-4.4 ${phase} response`)),
    15_000,
  );

  socket.on("connect", () => socket.write(passcodeRequest));
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    inspectFrames();
  });
  socket.on("error", fail);

  function inspectFrames() {
    while (buffer.length >= 9) {
      const start = buffer.indexOf(magic);
      if (start < 0) return;
      if (start > 0) buffer = buffer.subarray(start);
      const typeAt7 = buffer[7];
      const typeAt8 = buffer[8];
      if (phase === "passcode" && typeAt7 === 0x07) {
        const passcodeLength = buffer[9];
        const frameLength = 10 + (passcodeLength ?? 0);
        if (buffer.length < frameLength) return;
        const passcode = Buffer.from(buffer.subarray(10, frameLength));
        buffer = buffer.subarray(frameLength);
        const login = Buffer.concat([
          Buffer.from([0, 0, 0, 3, 5 + passcode.length, 0, 0, 0x08, 0, passcode.length]),
          passcode,
        ]);
        passcode.fill(0);
        phase = "login";
        socket.write(login);
        login.fill(0);
        continue;
      }
      if (phase === "login" && typeAt7 === 0x09) {
        if (buffer.length < 9) return;
        if (buffer[8] !== 0) return fail(new Error("MD-4.4 rejected LAN login"));
        buffer = buffer.subarray(9);
        phase = "status";
        setTimeout(() => socket.write(statusRequest), 250);
        continue;
      }
      if (phase === "status" && typeAt7 === 0x09) {
        buffer = buffer.subarray(9);
        continue;
      }
      if (phase === "status" && typeAt7 === 0x62 && buffer[8] === 0) {
        buffer = buffer.subarray(9);
        continue;
      }
      if (phase === "status") {
        const length = decodeVarint(buffer, 4);
        if (!length) return;
        const frameLength = 4 + length.bytes + length.value;
        if (buffer.length < frameLength) return;
        const frame = buffer.subarray(0, frameLength);
        clearTimeout(timeout);
        console.log(JSON.stringify({
          host,
          length: frame.length,
          messageType: frame[length.bytes + 6],
          ...(summaryOnly ? {} : { hex: frame.toString("hex") }),
        }));
        socket.destroy();
        phase = "done";
        return;
      }
      return;
    }
  }

  function decodeVarint(input, offset) {
    let value = 0;
    let shift = 0;
    for (let index = offset; index < input.length && index < offset + 5; index += 1) {
      const byte = input[index];
      value |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return { value, bytes: index - offset + 1 };
      shift += 7;
    }
    return undefined;
  }

  function fail(error) {
    clearTimeout(timeout);
    console.error(error.message);
    socket.destroy();
    process.exitCode = 1;
  }
}
