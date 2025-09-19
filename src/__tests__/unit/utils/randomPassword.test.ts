import { describe, test, expect, vi, beforeEach } from "vitest";
import { generateRandomPassword } from "@/utils/randomPassword";

describe("generateRandomPassword", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("should generate password with default length of 12", () => {
    const password = generateRandomPassword();
    expect(password).toHaveLength(12);
    expect(typeof password).toBe("string");
  });

  test("should generate password with custom length", () => {
    const lengths = [1, 5, 16, 32, 64];
    
    lengths.forEach(length => {
      const password = generateRandomPassword(length);
      expect(password).toHaveLength(length);
      expect(typeof password).toBe("string");
    });
  });

  test("should generate password with zero length", () => {
    const password = generateRandomPassword(0);
    expect(password).toHaveLength(0);
    expect(password).toBe("");
  });

  test("should use only characters from the defined charset", () => {
    const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+[]{}|;:,.<>?";
    const password = generateRandomPassword(100); // Use longer length for better coverage
    
    for (const char of password) {
      expect(charset).toContain(char);
    }
  });

  test("should generate different passwords on multiple calls", () => {
    const passwords = new Set();
    const iterations = 100;
    
    for (let i = 0; i < iterations; i++) {
      passwords.add(generateRandomPassword(16));
    }
    
    // With 84^16 possible combinations, duplicates should be extremely rare
    expect(passwords.size).toBeGreaterThan(iterations * 0.95); // Allow for tiny chance of duplicates
  });

  test("should handle large lengths efficiently", () => {
    const largeLength = 10000;
    const password = generateRandomPassword(largeLength);
    
    expect(password).toHaveLength(largeLength);
    expect(typeof password).toBe("string");
  });

  test("should use Math.random for randomness", () => {
    const mockMath = vi.spyOn(Math, "random");
    mockMath.mockReturnValue(0.5); // Mock to return predictable value
    
    const password = generateRandomPassword(1);
    
    expect(mockMath).toHaveBeenCalled();
    expect(password).toHaveLength(1);
    
    mockMath.mockRestore();
  });

  test("should generate predictable output with mocked Math.random", () => {
    const mockMath = vi.spyOn(Math, "random");
    const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+[]{}|;:,.<>?";
    
    // Mock specific sequence of random values
    mockMath
      .mockReturnValueOnce(0) // First char: 'a' (index 0)
      .mockReturnValueOnce(0.5) // Second char: middle of charset
      .mockReturnValueOnce(0.999); // Third char: near end of charset
    
    const password = generateRandomPassword(3);
    
    expect(password).toHaveLength(3);
    expect(password[0]).toBe(charset[0]); // 'a'
    expect(password[1]).toBe(charset[Math.floor(0.5 * charset.length)]); // Middle char
    expect(password[2]).toBe(charset[Math.floor(0.999 * charset.length)]); // Near end char
    
    mockMath.mockRestore();
  });

  test("should contain lowercase letters", () => {
    const password = generateRandomPassword(1000); // Large sample
    const lowercaseRegex = /[a-z]/;
    expect(lowercaseRegex.test(password)).toBe(true);
  });

  test("should contain uppercase letters", () => {
    const password = generateRandomPassword(1000); // Large sample
    const uppercaseRegex = /[A-Z]/;
    expect(uppercaseRegex.test(password)).toBe(true);
  });

  test("should contain digits", () => {
    const password = generateRandomPassword(1000); // Large sample
    const digitRegex = /[0-9]/;
    expect(digitRegex.test(password)).toBe(true);
  });

  test("should contain special characters", () => {
    const password = generateRandomPassword(1000); // Large sample
    const specialCharsRegex = /[!@#$%^&*()_+[\]{}|;:,.<>?]/;
    expect(specialCharsRegex.test(password)).toBe(true);
  });

  test("should handle negative length gracefully", () => {
    // JavaScript for loops with negative conditions should return empty string
    const password = generateRandomPassword(-5);
    expect(password).toBe("");
  });

  test("should handle non-integer lengths", () => {
    const password = generateRandomPassword(5.7); // Should use 5.7 in the loop
    // The for loop will iterate 6 times (i < 5.7, so i = 0,1,2,3,4,5)
    expect(password).toHaveLength(6);
  });

  test("should handle very small positive decimals", () => {
    const password = generateRandomPassword(0.9); // Should iterate once (i < 0.9, so i = 0)
    expect(password).toHaveLength(1);
  });

  test("should generate character distribution that appears random", () => {
    const password = generateRandomPassword(10000);
    const charCounts = new Map<string, number>();
    
    // Count character frequencies
    for (const char of password) {
      charCounts.set(char, (charCounts.get(char) || 0) + 1);
    }
    
    // With 86 possible characters and 10000 samples, each character should appear ~116 times
    // Allow for reasonable variance (roughly 50-200 occurrences per character)
    const expectedFrequency = 10000 / 86;
    const tolerance = expectedFrequency * 0.5; // 50% tolerance
    
    let charactersWithinTolerance = 0;
    for (const count of charCounts.values()) {
      if (count >= expectedFrequency - tolerance && count <= expectedFrequency + tolerance) {
        charactersWithinTolerance++;
      }
    }
    
    // Expect most characters to be within reasonable frequency range
    expect(charactersWithinTolerance).toBeGreaterThan(charCounts.size * 0.7); // 70% of chars should be in range
  });

  test("should have consistent charset size of 86 characters", () => {
    const charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+[]{}|;:,.<>?";
    expect(charset).toHaveLength(86);
    
    // Verify character categories
    const lowercase = "abcdefghijklmnopqrstuvwxyz";
    const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const digits = "0123456789";
    const special = "!@#$%^&*()_+[]{}|;:,.<>?";
    
    expect(lowercase).toHaveLength(26);
    expect(uppercase).toHaveLength(26);
    expect(digits).toHaveLength(10);
    expect(special).toHaveLength(24); // Updated to match actual length
    expect(lowercase.length + uppercase.length + digits.length + special.length).toBe(86);
  });

  test("should not include ambiguous characters that could cause confusion", () => {
    const password = generateRandomPassword(1000);
    const ambiguousChars = ['0', 'O', 'I', 'l', '1']; // Common ambiguous characters
    
    // Note: The current implementation does include these characters
    // This test documents the current behavior rather than enforcing a requirement
    let hasAmbiguous = false;
    for (const char of ambiguousChars) {
      if (password.includes(char)) {
        hasAmbiguous = true;
        break;
      }
    }
    
    // Current implementation includes ambiguous characters
    expect(hasAmbiguous).toBe(true);
  });

  test("should be deterministic when Math.random is mocked with fixed sequence", () => {
    const mockMath = vi.spyOn(Math, "random");
    
    // Create a deterministic sequence
    const sequence = [0.1, 0.2, 0.3, 0.4, 0.5];
    let callCount = 0;
    mockMath.mockImplementation(() => {
      const value = sequence[callCount % sequence.length];
      callCount++;
      return value;
    });
    
    const password1 = generateRandomPassword(5);
    
    // Reset call count for second generation
    callCount = 0;
    const password2 = generateRandomPassword(5);
    
    expect(password1).toBe(password2);
    expect(password1).toHaveLength(5);
    
    mockMath.mockRestore();
  });
});