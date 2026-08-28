import { execFile } from "node:child_process";
import { isIPv4 } from "node:net";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface ProcessResult {
  stdout: string;
}

type ProcessRunner = (
  executable: string,
  arguments_: string[],
  options: {
    cwd: string;
    timeout: number;
  },
) => Promise<ProcessResult>;

export function isPrivateIPv4(address: string): boolean {
  if (!isIPv4(address)) {
    return false;
  }

  const octets = address.split(".").map(Number);

  return (
    octets[0] === 10 ||
    (octets[0] === 172 &&
      octets[1] !== undefined &&
      octets[1] >= 16 &&
      octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

export class GHomeDiscovery {
  constructor(
    private readonly repositoryRoot: string,
    private readonly pythonPath =
      process.env.MODREEF_PYTHON ?? "python3",
    private readonly run: ProcessRunner = execFileAsync,
  ) {}

  async findPrivateAddress(deviceId: string): Promise<string> {
    const { stdout } = await this.run(
      this.pythonPath,
      ["scripts/tuya-discover.py", deviceId],
      {
        cwd: this.repositoryRoot,
        timeout: 30_000,
      },
    );

    const address = stdout.trim();

    if (!isPrivateIPv4(address)) {
      throw new Error(
        "Tuya discovery did not return a private IPv4 address",
      );
    }

    return address;
  }
}
