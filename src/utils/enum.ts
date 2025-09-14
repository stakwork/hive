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
  
  const enumObj_ = enumObj as Record<string, any>;
  const enumValues = Object.values(enumObj_);
  const enumKeys = Object.keys(enumObj_);
  
  // Check if this is a numeric enum (has numeric keys)
  const hasNumericKeys = enumKeys.some(key => !isNaN(Number(key)));
  
  if (hasNumericKeys) {
    // First check if it's a numeric value that maps to an enum member
    const numericValue = Number(value);
    if (!isNaN(numericValue) && enumValues.includes(numericValue)) {
      return numericValue as T[keyof T];
    }
    
    // For mixed enums, check if the string value exists directly in the values
    // But exclude reverse mapping values (like "LOW" from numeric enum) that exist due to reverse mapping
    const numericKeysAsStrings = enumKeys.filter(key => !isNaN(Number(key)));
    const reverseMapValues = numericKeysAsStrings.map(key => enumObj_[key]);
    
    if (enumValues.includes(value) && !reverseMapValues.includes(value)) {
      return value as T[keyof T];
    }
    
    return fallback;
  } else {
    // For string enums, check direct string match
    if (enumValues.includes(value)) {
      return value as T[keyof T];
    }
    return fallback;
  }
}
