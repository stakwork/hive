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

  test("generates password with length of 12", () => {
    const password = generateSecurePassword(12);
    expect(password).toHaveLength(12);
  });

  test("generates password with length of 8", () => {
    expect(generateSecurePassword(8)).toHaveLength(8);
  });

  test("generates password with length of 24", () => {
    expect(generateSecurePassword(24)).toHaveLength(24);
  });

  test("generates password with length of 50", () => {
    const password = generateSecurePassword(50);
    expect(password).toHaveLength(50);
  });

  test("generates password with length of 100", () => {
    const password = generateSecurePassword(100);
    expect(password).toHaveLength(100);
  });

  test("includes all required character types", () => {
    const password = generateSecurePassword(20);
    expect(/[A-Z]/.test(password)).toBe(true); // uppercase
    expect(/[a-z]/.test(password)).toBe(true); // lowercase
    expect(/[0-9]/.test(password)).toBe(true); // numbers
    expect(/[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/.test(password)).toBe(true); // special chars
  });

  test("includes all character types in longer passwords", () => {
    // Generate a longer password to verify all character types are included
    const password = generateSecurePassword(100);

    const hasLowercase = /[a-z]/.test(password);
    const hasUppercase = /[A-Z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSpecial = /[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/.test(password);

    expect(hasLowercase).toBe(true);
    expect(hasUppercase).toBe(true);
    expect(hasNumber).toBe(true);
    expect(hasSpecial).toBe(true);
  });

  test("only contains characters from the defined charset", () => {
    const charset = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?";
    const password = generateSecurePassword(50);
    for (const char of password) {
      expect(charset.includes(char)).toBe(true);
    }
  });

  test("generates unique passwords", () => {
    const passwords = Array.from({ length: 10 }, () => generateSecurePassword());
    const unique = new Set(passwords);
    expect(unique.size).toBe(passwords.length);
  });

  test("generates different passwords on multiple calls", () => {
    const password1 = generateSecurePassword(20);
    const password2 = generateSecurePassword(20);
    const password3 = generateSecurePassword(20);

    expect(password1).not.toBe(password2);
    expect(password2).not.toBe(password3);
    expect(password1).not.toBe(password3);
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
