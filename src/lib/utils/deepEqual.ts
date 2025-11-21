/**
 * Deep equality comparison for objects, arrays, and primitives
 * Native JavaScript implementation to replace lodash.isEqual
 */
export function deepEqual(a: any, b: any): boolean {
  // Strict equality check (covers primitives, null, undefined, same reference)
  if (a === b) return true;

  // Check for null/undefined cases
  if (a == null || b == null) return a === b;

  // Check if both are dates
  if (a instanceof Date && b instanceof Date) {
    return a.getTime() === b.getTime();
  }

  // Check if both are regular expressions
  if (a instanceof RegExp && b instanceof RegExp) {
    return a.toString() === b.toString();
  }

  // Check if types are different
  if (typeof a !== typeof b) return false;

  // For primitive types that aren't equal
  if (typeof a !== "object") return false;

  // Handle arrays
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  // One is array, one is not
  if (Array.isArray(a) || Array.isArray(b)) return false;

  // Handle objects
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!keysB.includes(key)) return false;
    if (!deepEqual(a[key], b[key])) return false;
  }

  return true;
}
