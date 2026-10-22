export function createDebounce(quietMs: number, maxWaitMs: number, fire: () => void) {
  let first: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined = undefined;

  function poke(): void {
    const now = Date.now();
    first ??= now;
    clearTimeout(timer);
    timer = setTimeout(
      () => {
        first = null;
        fire();
      },
      Math.max(0, Math.min(quietMs, first + maxWaitMs - now))
    );
  }

  function reset(): void {
    clearTimeout(timer);
    first = null;
  }

  return {
    get waiting(): boolean {
      return first !== null;
    },
    poke,
    reset,
    cancel: () => clearTimeout(timer),
  };
}
