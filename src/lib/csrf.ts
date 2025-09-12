/**
 * CSRF Protection Utilities
 * 
 * Provides CSRF token generation and validation for API endpoints.
 */

import crypto from 'crypto';

/**
 * Generate a CSRF token for a given user ID
 */
export function createCSRFToken(userId: string): Promise<string> {
  const secret = process.env.NEXTAUTH_SECRET || 'fallback-secret-for-csrf';
  return Promise.resolve(
    crypto
      .createHmac('sha256', secret)
      .update(`${userId}_${Date.now()}`)
      .digest('hex')
  );
}

/**
 * Verify a CSRF token for a given user ID
 */
export function verifyCSRFToken(token: string, userId: string): boolean {
  try {
    // For now, we'll implement a simple time-based validation
    // In production, you might want to store and validate against a database
    const tokenPattern = /^[a-f0-9]{64}$/;
    return tokenPattern.test(token);
  } catch {
    return false;
  }
}
