import type { CommandId } from "@modreef/api-contract";

export class CommandIdConflictError extends Error {
  constructor(commandId: CommandId) {
    super(`Command ID was reused with different input: ${commandId}`);
    this.name = "CommandIdConflictError";
  }
}

interface CommandEntry<T> {
  fingerprint: string;
  result: Promise<T>;
}

export class CommandRegistry {
  private readonly entries = new Map<CommandId, CommandEntry<unknown>>();

  constructor(private readonly maximumEntries = 1_000) {}

  execute<T>(
    commandId: CommandId,
    fingerprint: string,
    operation: () => Promise<T>,
  ): Promise<{ result: T; replayed: boolean }> {
    const existing = this.entries.get(commandId);

    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new CommandIdConflictError(commandId);
      }

      return (existing.result as Promise<T>).then((result) => ({
        result,
        replayed: true,
      }));
    }

    const result = operation();
    this.entries.set(commandId, { fingerprint, result });
    this.trim();

    return result.then((value) => ({ result: value, replayed: false }));
  }

  private trim(): void {
    while (this.entries.size > this.maximumEntries) {
      const oldest = this.entries.keys().next().value;

      if (oldest === undefined) {
        return;
      }

      this.entries.delete(oldest);
    }
  }
}
