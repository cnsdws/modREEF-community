import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
  GHomeWp12Transport,
  TuyaDps,
  TuyaDpsWrite,
} from "./transport.js";

const execFileAsync = promisify(execFile);

export interface GHomeWp12Connection {
  deviceId: string;
  networkAddress: string;
  localKey: string;
  protocolVersion?: "3.3" | "3.4" | "3.5";
}

export class PythonGHomeWp12Transport
  implements GHomeWp12Transport {
  constructor(
    private readonly scriptPath = "scripts/tuya-bridge.py",
    private readonly cwd = process.cwd(),
    private readonly pythonPath =
      process.env.MODREEF_PYTHON ?? "python3",
    private readonly connection?: GHomeWp12Connection,
  ) {}

  private options() {
    return {
      cwd: this.cwd,
      timeout: 10_000,
      ...(this.connection
        ? {
            env: {
              ...process.env,
              GHOME_WP12_DEVICE_ID: this.connection.deviceId,
              GHOME_WP12_IP: this.connection.networkAddress,
              GHOME_WP12_LOCAL_KEY: this.connection.localKey,
              ...(this.connection.protocolVersion
                ? { TUYA_PROTOCOL_VERSION: this.connection.protocolVersion }
                : {}),
            },
          }
        : {}),
    };
  }

  async readStatus(): Promise<TuyaDps> {
    const { stdout } = await execFileAsync(
      this.pythonPath,
      [this.scriptPath, "status"],
      this.options(),
    );

    const result: unknown = JSON.parse(stdout);

    if (
      typeof result !== "object" ||
      result === null ||
      Array.isArray(result)
    ) {
      throw new Error("Invalid DPS response from Tuya bridge");
    }

    return result as TuyaDps;
  }

  async setValue(dps: number, value: boolean): Promise<void> {
    await execFileAsync(
      this.pythonPath,
      [
        this.scriptPath,
        "set",
        String(dps),
        String(value),
      ],
      this.options(),
    );
  }

  async setValues(values: TuyaDpsWrite): Promise<void> {
    await execFileAsync(
      this.pythonPath,
      [
        this.scriptPath,
        "set-multiple",
        JSON.stringify(values),
      ],
      this.options(),
    );
  }
}
