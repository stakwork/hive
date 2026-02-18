/**
 * Fetches content from a Vercel Blob URL
 * @param url - The blob URL to fetch from
 * @returns The blob content as a string
 * @throws Error if fetch fails
 */
export async function fetchBlobContent(url: string): Promise<string> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch blob: ${response.statusText}`);
    }
    return await response.text();
  } catch (error) {
    console.error(`Error fetching blob from ${url}:`, error);
    throw new Error(
      `Failed to fetch blob content: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
