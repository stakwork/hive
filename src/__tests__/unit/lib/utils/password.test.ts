import { describe, test, expect } from "vitest";
import { generateSecurePassword, validatePassword } from "@/lib/utils/password";

describe("generateSecurePassword", () => {
  test("generates password with default length of 20", () => {
    const password = generateSecurePassword();
    expect(password).toHaveLength(20);
  });

  test("generates password with custom length", () => {
    const password = generateSecurePassword(16);
    expect(password).toHaveLength(16);
  });

  test("includes all required character types", () => {
    const password = generateSecurePassword(20);
    expect(/[A-Z]/.test(password)).toBe(true); // uppercase
    expect(/[a-z]/.test(password)).toBe(true); // lowercase
    expect(/[0-9]/.test(password)).toBe(true); // numbers
    expect(/[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/.test(password)).toBe(true); // special chars
  });

  test("generates unique passwords", () => {
    const passwords = Array.from({ length: 5 }, () => generateSecurePassword());
    const unique = new Set(passwords);
    expect(unique.size).toBe(5);
  });
});

describe("validatePassword", () => {
  test("validates strong password", () => {
    const result = validatePassword("Test123!@#Pass");
    expect(result.isValid).toBe(true);
    expect(result.message).toBeUndefined();
  });

  test("rejects short password", () => {
    const result = validatePassword("Test123!");
    expect(result.isValid).toBe(false);
    expect(result.message).toBe("Password must be at least 12 characters long");
  });

  test("rejects password without uppercase", () => {
    const result = validatePassword("test123!@#pass");
    expect(result.isValid).toBe(false);
    expect(result.message).toContain("uppercase");
  });

  test("rejects password without lowercase", () => {
    const result = validatePassword("TEST123!@#PASS");
    expect(result.isValid).toBe(false);
    expect(result.message).toContain("lowercase");
  });

  test("rejects password without numbers", () => {
    const result = validatePassword("TestPass!@#Word");
    expect(result.isValid).toBe(false);
    expect(result.message).toContain("numbers");
  });

  test("rejects password without special characters", () => {
    const result = validatePassword("TestPass123Word");
    expect(result.isValid).toBe(false);
    expect(result.message).toContain("special characters");
  });

  test("rejects empty password", () => {
    const result = validatePassword("");
    expect(result.isValid).toBe(false);
    expect(result.message).toBe("Password must be at least 12 characters long");
  });
});