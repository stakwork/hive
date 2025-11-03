/**
 * Client-safe password validation utilities
 * This file contains no Node.js dependencies and can be used in client components
 */

/**
 * Validate password strength
 * @param password - Password to validate
 * @returns Object with validation result and message
 */
export function validatePassword(password: string): {
  isValid: boolean;
  message?: string;
} {
  if (!password || password.length < 12) {
    return {
      isValid: false,
      message: "Password must be at least 12 characters long",
    };
  }
  
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const hasSpecialChar = /[!@#$%^&*()_+\-=[\]{}|;:,.<>?]/.test(password);
  
  if (!hasUppercase || !hasLowercase || !hasNumber || !hasSpecialChar) {
    return {
      isValid: false,
      message: "Password must contain uppercase, lowercase, numbers, and special characters",
    };
  }
  
  return { isValid: true };
}
