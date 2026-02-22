import { get } from "@vercel/blob";

/**
 * Fetches content from a Vercel Blob URL using authenticated access.
 *
 * @param url - The blob URL to fetch from
 * @returns The blob content as a string
 * @throws Error if fetch fails
 */
export async function fetchBlobContent(url: string): Promise<string> {
  try {
    const result = await get(url, { access: "private" });
    if (!result || result.statusCode !== 200) {
      throw new Error(`Blob not found or not modified: ${url}`);
    }
    const response = new Response(result.stream);
    return await response.text();
  } catch (error) {
    console.error(`Error fetching blob from ${url}:`, error);
    throw new Error(
      `Failed to fetch blob content: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
