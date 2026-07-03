/**
 * Unit tests for src/lib/utils/error-frames.ts
 *
 * Tests cover:
 *  - sanitizeFrames: valid frames pass through; missing/invalid filename dropped;
 *    non-array input returns []; partially-malformed entries are dropped;
 *    coercion rules for function/lineno/inApp; no extra fields leaked.
 */
import { describe, it, expect } from "vitest";
import { sanitizeFrames } from "@/lib/utils/error-frames";

describe("sanitizeFrames", () => {
  it("returns empty array for non-array input (null)", () => {
    expect(sanitizeFrames(null)).toEqual([]);
  });

  it("returns empty array for non-array input (string)", () => {
    expect(sanitizeFrames("some stack trace")).toEqual([]);
  });

  it("returns empty array for non-array input (object)", () => {
    expect(sanitizeFrames({ filename: "foo.rb" })).toEqual([]);
  });

  it("returns empty array for non-array input (number)", () => {
    expect(sanitizeFrames(42)).toEqual([]);
  });

  it("returns empty array for non-array input (undefined)", () => {
    expect(sanitizeFrames(undefined)).toEqual([]);
  });

  it("returns empty array for empty array input", () => {
    expect(sanitizeFrames([])).toEqual([]);
  });

  it("passes through a fully-valid frame", () => {
    const result = sanitizeFrames([
      { filename: "app/controllers/users_controller.rb", function: "create", lineno: 42, inApp: true },
    ]);
    expect(result).toEqual([
      { filename: "app/controllers/users_controller.rb", function: "create", lineno: 42, inApp: true },
    ]);
  });

  it("passes through a frame with only filename (minimum valid)", () => {
    const result = sanitizeFrames([{ filename: "app/models/user.rb" }]);
    expect(result).toEqual([{ filename: "app/models/user.rb" }]);
  });

  it("drops entry with missing filename", () => {
    const result = sanitizeFrames([
      { function: "create", lineno: 10, inApp: true },
    ]);
    expect(result).toEqual([]);
  });

  it("drops entry with null filename", () => {
    const result = sanitizeFrames([{ filename: null, function: "create" }]);
    expect(result).toEqual([]);
  });

  it("drops entry with numeric filename", () => {
    const result = sanitizeFrames([{ filename: 123, function: "create" }]);
    expect(result).toEqual([]);
  });

  it("drops entry with empty string filename", () => {
    const result = sanitizeFrames([{ filename: "", function: "create" }]);
    expect(result).toEqual([]);
  });

  it("drops entry with whitespace-only filename", () => {
    const result = sanitizeFrames([{ filename: "   ", function: "create" }]);
    expect(result).toEqual([]);
  });

  it("trims whitespace from filename", () => {
    const result = sanitizeFrames([{ filename: "  app/foo.rb  " }]);
    expect(result).toEqual([{ filename: "app/foo.rb" }]);
  });

  it("drops malformed entries while keeping valid ones (mixed array)", () => {
    const result = sanitizeFrames([
      { filename: "app/controllers/users_controller.rb", function: "index", lineno: 5, inApp: true },
      { function: "broken", lineno: 10 }, // no filename — dropped
      { filename: "", lineno: 20 }, // empty filename — dropped
      { filename: "lib/utils.rb", lineno: 99, inApp: false },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ filename: "app/controllers/users_controller.rb", function: "index", lineno: 5, inApp: true });
    expect(result[1]).toEqual({ filename: "lib/utils.rb", lineno: 99, inApp: false });
  });

  it("coerces function from number to string", () => {
    const result = sanitizeFrames([{ filename: "foo.rb", function: 42 }]);
    expect(result[0].function).toBe("42");
  });

  it("drops function when it coerces to empty string", () => {
    const result = sanitizeFrames([{ filename: "foo.rb", function: "" }]);
    expect(result[0]).not.toHaveProperty("function");
  });

  it("omits function when undefined", () => {
    const result = sanitizeFrames([{ filename: "foo.rb" }]);
    expect(result[0]).not.toHaveProperty("function");
  });

  it("omits function when null", () => {
    const result = sanitizeFrames([{ filename: "foo.rb", function: null }]);
    expect(result[0]).not.toHaveProperty("function");
  });

  it("coerces lineno from string to integer", () => {
    const result = sanitizeFrames([{ filename: "foo.rb", lineno: "42" }]);
    expect(result[0].lineno).toBe(42);
  });

  it("drops lineno when it is 0", () => {
    const result = sanitizeFrames([{ filename: "foo.rb", lineno: 0 }]);
    expect(result[0]).not.toHaveProperty("lineno");
  });

  it("drops lineno when it is negative", () => {
    const result = sanitizeFrames([{ filename: "foo.rb", lineno: -5 }]);
    expect(result[0]).not.toHaveProperty("lineno");
  });

  it("drops lineno when it is a float", () => {
    const result = sanitizeFrames([{ filename: "foo.rb", lineno: 3.5 }]);
    expect(result[0]).not.toHaveProperty("lineno");
  });

  it("drops lineno when it is NaN", () => {
    const result = sanitizeFrames([{ filename: "foo.rb", lineno: NaN }]);
    expect(result[0]).not.toHaveProperty("lineno");
  });

  it("drops lineno when it is a non-numeric string", () => {
    const result = sanitizeFrames([{ filename: "foo.rb", lineno: "abc" }]);
    expect(result[0]).not.toHaveProperty("lineno");
  });

  it("omits lineno when undefined", () => {
    const result = sanitizeFrames([{ filename: "foo.rb" }]);
    expect(result[0]).not.toHaveProperty("lineno");
  });

  it("coerces inApp from truthy value to true", () => {
    const result = sanitizeFrames([{ filename: "foo.rb", inApp: 1 }]);
    expect(result[0].inApp).toBe(true);
  });

  it("coerces inApp from falsy value to false", () => {
    const result = sanitizeFrames([{ filename: "foo.rb", inApp: 0 }]);
    expect(result[0].inApp).toBe(false);
  });

  it("omits inApp when undefined", () => {
    const result = sanitizeFrames([{ filename: "foo.rb" }]);
    expect(result[0]).not.toHaveProperty("inApp");
  });

  it("omits inApp when null", () => {
    const result = sanitizeFrames([{ filename: "foo.rb", inApp: null }]);
    expect(result[0]).not.toHaveProperty("inApp");
  });

  it("strips unknown extra fields (only locked fields are kept)", () => {
    const result = sanitizeFrames([
      { filename: "foo.rb", function: "bar", lineno: 10, inApp: true, extraField: "leaked!", colno: 5 },
    ]);
    expect(result[0]).toEqual({ filename: "foo.rb", function: "bar", lineno: 10, inApp: true });
    expect(result[0]).not.toHaveProperty("extraField");
    expect(result[0]).not.toHaveProperty("colno");
  });

  it("handles non-object items in the array (drops them)", () => {
    const result = sanitizeFrames([
      null,
      undefined,
      "string-item",
      42,
      { filename: "valid.rb" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ filename: "valid.rb" });
  });

  it("handles nested arrays as entries (drops them)", () => {
    const result = sanitizeFrames([[{ filename: "nested.rb" }]]);
    expect(result).toEqual([]);
  });
});
