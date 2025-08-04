// src/utils/enum.ts

/**
 * Safely convert a string to a TypeScript enum value, or return a fallback.
 * @param enumObj The enum object
 * @param value The string value to convert
 * @param fallback The fallback value if conversion fails
 */
export function enumFromString<T>(
  enumObj: T,
  value: string | undefined,
  fallback: T[keyof T],
): T[keyof T] {
  if (!value) return fallback;
  const values = Object.values(enumObj as object) as string[];
  return values.includes(value) ? (value as T[keyof T]) : fallback;
}
