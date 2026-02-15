import { encode } from "next-auth/jwt";

const SPHINX_TOKEN_MAX_AGE = 30 * 24 * 60 * 60; // 30 days in seconds

/**
 * Create a JWT for Sphinx app API access.
 * Uses the same NextAuth JWT strategy so middleware recognizes it via `getToken`.
 */
export async function createSphinxJWT(userId: string): Promise<string> {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is required");
  }

  return encode({
    token: { id: userId },
    secret,
    maxAge: SPHINX_TOKEN_MAX_AGE,
  });
}
