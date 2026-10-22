export type WithLock = <T>(key: string, fn: () => Promise<T>) => Promise<T>;

export function createPathLocks(): WithLock {
  const tails = new Map<string, Promise<void>>();

  return async (key, fn) => {
    const prev = tails.get(key);
    const result = prev === undefined ? fn() : prev.then(fn);
    const tail = result.then(
      () => undefined,
      () => undefined
    );
    tails.set(key, tail);

    try {
      return await result;
    } finally {
      if (tails.get(key) === tail) {
        tails.delete(key);
      }
    }
  };
}
