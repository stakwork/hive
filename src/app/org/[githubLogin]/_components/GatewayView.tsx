"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

interface GatewayViewProps {
  githubLogin: string;
}

interface TicketResponse {
  /** Gateway base URL, e.g. `https://swarm-abc.sphinx.chat:8181`. */
  url: string;
  /** Short-lived single-use ticket the SPA exchanges for a cookie. */
  ticket: string;
}

/**
 * Full-bleed iframe host for the gateway plugin's admin dashboard.
 *
 * The gateway's SPA lives on a per-swarm origin (e.g.
 * `swarm-abc.sphinx.chat:8181`), so we cross-origin-embed it. Hive
 * mints a 30s single-use bootstrap ticket via
 * `/api/orgs/[githubLogin]/gateway/ticket`, then loads the SPA with
 * `?ticket=<value>`. The SPA redeems the ticket on boot, receives the
 * `bifrost_session` cookie (`SameSite=None; Secure`), strips the
 * ticket from the URL, and renders without a login screen.
 *
 * On any failure (no swarm configured, gateway unreachable, etc.) we
 * surface a centered message instead of an empty iframe.
 */
export function GatewayView({ githubLogin }: GatewayViewProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setErr(null);

    (async () => {
      try {
        const resp = await fetch(
          `/api/orgs/${encodeURIComponent(githubLogin)}/gateway/ticket`,
          { method: "POST" },
        );
        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(text || `HTTP ${resp.status}`);
        }
        const body = (await resp.json()) as TicketResponse;
        if (cancelled) return;
        // Trailing slash on `/ui/` matters — the SPA's wouter base
        // expects it; without the slash the gateway 302s back here.
        setSrc(
          `${body.url.replace(/\/$/, "")}/_plugin/ui/?ticket=${encodeURIComponent(body.ticket)}`,
        );
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [githubLogin]);

  if (err) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        <div className="max-w-md text-center px-4">
          <div className="font-medium text-foreground mb-2">
            Gateway unavailable
          </div>
          <div className="break-words">{err}</div>
        </div>
      </div>
    );
  }

  if (!src) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <iframe
      src={src}
      title="Gateway admin"
      className="flex-1 w-full h-full border-0 bg-background"
      // allow-same-origin: required so the SPA's cookie + storage
      // access works inside the frame. allow-scripts: obviously.
      // allow-forms: keeps the login fallback usable for ops.
      sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
    />
  );
}
