import { describe, test, expect } from "vitest";
import { generateRandomPassword } from "@/utils/randomPassword";

describe("generateRandomPassword", () => {
  const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+[]{}|;:,.<>?";

  test("should generate password with default length of 12", () => {
    const password = generateRandomPassword();
    expect(password).toHaveLength(12);
  });

  test("should generate password with custom length", () => {
    expect(generateRandomPassword(8)).toHaveLength(8);
    expect(generateRandomPassword(16)).toHaveLength(16);
    expect(generateRandomPassword(24)).toHaveLength(24);
  });

  test("should generate password with minimum length of 1", () => {
    const password = generateRandomPassword(1);
    expect(password).toHaveLength(1);
    expect(charset.includes(password)).toBe(true);
  });

  test("should only contain characters from the defined charset", () => {
    const password = generateRandomPassword(50);
    for (const char of password) {
      expect(charset.includes(char)).toBe(true);
    }
  });

  test("should generate different passwords on multiple calls", () => {
    const passwords = Array.from({ length: 10 }, () => generateRandomPassword());
    const uniquePasswords = new Set(passwords);
    expect(uniquePasswords.size).toBe(passwords.length);
  });

  test("should handle edge case of length 0", () => {
    const password = generateRandomPassword(0);
    expect(password).toBe("");
  });

  test("should include all character types in longer passwords", () => {
    // Generate a longer password to increase probability of all character types
    const password = generateRandomPassword(100);
    
    const hasLowercase = /[a-z]/.test(password);
    const hasUppercase = /[A-Z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSpecial = /[!@#$%^&*()_+\[\]{}|;:,.<>?]/.test(password);

    // With 100 characters, we should have all types (very high probability)
    expect(hasLowercase).toBe(true);
    expect(hasUppercase).toBe(true);
    expect(hasNumber).toBe(true);
    expect(hasSpecial).toBe(true);
  });
});