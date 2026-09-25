import { NextRequest } from "next/server";
import { validateApiToken } from "@/lib/auth/api-token";
import { isOrgApiKey, validateOrgApiKey, type ValidatedOrgApiKey } from "@/lib/org-api-keys";

/**
 * Shared token classification used by pod endpoints and workflow callback
 * routes. Classifies the `x-api-token` header into one of three shapes:
 *
 * - `{kind:"org", ...}`   — a valid, non-revoked, non-expired `hiveorg_…` key.
 * - `{kind:"system"}`     — the global `API_TOKEN` (Stakwork etc.).
 * - `null`                — missing, unknown, revoked, expired, or invalid token.
 *
 * A `hiveorg_` token that fails validation is a hard `null` — it never falls
 * through to the system-token check, even though the header technically
 * doesn't match `API_TOKEN` either.
 */
export type ClassifiedCallerToken =
  | { kind: "org"; orgId: string; apiKeyId: string; validated: ValidatedOrgApiKey }
  | { kind: "system" };

export async function classifyCallerToken(
  request: NextRequest,
): Promise<ClassifiedCallerToken | null> {
  const headerToken = request.headers.get("x-api-token");

  if (isOrgApiKey(headerToken)) {
    const validated = await validateOrgApiKey(headerToken);
    if (!validated) return null;
    return {
      kind: "org",
      orgId: validated.orgId,
      apiKeyId: validated.apiKey.id,
      validated,
    };
  }

  if (validateApiToken(request)) {
    return { kind: "system" };
  }

  return null;
}
