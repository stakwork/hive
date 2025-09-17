import { describe, test, expect } from "vitest";
import { slugify } from "@/utils/slugify";

describe("slugify", () => {
  test("should convert basic string to lowercase slug", () => {
    expect(slugify("Hello World")).toBe("hello-world");
    expect(slugify("Test String")).toBe("test-string");
  });

  test("should replace non-alphanumeric characters with hyphens", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
    expect(slugify("Test@String#123")).toBe("test-string-123");
    expect(slugify("Special$Characters%Here")).toBe("special-characters-here");
  });

  test("should remove leading and trailing hyphens", () => {
    expect(slugify("@Hello World@")).toBe("hello-world");
    expect(slugify("!!!Test String!!!")).toBe("test-string");
    expect(slugify("---Leading and Trailing---")).toBe("leading-and-trailing");
  });

  test("should replace multiple consecutive hyphens with single hyphen", () => {
    expect(slugify("Hello   World")).toBe("hello-world");
    expect(slugify("Test@@@String")).toBe("test-string");
    expect(slugify("Multiple---Hyphens")).toBe("multiple-hyphens");
  });

  test("should handle empty string", () => {
    expect(slugify("")).toBe("");
  });

  test("should handle string with only special characters", () => {
    expect(slugify("@@@!!!###")).toBe("");
    expect(slugify("   ")).toBe("");
    expect(slugify("---")).toBe("");
  });

  test("should handle numbers and letters correctly", () => {
    expect(slugify("Test123")).toBe("test123");
    expect(slugify("ABC123DEF")).toBe("abc123def");
    expect(slugify("123 Test 456")).toBe("123-test-456");
  });

  test("should handle mixed case and preserve numbers", () => {
    expect(slugify("CamelCaseString123")).toBe("camelcasestring123");
    expect(slugify("UPPERCASE_WITH_UNDERSCORES")).toBe("uppercase-with-underscores");
  });

  test("should handle complex real-world scenarios", () => {
    expect(slugify("How to Use React.js in 2024!")).toBe("how-to-use-react-js-in-2024");
    expect(slugify("User Profile & Settings")).toBe("user-profile-settings");
    expect(slugify("E-mail: contact@example.com")).toBe("e-mail-contact-example-com");
  });

  test("should handle unicode characters", () => {
    expect(slugify("Café & Restaurant")).toBe("caf-restaurant");
    expect(slugify("naïve résumé")).toBe("na-ve-r-sum");
  });
});
