import { describe, test, expect, vi, beforeEach } from "vitest";
import { generateRandomPassword } from "@/utils/randomPassword";

describe("generateRandomPassword", () => {
  const expectedCharset = 
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+[]{}|;:,.<>?";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("default behavior", () => {
    test("should generate a password with default length of 12 characters", () => {
      const password = generateRandomPassword();
      expect(password).toHaveLength(12);
      expect(typeof password).toBe("string");
    });

    test("should generate different passwords on multiple calls", () => {
      const passwords = new Set();
      const iterations = 100;

      for (let i = 0; i < iterations; i++) {
        passwords.add(generateRandomPassword());
      }

      // With 86 possible characters and 12 positions, collision probability is extremely low
      // We expect at least 95% unique passwords
      expect(passwords.size).toBeGreaterThan(iterations * 0.95);
    });

    test("should only contain characters from the expected charset", () => {
      const password = generateRandomPassword();
      const charsetSet = new Set(expectedCharset.split(""));
      
      for (const char of password) {
        expect(charsetSet.has(char)).toBe(true);
      }
    });

    test("should contain characters from multiple character classes", () => {
      const passwords = Array.from({ length: 50 }, () => generateRandomPassword());
      
      // Test that across multiple passwords, we see different character types
      const allChars = passwords.join("");
      const hasLowercase = /[a-z]/.test(allChars);
      const hasUppercase = /[A-Z]/.test(allChars);
      const hasNumbers = /[0-9]/.test(allChars);
      const hasSpecialChars = /[!@#$%^&*()_+[\]{}|;:,.<>?]/.test(allChars);

      expect(hasLowercase).toBe(true);
      expect(hasUppercase).toBe(true);
      expect(hasNumbers).toBe(true);
      expect(hasSpecialChars).toBe(true);
    });
  });

  describe("custom length parameters", () => {
    test("should generate password with specified length", () => {
      const testLengths = [1, 5, 8, 16, 24, 32, 50, 100];

      testLengths.forEach((length) => {
        const password = generateRandomPassword(length);
        expect(password).toHaveLength(length);
        expect(typeof password).toBe("string");
      });
    });

    test("should handle single character length", () => {
      const password = generateRandomPassword(1);
      expect(password).toHaveLength(1);
      expect(expectedCharset.includes(password)).toBe(true);
    });

    test("should handle very long passwords", () => {
      const password = generateRandomPassword(1000);
      expect(password).toHaveLength(1000);
      
      // Verify it still contains only valid characters
      const charsetSet = new Set(expectedCharset.split(""));
      for (const char of password) {
        expect(charsetSet.has(char)).toBe(true);
      }
    });
  });

  describe("edge cases", () => {
    test("should return empty string for zero length", () => {
      const password = generateRandomPassword(0);
      expect(password).toBe("");
      expect(password).toHaveLength(0);
    });

    test("should return empty string for negative length", () => {
      const password = generateRandomPassword(-1);
      expect(password).toBe("");
      expect(password).toHaveLength(0);

      const password2 = generateRandomPassword(-10);
      expect(password2).toBe("");
      expect(password2).toHaveLength(0);
    });

    test("should handle decimal length by truncating", () => {
      const password = generateRandomPassword(12.7);
      expect(password).toHaveLength(12);
    });
  });

  describe("character distribution", () => {
    test("should have reasonable character distribution over many generations", () => {
      const charCounts = new Map<string, number>();
      const totalPasswords = 1000;
      const passwordLength = 10;

      // Initialize counts
      for (const char of expectedCharset) {
        charCounts.set(char, 0);
      }

      // Generate many passwords and count characters
      for (let i = 0; i < totalPasswords; i++) {
        const password = generateRandomPassword(passwordLength);
        for (const char of password) {
          charCounts.set(char, (charCounts.get(char) || 0) + 1);
        }
      }

      const totalChars = totalPasswords * passwordLength;
      const expectedFrequency = totalChars / expectedCharset.length;
      const tolerance = 0.5; // Allow 50% deviation from expected frequency

      // Most characters should appear within reasonable frequency range
      let charactersInRange = 0;
      for (const [char, count] of charCounts) {
        if (count >= expectedFrequency * (1 - tolerance) && 
            count <= expectedFrequency * (1 + tolerance)) {
          charactersInRange++;
        }
      }

      // At least 80% of characters should be within the tolerance range
      const percentageInRange = charactersInRange / expectedCharset.length;
      expect(percentageInRange).toBeGreaterThan(0.8);
    });

    test("should use all characters in the charset over many generations", () => {
      const usedChars = new Set<string>();
      const iterations = 2000; // Increased iterations for better coverage

      for (let i = 0; i < iterations; i++) {
        const password = generateRandomPassword(10);
        for (const char of password) {
          usedChars.add(char);
        }
      }

      // Should use at least 95% of available characters
      const coveragePercentage = usedChars.size / expectedCharset.length;
      expect(coveragePercentage).toBeGreaterThan(0.95);
    });
  });

  describe("deterministic testing with mocked Math.random", () => {
    test("should use Math.random for randomness", () => {
      const mockRandom = vi.spyOn(Math, "random");
      mockRandom.mockReturnValue(0.5);

      const password = generateRandomPassword(5);
      
      expect(mockRandom).toHaveBeenCalled();
      expect(password).toHaveLength(5);
      
      // With Math.random() mocked to return 0.5, the character index should be
      // Math.floor(0.5 * 86) = 43, which corresponds to 'R' in the charset
      expect(password).toBe("RRRRR");

      mockRandom.mockRestore();
    });

    test("should handle different Math.random values", () => {
      const mockRandom = vi.spyOn(Math, "random");
      
      // Test with 0 (should pick first character 'a')
      mockRandom.mockReturnValue(0);
      let password = generateRandomPassword(1);
      expect(password).toBe("a");

      // Test with value close to 1 (should pick last character '?')
      mockRandom.mockReturnValue(0.999);
      password = generateRandomPassword(1);
      expect(password).toBe("?");

      mockRandom.mockRestore();
    });

    test("should produce predictable sequence with controlled random values", () => {
      const mockRandom = vi.spyOn(Math, "random");
      const randomSequence = [0.1, 0.3, 0.7, 0.9];
      let callIndex = 0;

      mockRandom.mockImplementation(() => {
        const value = randomSequence[callIndex % randomSequence.length];
        callIndex++;
        return value;
      });

      const password = generateRandomPassword(4);
      
      // Calculate expected characters based on mocked sequence
      const expectedChars = randomSequence.map(val => 
        expectedCharset[Math.floor(val * expectedCharset.length)]
      );
      const expectedPassword = expectedChars.join("");
      
      expect(password).toBe(expectedPassword);
      expect(mockRandom).toHaveBeenCalledTimes(4);

      mockRandom.mockRestore();
    });
  });

  describe("performance and reliability", () => {
    test("should handle rapid successive calls", () => {
      const passwords = [];
      const startTime = Date.now();

      for (let i = 0; i < 1000; i++) {
        passwords.push(generateRandomPassword());
      }

      const endTime = Date.now();
      const executionTime = endTime - startTime;

      // Should complete 1000 generations in reasonable time (less than 100ms)
      expect(executionTime).toBeLessThan(100);
      expect(passwords).toHaveLength(1000);
      
      // All passwords should be valid
      passwords.forEach(password => {
        expect(password).toHaveLength(12);
        expect(typeof password).toBe("string");
      });
    });

    test("should maintain randomness under stress", () => {
      const passwords = new Set<string>();
      const iterations = 10000;

      for (let i = 0; i < iterations; i++) {
        passwords.add(generateRandomPassword(8));
      }

      // Even with shorter passwords, should maintain high uniqueness
      const uniquenessRatio = passwords.size / iterations;
      expect(uniquenessRatio).toBeGreaterThan(0.99);
    });
  });

  describe("input validation and error handling", () => {
    test("should handle undefined length parameter", () => {
      const password = generateRandomPassword(undefined as any);
      expect(password).toHaveLength(12); // Should default to 12
    });

    test("should handle null length parameter", () => {
      const password = generateRandomPassword(null as any);
      expect(password).toHaveLength(0); // null converts to 0 in the loop
    });

    test("should handle string length parameter", () => {
      const password = generateRandomPassword("10" as any);
      expect(password).toHaveLength(10); // String "10" converts to number 10
    });

    test("should handle boolean length parameter", () => {
      const passwordTrue = generateRandomPassword(true as any);
      expect(passwordTrue).toHaveLength(1); // true converts to 1
      
      const passwordFalse = generateRandomPassword(false as any);
      expect(passwordFalse).toHaveLength(0); // false converts to 0
    });

    test("should handle NaN length parameter", () => {
      const password = generateRandomPassword(NaN);
      expect(password).toBe(""); // NaN in loop condition results in empty string
    });

    test("should handle Infinity length parameter", () => {
      // With our updated function, Infinity should return empty string
      const password = generateRandomPassword(Infinity);
      expect(password).toBe("");
      expect(password).toHaveLength(0);
    });
  });
});