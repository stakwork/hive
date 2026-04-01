import { useState, useEffect, useCallback } from "react";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import type { WorkspaceResponse } from "@/types/workspace";

interface WorkspaceLogosMap {
  [workspaceId: string]: string;
}

interface CacheEntry {
  url: string;
  fetchedAt: number;
}

const STORAGE_KEY = "workspace-logo-cache";
const TTL = 55 * 60 * 1000; // 55 min — under the 1-hour presigned URL expiry

function loadCache(): Map<string, CacheEntry> {
  const map = new Map<string, CacheEntry>();
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const entries: Record<string, CacheEntry> = JSON.parse(raw);
      const now = Date.now();
      for (const [id, entry] of Object.entries(entries)) {
        if (now - entry.fetchedAt < TTL) map.set(id, entry);
      }
    }
  } catch {
    // SSR or sessionStorage unavailable
  }
  return map;
}

function persistCache(cache: Map<string, CacheEntry>) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(cache)));
  } catch {
    // SSR or storage full
  }
}

const cache = loadCache();

function getCached(workspaceId: string): string | null {
  const entry = cache.get(workspaceId);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt >= TTL) {
    cache.delete(workspaceId);
    persistCache(cache);
    return null;
  }
  return entry.url;
}

function setCache(workspaceId: string, url: string) {
  cache.set(workspaceId, { url, fetchedAt: Date.now() });
  persistCache(cache);
}

function deleteCache(workspaceId: string) {
  cache.delete(workspaceId);
  persistCache(cache);
}

function initFromCache(workspaces: WorkspaceResponse[]): WorkspaceLogosMap {
  const urls: WorkspaceLogosMap = {};
  for (const ws of workspaces) {
    if (ws.logoKey) {
      const cached = getCached(ws.id);
      if (cached) urls[ws.id] = cached;
    }
  }
  return urls;
}

export function useWorkspaceLogos(workspaces: WorkspaceResponse[]) {
  const [logoUrls, setLogoUrls] = useState<WorkspaceLogosMap>(() => initFromCache(workspaces));
  const [loading, setLoading] = useState(false);
  const canAccessWorkspaceLogo = useFeatureFlag(FEATURE_FLAGS.WORKSPACE_LOGO);

  const fetchLogo = useCallback(async (workspaceId: string, slug: string): Promise<string | null> => {
    const cached = getCached(workspaceId);
    if (cached) return cached;

    try {
      const response = await fetch(`/api/workspaces/${slug}/image`);
      if (!response.ok) return null;
      const { presignedUrl } = await response.json();
      setCache(workspaceId, presignedUrl);
      return presignedUrl;
    } catch (error) {
      console.error(`Error fetching logo for workspace ${slug}:`, error);
      return null;
    }
  }, []);

  const refetchLogo = useCallback(async (workspaceId: string): Promise<string | null> => {
    const ws = workspaces.find(w => w.id === workspaceId);
    if (!ws) return null;
    deleteCache(workspaceId);
    const url = await fetchLogo(workspaceId, ws.slug);
    if (url) setLogoUrls(prev => ({ ...prev, [workspaceId]: url }));
    return url;
  }, [workspaces, fetchLogo]);

  const clearLogo = useCallback((workspaceId: string) => {
    deleteCache(workspaceId);
    setLogoUrls(prev => {
      const next = { ...prev };
      delete next[workspaceId];
      return next;
    });
  }, []);

  useEffect(() => {
    if (!canAccessWorkspaceLogo || workspaces.length === 0) {
      setLogoUrls({});
      return;
    }

    const fetchLogos = async () => {
      setLoading(true);
      const urls: WorkspaceLogosMap = {};
      await Promise.all(
        workspaces
          .filter(ws => ws.logoKey)
          .map(async ws => {
            const url = await fetchLogo(ws.id, ws.slug);
            if (url) urls[ws.id] = url;
          })
      );
      setLogoUrls(prev => {
        const ids = Object.keys(urls);
        if (ids.length === Object.keys(prev).length && ids.every(id => prev[id] === urls[id])) {
          return prev;
        }
        return urls;
      });
      setLoading(false);
    };

    fetchLogos();
  }, [canAccessWorkspaceLogo, workspaces, fetchLogo]);

  return { logoUrls, loading, refetchLogo, clearLogo };
}
