import jwt from "jsonwebtoken";

export interface RelayTokenClaims {
  userId: string;
  name: string;
  image?: string | null;
  color?: string;
  /** Capability scope: e.g. "whiteboard:<id>". The relay parses this to
   *  determine which room the socket may join. Tokens only grant access to
   *  exactly one resource. */
  resource: string;
}

/**
 * Sign a short-lived capability JWT using the per-swarm shared API key as the
 * HS256 secret. The relay service running on the same swarm verifies with the
 * same key, so a token minted for swarm A is rejected by swarm B's relay.
 */
export function signRelayToken(
  claims: RelayTokenClaims,
  swarmApiKey: string,
  ttlSeconds = 300,
): string {
  return jwt.sign(claims, swarmApiKey, {
    algorithm: "HS256",
    expiresIn: ttlSeconds,
  });
}
