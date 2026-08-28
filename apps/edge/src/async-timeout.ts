export class OperationTimeoutError extends Error {
  constructor(label: string, timeoutMilliseconds: number) {
    super(`${label} timed out after ${timeoutMilliseconds} ms`);
    this.name = "OperationTimeoutError";
  }
}

export async function withTimeout<T>(
  operation: Promise<T>,
  timeoutMilliseconds: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new OperationTimeoutError(label, timeoutMilliseconds)),
      timeoutMilliseconds,
    );
    timer.unref?.();
  });

  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
