export function must<T>(value: T): NonNullable<T> {
  if (value === null || value === undefined) {
    throw new Error('expected a value');
  }

  return value;
}
