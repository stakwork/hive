import { describe, test, expect } from "vitest";
import { enumFromString } from "@/utils/enum";

describe("enumFromString", () => {
  // Test enums for different scenarios
  enum StringEnum {
    ACTIVE = "ACTIVE",
    INACTIVE = "INACTIVE",
    PENDING = "PENDING",
    COMPLETED = "COMPLETED",
  }

  enum NumericEnum {
    LOW = 1,
    MEDIUM = 2,
    HIGH = 3,
    CRITICAL = 4,
  }

  enum MixedEnum {
    ZERO = 0,
    ONE = "one",
    TWO = "two",
    THREE = 3,
  }

  enum AutoNumericEnum {
    FIRST,
    SECOND,
    THIRD,
  }

  describe("with string enums", () => {
    test("should return valid enum value when string matches exactly", () => {
      const result = enumFromString(StringEnum, "ACTIVE", StringEnum.INACTIVE);
      expect(result).toBe(StringEnum.ACTIVE);
    });

    test("should return all valid enum values correctly", () => {
      expect(enumFromString(StringEnum, "ACTIVE", StringEnum.PENDING)).toBe(StringEnum.ACTIVE);
      expect(enumFromString(StringEnum, "INACTIVE", StringEnum.PENDING)).toBe(StringEnum.INACTIVE);
      expect(enumFromString(StringEnum, "PENDING", StringEnum.ACTIVE)).toBe(StringEnum.PENDING);
      expect(enumFromString(StringEnum, "COMPLETED", StringEnum.ACTIVE)).toBe(StringEnum.COMPLETED);
    });

    test("should return fallback when string does not match any enum value", () => {
      const result = enumFromString(StringEnum, "INVALID", StringEnum.PENDING);
      expect(result).toBe(StringEnum.PENDING);
    });

    test("should return fallback for case-sensitive mismatches", () => {
      expect(enumFromString(StringEnum, "active", StringEnum.ACTIVE)).toBe(StringEnum.ACTIVE);
      expect(enumFromString(StringEnum, "Active", StringEnum.INACTIVE)).toBe(StringEnum.INACTIVE);
      expect(enumFromString(StringEnum, "ACTIV", StringEnum.PENDING)).toBe(StringEnum.PENDING);
    });

    test("should return fallback for partial matches", () => {
      const result = enumFromString(StringEnum, "ACT", StringEnum.COMPLETED);
      expect(result).toBe(StringEnum.COMPLETED);
    });
  });

  describe("with numeric enums", () => {
    test("should return valid enum value when string matches numeric value", () => {
      const result = enumFromString(NumericEnum, "1", NumericEnum.MEDIUM);
      expect(result).toBe(NumericEnum.LOW);
    });

    test("should handle all numeric enum values correctly", () => {
      expect(enumFromString(NumericEnum, "1", NumericEnum.HIGH)).toBe(NumericEnum.LOW);
      expect(enumFromString(NumericEnum, "2", NumericEnum.LOW)).toBe(NumericEnum.MEDIUM);
      expect(enumFromString(NumericEnum, "3", NumericEnum.LOW)).toBe(NumericEnum.HIGH);
      expect(enumFromString(NumericEnum, "4", NumericEnum.LOW)).toBe(NumericEnum.CRITICAL);
    });

    test("should return fallback for invalid numeric strings", () => {
      expect(enumFromString(NumericEnum, "5", NumericEnum.LOW)).toBe(NumericEnum.LOW);
      expect(enumFromString(NumericEnum, "0", NumericEnum.HIGH)).toBe(NumericEnum.HIGH);
      expect(enumFromString(NumericEnum, "-1", NumericEnum.MEDIUM)).toBe(NumericEnum.MEDIUM);
    });

    test("should return fallback for non-numeric strings with numeric enums", () => {
      expect(enumFromString(NumericEnum, "LOW", NumericEnum.MEDIUM)).toBe(NumericEnum.MEDIUM);
      expect(enumFromString(NumericEnum, "HIGH", NumericEnum.LOW)).toBe(NumericEnum.LOW);
    });

    test("should handle auto-incremented numeric enums", () => {
      expect(enumFromString(AutoNumericEnum, "0", AutoNumericEnum.SECOND)).toBe(AutoNumericEnum.FIRST);
      expect(enumFromString(AutoNumericEnum, "1", AutoNumericEnum.FIRST)).toBe(AutoNumericEnum.SECOND);
      expect(enumFromString(AutoNumericEnum, "2", AutoNumericEnum.FIRST)).toBe(AutoNumericEnum.THIRD);
    });
  });

  describe("with mixed enums", () => {
    test("should handle mixed enum with numeric zero", () => {
      const result = enumFromString(MixedEnum, "0", MixedEnum.ONE);
      expect(result).toBe(MixedEnum.ZERO);
    });

    test("should handle mixed enum with string values", () => {
      expect(enumFromString(MixedEnum, "one", MixedEnum.ZERO)).toBe(MixedEnum.ONE);
      expect(enumFromString(MixedEnum, "two", MixedEnum.ZERO)).toBe(MixedEnum.TWO);
    });

    test("should handle mixed enum with numeric values", () => {
      const result = enumFromString(MixedEnum, "3", MixedEnum.ONE);
      expect(result).toBe(MixedEnum.THREE);
    });

    test("should return fallback for invalid mixed enum values", () => {
      expect(enumFromString(MixedEnum, "three", MixedEnum.ONE)).toBe(MixedEnum.ONE);
      expect(enumFromString(MixedEnum, "4", MixedEnum.TWO)).toBe(MixedEnum.TWO);
      expect(enumFromString(MixedEnum, "invalid", MixedEnum.ZERO)).toBe(MixedEnum.ZERO);
    });
  });

  describe("with undefined/null values", () => {
    test("should return fallback when value is undefined", () => {
      const result = enumFromString(StringEnum, undefined, StringEnum.ACTIVE);
      expect(result).toBe(StringEnum.ACTIVE);
    });

    test("should return fallback when value is null", () => {
      const result = enumFromString(StringEnum, null as any, StringEnum.PENDING);
      expect(result).toBe(StringEnum.PENDING);
    });

    test("should return fallback when value is empty string", () => {
      const result = enumFromString(StringEnum, "", StringEnum.INACTIVE);
      expect(result).toBe(StringEnum.INACTIVE);
    });
  });

  describe("edge cases", () => {
    test("should handle whitespace strings (no trimming)", () => {
      const result = enumFromString(StringEnum, "  ACTIVE  ", StringEnum.INACTIVE);
      expect(result).toBe(StringEnum.INACTIVE); // Exact match required, no trimming
    });

    test("should be case sensitive", () => {
      const result = enumFromString(StringEnum, "Active", StringEnum.PENDING);
      expect(result).toBe(StringEnum.PENDING);
    });

    test("should handle special characters in enum values", () => {
      enum SpecialEnum {
        WITH_UNDERSCORE = "WITH_UNDERSCORE",
        WITH_DASH = "WITH-DASH",
        WITH_SPACE = "WITH SPACE",
        WITH_DOTS = "with.dots",
      }

      expect(enumFromString(SpecialEnum, "WITH_UNDERSCORE", SpecialEnum.WITH_DASH))
        .toBe(SpecialEnum.WITH_UNDERSCORE);
      expect(enumFromString(SpecialEnum, "WITH-DASH", SpecialEnum.WITH_UNDERSCORE))
        .toBe(SpecialEnum.WITH_DASH);
      expect(enumFromString(SpecialEnum, "WITH SPACE", SpecialEnum.WITH_UNDERSCORE))
        .toBe(SpecialEnum.WITH_SPACE);
      expect(enumFromString(SpecialEnum, "with.dots", SpecialEnum.WITH_UNDERSCORE))
        .toBe(SpecialEnum.WITH_DOTS);
    });

    test("should handle numeric strings that could be confused with array indices", () => {
      const result = enumFromString(NumericEnum, "10", NumericEnum.LOW);
      expect(result).toBe(NumericEnum.LOW);
    });

    test("should handle floating point numbers as strings", () => {
      const result = enumFromString(NumericEnum, "1.5", NumericEnum.MEDIUM);
      expect(result).toBe(NumericEnum.MEDIUM); // Should fallback since 1.5 is not valid
    });
  });

  describe("type safety and generics", () => {
    test("should maintain type safety with different enum types", () => {
      const stringResult: StringEnum = enumFromString(StringEnum, "ACTIVE", StringEnum.INACTIVE);
      const numericResult: NumericEnum = enumFromString(NumericEnum, "1", NumericEnum.LOW);
      
      expect(typeof stringResult).toBe("string");
      expect(typeof numericResult).toBe("number");
      expect(stringResult).toBe("ACTIVE");
      expect(numericResult).toBe(1);
    });

    test("should work with const assertions", () => {
      const Status = {
        OPEN: "OPEN",
        CLOSED: "CLOSED",
        IN_PROGRESS: "IN_PROGRESS",
      } as const;

      type StatusType = typeof Status[keyof typeof Status];

      const result = enumFromString(Status, "OPEN", Status.CLOSED);
      expect(result).toBe("OPEN");
      
      const invalidResult = enumFromString(Status, "INVALID", Status.IN_PROGRESS);
      expect(invalidResult).toBe("IN_PROGRESS");
    });
  });

  describe("real-world scenarios", () => {
    test("should handle API response parsing", () => {
      // Simulating parsing status from API response
      const apiResponse = { status: "ACTIVE", priority: "2" };
      
      const status = enumFromString(StringEnum, apiResponse.status, StringEnum.INACTIVE);
      const priority = enumFromString(NumericEnum, apiResponse.priority, NumericEnum.LOW);
      
      expect(status).toBe(StringEnum.ACTIVE);
      expect(priority).toBe(NumericEnum.MEDIUM);
    });

    test("should handle query parameter parsing", () => {
      // Simulating parsing enum from URL query parameters
      const searchParams = new URLSearchParams("?status=PENDING&priority=3");
      const status = enumFromString(StringEnum, searchParams.get("status") || "", StringEnum.ACTIVE);
      const priority = enumFromString(NumericEnum, searchParams.get("priority") || "", NumericEnum.LOW);
      
      expect(status).toBe(StringEnum.PENDING);
      expect(priority).toBe(NumericEnum.HIGH);
    });

    test("should provide safe fallback for malformed data", () => {
      // Simulating malformed/unexpected data from external sources
      const malformedInputs = ["UNKNOWN_STATUS", "999", "", null, undefined];
      
      malformedInputs.forEach(input => {
        const stringResult = enumFromString(StringEnum, input as any, StringEnum.INACTIVE);
        const numericResult = enumFromString(NumericEnum, input as any, NumericEnum.LOW);
        
        expect(stringResult).toBe(StringEnum.INACTIVE);
        expect(numericResult).toBe(NumericEnum.LOW);
      });
    });

    test("should handle dynamic enum selection with validation", () => {
      const validStringInputs = ["ACTIVE", "INACTIVE", "PENDING", "COMPLETED"];
      const invalidStringInputs = ["EXPIRED", "CANCELLED", "UNKNOWN", ""];
      
      validStringInputs.forEach(input => {
        const result = enumFromString(StringEnum, input, StringEnum.ACTIVE);
        expect(Object.values(StringEnum)).toContain(result);
        expect(result).toBe(input); // Should match exactly for valid inputs
      });
      
      invalidStringInputs.forEach(input => {
        const result = enumFromString(StringEnum, input, StringEnum.INACTIVE);
        expect(result).toBe(StringEnum.INACTIVE);
      });
    });

    test("should handle configuration parsing", () => {
      // Simulating parsing configuration values
      const config = {
        logLevel: "2",
        status: "ACTIVE",
        mode: "invalid_mode"
      };

      enum LogLevel {
        ERROR = 1,
        WARN = 2,
        INFO = 3,
        DEBUG = 4,
      }

      const logLevel = enumFromString(LogLevel, config.logLevel, LogLevel.INFO);
      const status = enumFromString(StringEnum, config.status, StringEnum.INACTIVE);
      const mode = enumFromString(StringEnum, config.mode, StringEnum.PENDING);

      expect(logLevel).toBe(LogLevel.WARN);
      expect(status).toBe(StringEnum.ACTIVE);
      expect(mode).toBe(StringEnum.PENDING); // Falls back due to invalid value
    });
  });

  describe("performance and edge cases", () => {
    test("should handle large enums efficiently", () => {
      const LargeEnum = Array.from({ length: 100 }, (_, i) => [`ITEM_${i}`, `ITEM_${i}`])
        .reduce((acc, [key, value]) => ({ ...acc, [key]: value }), {});

      const result = enumFromString(LargeEnum, "ITEM_50", "FALLBACK" as any);
      expect(result).toBe("ITEM_50");

      const invalidResult = enumFromString(LargeEnum, "ITEM_999", "FALLBACK" as any);
      expect(invalidResult).toBe("FALLBACK");
    });

    test("should handle enum with numeric string values", () => {
      enum NumericStringEnum {
        ONE = "1",
        TWO = "2", 
        THREE = "3",
      }

      expect(enumFromString(NumericStringEnum, "1", NumericStringEnum.TWO)).toBe(NumericStringEnum.ONE);
      expect(enumFromString(NumericStringEnum, "2", NumericStringEnum.ONE)).toBe(NumericStringEnum.TWO);
      expect(enumFromString(NumericStringEnum, "3", NumericStringEnum.ONE)).toBe(NumericStringEnum.THREE);
      expect(enumFromString(NumericStringEnum, "4", NumericStringEnum.TWO)).toBe(NumericStringEnum.TWO);
    });
  });
});