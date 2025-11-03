/**
 * Server-side password utilities
 * This file uses Node.js crypto and should only be imported in server components/routes
 */
import crypto from "node:crypto";

/**
 * Generate a secure random password
 * @param length - Password length (default: 20)
 * @returns A secure random password string
 */
export function generateSecurePassword(length: number = 20): string {
  const uppercase = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const lowercase = "abcdefghijklmnopqrstuvwxyz";
  const numbers = "0123456789";
  const specialChars = "!@#$%^&*()_+-=[]{}|;:,.<>?";
  
  const allChars = uppercase + lowercase + numbers + specialChars;
  const allCharsLength = allChars.length;
  
  // Ensure at least one character from each category
  let password = "";
  password += uppercase[crypto.randomInt(uppercase.length)];
  password += lowercase[crypto.randomInt(lowercase.length)];
  password += numbers[crypto.randomInt(numbers.length)];
  password += specialChars[crypto.randomInt(specialChars.length)];
  
  // Fill the rest with random characters
  for (let i = password.length; i < length; i++) {
    password += allChars[crypto.randomInt(allCharsLength)];
  }
  
  // Shuffle the password to avoid predictable patterns
  return password
    .split("")
    .sort(() => crypto.randomInt(3) - 1)
    .join("");
}

// Re-export validation function for convenience in server contexts
export { validatePassword } from "./password-validation";