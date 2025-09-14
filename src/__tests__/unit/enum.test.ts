import { describe, test, expect } from "vitest";
import { enumFromString } from "@/utils/enum";

describe("enumFromString", () => {
  // Test enums for different scenarios
  enum StringEnum {
    ACTIVE = "ACTIVE",
    INACTIVE = "INACTIVE",
    PENDING = "PENDING",
  }

  enum NumericEnum {
    LOW = 1,
    MEDIUM = 2,
    HIGH = 3,
  }

  enum MixedEnum {
    ZERO = 0,
    ONE = "one",
    TWO = "two",
  }

  describe("with string enums", () => {
    test("should return valid enum value when string matches", () => {
      const result = enumFromString(StringEnum, "ACTIVE", StringEnum.INACTIVE);
      expect(result).toBe(StringEnum.ACTIVE);
    });

    test("should return valid enum value for different valid strings", () => {
      expect(enumFromString(StringEnum, "PENDING", StringEnum.ACTIVE)).toBe(StringEnum.PENDING);
      expect(enumFromString(StringEnum, "INACTIVE", StringEnum.ACTIVE)).toBe(StringEnum.INACTIVE);
    });

    test("should return fallback when string does not match any enum value", () => {
      const result = enumFromString(StringEnum, "INVALID", StringEnum.PENDING);
      expect(result).toBe(StringEnum.PENDING);
    });

    test("should return fallback when string is close but not exact match", () => {
      const result = enumFromString(StringEnum, "active", StringEnum.ACTIVE);
      expect(result).toBe(StringEnum.ACTIVE);
      
      const result2 = enumFromString(StringEnum, "ACTIV", StringEnum.INACTIVE);
      expect(result2).toBe(StringEnum.INACTIVE);
    });
  });

  describe("with numeric enums", () => {
    test("should return valid enum value when string matches numeric enum", () => {
      const result = enumFromString(NumericEnum, "1", NumericEnum.MEDIUM);
      expect(result).toBe(NumericEnum.LOW);
    });

    test("should handle all numeric enum values", () => {
      expect(enumFromString(NumericEnum, "2", NumericEnum.LOW)).toBe(NumericEnum.MEDIUM);
      expect(enumFromString(NumericEnum, "3", NumericEnum.LOW)).toBe(NumericEnum.HIGH);
    });

    test("should return fallback for invalid numeric strings", () => {
      const result = enumFromString(NumericEnum, "4", NumericEnum.LOW);
      expect(result).toBe(NumericEnum.LOW);
      
      const result2 = enumFromString(NumericEnum, "0", NumericEnum.HIGH);
      expect(result2).toBe(NumericEnum.HIGH);
    });

    test("should return fallback for non-numeric strings with numeric enums", () => {
      const result = enumFromString(NumericEnum, "LOW", NumericEnum.MEDIUM);
      expect(result).toBe(NumericEnum.MEDIUM);
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

    test("should return fallback for invalid mixed enum values", () => {
      const result = enumFromString(MixedEnum, "three", MixedEnum.ONE);
      expect(result).toBe(MixedEnum.ONE);
    });
  });

  describe("with undefined/null values", () => {
    test("should return fallback when value is undefined", () => {
      const result = enumFromString(StringEnum, undefined, StringEnum.ACTIVE);
      expect(result).toBe(StringEnum.ACTIVE);
    });

    test("should return fallback when value is null (cast as undefined)", () => {
      const result = enumFromString(StringEnum, null as any, StringEnum.PENDING);
      expect(result).toBe(StringEnum.PENDING);
    });

    test("should return fallback when value is empty string", () => {
      const result = enumFromString(StringEnum, "", StringEnum.INACTIVE);
      expect(result).toBe(StringEnum.INACTIVE);
    });
  });

  describe("edge cases", () => {
    test("should handle whitespace strings", () => {
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
      }

      expect(enumFromString(SpecialEnum, "WITH_UNDERSCORE", SpecialEnum.WITH_DASH))
        .toBe(SpecialEnum.WITH_UNDERSCORE);
      expect(enumFromString(SpecialEnum, "WITH-DASH", SpecialEnum.WITH_UNDERSCORE))
        .toBe(SpecialEnum.WITH_DASH);
      expect(enumFromString(SpecialEnum, "WITH SPACE", SpecialEnum.WITH_UNDERSCORE))
        .toBe(SpecialEnum.WITH_SPACE);
    });
  });

  describe("type safety and generics", () => {
    test("should maintain type safety with different enum types", () => {
      // TypeScript should infer correct return types
      const stringResult: StringEnum = enumFromString(StringEnum, "ACTIVE", StringEnum.INACTIVE);
      const numericResult: NumericEnum = enumFromString(NumericEnum, "1", NumericEnum.LOW);
      
      expect(typeof stringResult).toBe("string");
      expect(typeof numericResult).toBe("number");
    });

    test("should work with const assertions", () => {
      const Status = {
        OPEN: "OPEN",
        CLOSED: "CLOSED",
        IN_PROGRESS: "IN_PROGRESS",
      } as const;

      type Status = typeof Status[keyof typeof Status];

      const result = enumFromString(Status, "OPEN", Status.CLOSED);
      expect(result).toBe("OPEN");
    });
  });

  describe("real-world scenarios", () => {
    test("should handle API response parsing", () => {
      // Simulating parsing status from API response
      const apiResponse = { status: "ACTIVE" };
      const status = enumFromString(StringEnum, apiResponse.status, StringEnum.INACTIVE);
      expect(status).toBe(StringEnum.ACTIVE);
    });

    test("should handle query parameter parsing", () => {
      // Simulating parsing enum from URL query parameters
      const queryParam = "PENDING";
      const result = enumFromString(StringEnum, queryParam, StringEnum.ACTIVE);
      expect(result).toBe(StringEnum.PENDING);
    });

    test("should provide safe fallback for malformed data", () => {
      // Simulating malformed/unexpected data
      const malformedData = "UNKNOWN_STATUS";
      const result = enumFromString(StringEnum, malformedData, StringEnum.INACTIVE);
      expect(result).toBe(StringEnum.INACTIVE);
    });

    test("should handle dynamic enum selection", () => {
      const validInputs = ["ACTIVE", "INACTIVE", "PENDING"];
      const invalidInputs = ["EXPIRED", "CANCELLED", ""];
      
      validInputs.forEach(input => {
        const result = enumFromString(StringEnum, input, StringEnum.ACTIVE);
        expect(Object.values(StringEnum)).toContain(result);
      });
      
      invalidInputs.forEach(input => {
        const result = enumFromString(StringEnum, input, StringEnum.INACTIVE);
        expect(result).toBe(StringEnum.INACTIVE);
      });
    });
  });
});