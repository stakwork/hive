import { get } from "@vercel/blob";

/**
 * Extracts the pathname from a Vercel Blob URL so `get()` can
 * reconstruct it with the correct access mode (private).
 * Handles both public and private URL formats:
 *   https://<store>.public.blob.vercel-storage.com/<pathname>
 *   https://<store>.private.blob.vercel-storage.com/<pathname>
 */
function extractPathname(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith(".blob.vercel-storage.com")) {
      // Strip leading slash
      return parsed.pathname.slice(1);
    }
  } catch {
    // Not a valid URL — treat as pathname already
  }
  return url;
}

/**
 * Fetches content from a Vercel Blob URL using authenticated access.
 *
 * Uses the pathname (not the full URL) so `get()` constructs the
 * correct private URL from the token's store ID, which avoids 403s
 * when old public URLs are stored but the store is now private.
 *
 * @param url - The blob URL or pathname to fetch from
 * @returns The blob content as a string
 * @throws Error if fetch fails
 */
export async function fetchBlobContent(url: string): Promise<string> {
  const pathname = extractPathname(url);
  try {
    const result = await get(pathname, { access: "private" });
    if (!result || result.statusCode !== 200) {
      throw new Error(`Blob not found or not modified: ${pathname}`);
    }
    const response = new Response(result.stream);
    return await response.text();
  } catch (error) {
    console.error(`Error fetching blob from ${pathname}:`, error);
    throw new Error(
      `Failed to fetch blob content: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
