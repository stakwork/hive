"use client";

import { useEffect } from "react";

/**
 * DEV: fetches the workspace's Bifrost admin credentials AND the
 * caller's per-(workspace,user) Virtual Key, dumping both to the
 * browser DevTools console. Renders nothing.
 *
 * Wired into the settings page (`/w/[slug]/settings`) which already
 * gates rendering on workspace OWNER/ADMIN — and both underlying
 * routes enforce the same role check server-side. The
 * workspace-scoped rollout flag (`BIFROST_ENABLED`) is evaluated
 * server-side before this component is rendered at all.
 *
 * Remove once the proper "Open dashboard / copy password" + "Try
 * the gateway with your VK" cards land in `SettingsTabs`.
 */
export function BifrostCredsDevLog({ slug }: { slug: string }) {
  useEffect(() => {
    let cancelled = false;

    // Admin credentials (workspace-wide; for logging into the
    // Bifrost dashboard).
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

    // Per-user Virtual Key (for hitting the gateway directly with
    // curl / Postman). Triggers the lazy reconcile path on first
    // call; subsequent calls return the cached VK.
    fetch(`/api/workspaces/${slug}/bifrost/vk`, {
      cache: "no-store",
      credentials: "same-origin",
    })
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          const text = await res.text().catch(() => "<no body>");
          console.warn(
            `[bifrost-vk] HTTP ${res.status} for workspace=${slug}:`,
            text,
          );
          return;
        }
        const data = (await res.json()) as {
          baseUrl: string;
          vkValue: string;
          vkId: string;
          customerId: string;
          userId: string;
          created: boolean;
        };
        console.log(
          `[bifrost-vk] workspace=${slug}\n` +
            `  baseUrl:    ${data.baseUrl}\n` +
            `  vkValue:    ${data.vkValue}\n` +
            `  vkId:       ${data.vkId}\n` +
            `  customerId: ${data.customerId}\n` +
            `  userId:     ${data.userId}\n` +
            `  created:    ${data.created}\n` +
            `\n` +
            `  Try it:\n` +
            `    curl ${data.baseUrl}/v1/chat/completions \\\n` +
            `      -H 'Authorization: Bearer ${data.vkValue}' \\\n` +
            `      -H 'Content-Type: application/json' \\\n` +
            `      -d '{"model":"anthropic/claude-haiku-4-5-20251001","max_tokens":20,"messages":[{"role":"user","content":"hi"}]}'`,
        );
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn(`[bifrost-vk] fetch failed for ${slug}:`, err);
      });

    return () => {
      cancelled = true;
    };
  }, [slug]);

  return null;
}
