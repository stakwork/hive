import { encode } from "next-auth/jwt";

/**
 * Maximum age for Sphinx JWT tokens (30 days in seconds)
 */
const TOKEN_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

/**
 * Creates a JWT token for Sphinx authentication that is compatible with NextAuth's middleware.
 * 
 * This function generates a JWT token that can be used as a Bearer token in the Authorization header.
 * The token is recognized by NextAuth's `getToken()` function in middleware because it uses the
 * same encoding format and secret.
 * 
 * @param userId - The user's ID from the database
 * @param email - The user's email (optional)
 * @param name - The user's name (optional)
 * @returns A Promise that resolves to the encoded JWT token string
 * @throws Error if NEXTAUTH_SECRET environment variable is not set
 * 
 * @example
 * ```typescript
 * const token = await createSphinxToken(user.id, user.email, user.name);
 * // Use token in Authorization header: Bearer <token>
 * ```
 */
export async function createSphinxToken(
  userId: string,
  email?: string | null,
  name?: string | null
): Promise<string> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET environment variable is required for token generation");
  }

  return encode({
    token: { id: userId, email, name },
    secret,
    maxAge: TOKEN_MAX_AGE,
  });
}
