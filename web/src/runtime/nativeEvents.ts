export type NativeEvent = [string, unknown];

export function unwrapNativeEvent(input: unknown): NativeEvent | null {
  let value = input;
  for (let depth = 0; depth < 2 && typeof value === "string"; depth += 1) {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }

  if (isNativeEvent(value)) return value;
  if (isRecord(value) && isNativeEvent(value.args)) return value.args;
  return null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNativeEvent(value: unknown): value is NativeEvent {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    typeof value[0] === "string"
  );
}
