import { describe, test, expect } from "vitest";
import { normalizeStatus } from "@/utils/conversions";

describe("normalizeStatus", () => {
  test("should convert uppercase string to lowercase", () => {
    const result = normalizeStatus("PROCESSING");
    expect(result).toBe("processing");
  });

  test("should convert mixed case string to lowercase", () => {
    const result = normalizeStatus("InProgress");
    expect(result).toBe("inprogress");
  });

  test("should handle already lowercase string", () => {
    const result = normalizeStatus("completed");
    expect(result).toBe("completed");
  });

  test("should handle empty string", () => {
    const result = normalizeStatus("");
    expect(result).toBe("");
  });

  test("should handle string with special characters", () => {
    const result = normalizeStatus("IN_PROGRESS");
    expect(result).toBe("in_progress");
  });

  test("should handle string with numbers", () => {
    const result = normalizeStatus("STATUS123");
    expect(result).toBe("status123");
  });

  test("should handle string with spaces", () => {
    const result = normalizeStatus("IN PROGRESS");
    expect(result).toBe("in progress");
  });

  test("should handle string with hyphen", () => {
    const result = normalizeStatus("IN-PROGRESS");
    expect(result).toBe("in-progress");
  });

  test("should handle single character string", () => {
    const result = normalizeStatus("A");
    expect(result).toBe("a");
  });

  test("should handle string with unicode characters", () => {
    const result = normalizeStatus("ÑOÑO");
    expect(result).toBe("ñoño");
  });

  test("should handle very long string", () => {
    const longString = "A".repeat(1000);
    const result = normalizeStatus(longString);
    expect(result).toBe("a".repeat(1000));
  });

  test("should maintain string with only numbers", () => {
    const result = normalizeStatus("123456");
    expect(result).toBe("123456");
  });

  test("should handle string with leading and trailing whitespace", () => {
    const result = normalizeStatus(" PROCESSING ");
    expect(result).toBe(" processing ");
  });
});