/**
 * Generic validation utilities for common patterns
 */

/**
 * Validates that a value is a valid member of a Prisma enum
 *
 * @param value - The value to validate
 * @param enumObj - The Prisma enum object (e.g., FeatureStatus, TaskStatus)
 * @param fieldName - Name of the field being validated (for error messages)
 * @throws {Error} If the value is not a valid enum member
 *
 * @example
 * import { FeatureStatus } from "@prisma/client";
 * validateEnum(data.status, FeatureStatus, "status");
 */
export function validateEnum<T extends Record<string, string>>(
  value: string | undefined,
  enumObj: T,
  fieldName: string,
): void {
  if (!value) return;

  if (!Object.values(enumObj).includes(value)) {
    throw new Error(`Invalid ${fieldName}. Must be one of: ${Object.values(enumObj).join(", ")}`);
  }
}
