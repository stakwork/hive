interface LogoCacheEntry {
  url: string;
  fetchedAt: number;
}

const logoCache = new Map<string, LogoCacheEntry>();
const TTL = 55 * 60 * 1000; // 55 minutes — safely under the 1-hour presigned URL expiry

export function getCachedLogoUrl(workspaceId: string): string | null {
  const entry = logoCache.get(workspaceId);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt >= TTL) {
    logoCache.delete(workspaceId);
    return null;
  }
  return entry.url;
}

export function setCachedLogoUrl(workspaceId: string, url: string): void {
  logoCache.set(workspaceId, { url, fetchedAt: Date.now() });
}

export function invalidateCachedLogoUrl(workspaceId: string): void {
  logoCache.delete(workspaceId);
}
