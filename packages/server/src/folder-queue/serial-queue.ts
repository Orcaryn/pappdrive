// a promise chain, not blockConcurrencyWhile, which resets the Durable Object after 30 seconds.
export function createSerialQueue(): <T>(job: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();

  return job => {
    const result = tail.then(job);
    tail = result.catch(() => undefined);

    return result;
  };
}
