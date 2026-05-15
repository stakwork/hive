"use client";

import { useEffect } from "react";

/**
 * DEV: fetches the workspace's Bifrost admin credentials and dumps
 * them to the browser DevTools console. Renders nothing.
 *
 * Wired into the settings page (`/w/[slug]/settings`) which already
 * gates rendering on workspace OWNER/ADMIN — and the underlying
 * `/api/workspaces/[slug]/bifrost/credentials` route enforces the
 * same role check server-side. The workspace-scoped rollout flag
 * (`BIFROST_ENABLED`) is also evaluated server-side before this
 * component is rendered at all.
 *
 * Remove once the proper "Open dashboard / copy password" card lands
 * in `SettingsTabs`.
 */
export function BifrostCredsDevLog({ slug }: { slug: string }) {
  useEffect(() => {
    let cancelled = false;

    fetch(`/api/workspaces/${slug}/bifrost/credentials`, {
      // Cache headers on the route are already `private, no-store`,
      // but be explicit so a future browser default doesn't surprise us.
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const text = await res.text().catch(() => "<no body>");
          console.warn(
            `[bifrost-creds] HTTP ${res.status} for workspace=${slug}:`,
            text,
          );
          return;
        }
        const data = (await res.json()) as {
          dashboardUrl: string;
          adminUser: string;
          adminPassword: string;
        };
        console.log(
          `[bifrost-creds] workspace=${slug}\n` +
            `  dashboard: ${data.dashboardUrl}\n` +
            `  user:      ${data.adminUser}\n` +
            `  password:  ${data.adminPassword}`,
        );
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn(`[bifrost-creds] fetch failed for ${slug}:`, err);
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  return null;
}
