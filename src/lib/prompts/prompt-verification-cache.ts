/**
 * Module-level client-side cache for prompt name verification.
 *
 * Deduplicates and shares `/api/workflow/prompts?exact=true` lookups across
 * all messages in the session. A second call for the same prompt name returns
 * the already-settled Promise immediately — zero additional network requests.
 *
 * No TTL is needed: prompts are effectively immutable from the voice chat's
 * perspective within a single browser session.
 */

export interface VerifiedPrompt {
  id: string;
  publishedVersionId: string | null;
}

/** Map<promptName, Promise<VerifiedPrompt | null>> */
const cache = new Map<string, Promise<VerifiedPrompt | null>>();

/**
 * Verify that `name` is a real prompt by hitting the prompts API.
 *
 * Returns `null` when:
 * - The name does not match any prompt in the API response.
 * - The network request fails (errors are swallowed; never surfaced to the user).
 */
export function verifyPromptName(name: string): Promise<VerifiedPrompt | null> {
  if (cache.has(name)) return cache.get(name)!;

  const p = fetch(
    `/api/workflow/prompts?search=${encodeURIComponent(name)}&exact=true`,
  )
    .then((r) => (r.ok ? r.json() : null))
    .then(
      (data: {
        data?: { prompts?: Array<{ name: string; id: string; published_version_id: string | null }> };
      } | null) => {
        const match = data?.data?.prompts?.find((p) => p.name === name);
        return match
          ? { id: match.id, publishedVersionId: match.published_version_id }
          : null;
      },
    )
    .catch(() => null); // network errors → treat as unverified

  cache.set(name, p);
  return p;
}

/**
 * Clear the module-level cache. Exposed for testing only — do not call in
 * production code.
 */
export function _clearVerificationCache(): void {
  cache.clear();
}
