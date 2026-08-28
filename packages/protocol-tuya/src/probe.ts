import { Socket } from "node:net";

export interface TuyaProbeResult {
  reachable: boolean;
  host: string;
  port: number;
  latencyMs?: number;
  error?: string;
}

export async function probeTuya(
  host: string,
  port = 6668,
  timeoutMs = 2000,
): Promise<TuyaProbeResult> {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const socket = new Socket();

    const finish = (result: TuyaProbeResult) => {
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);

    socket.once("connect", () => {
      finish({
        reachable: true,
        host,
        port,
        latencyMs: Date.now() - startedAt,
      });
    });

    socket.once("timeout", () => {
      finish({
        reachable: false,
        host,
        port,
        error: "Connection timed out",
      });
    });

    socket.once("error", (error) => {
      finish({
        reachable: false,
        host,
        port,
        error: error.message,
      });
    });

    socket.connect(port, host);
  });
}
