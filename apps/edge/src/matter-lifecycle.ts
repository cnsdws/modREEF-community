export class MatterLifecycleCoordinator {
  private queue: Promise<void> = Promise.resolve();

  runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  commission<T>({
    attempt,
    isRecoverable,
    onRecovering,
  }: {
    attempt: () => Promise<T>;
    isRecoverable: (error: unknown) => boolean;
    onRecovering?: () => void;
  }): Promise<T> {
    return this.runExclusive(async () => {
      try {
        return await attempt();
      } catch (firstError) {
        if (!isRecoverable(firstError)) throw firstError;
        onRecovering?.();
        return attempt();
      }
    });
  }

  remove({
    label,
    isPresent,
    remove,
  }: {
    label: string;
    isPresent: () => boolean;
    remove: () => Promise<void>;
  }): Promise<void> {
    return this.runExclusive(async () => {
      if (isPresent()) await remove();
      if (isPresent()) {
        throw new Error(`Matter node ${label} remained commissioned after deletion`);
      }
    });
  }
}
