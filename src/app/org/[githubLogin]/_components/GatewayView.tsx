"use client";

import React, { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

const SESSION_REFRESH_THRESHOLD_MS = 7 * 60 * 60 * 1000; // 7 hours

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
 *
 * A `visibilitychange` listener silently re-mints a fresh ticket and
 * reloads the iframe when the user returns to the tab after >7 hours,
 * preventing a broken/logged-out state when the `bifrost_session`
 * cookie has expired.
 */
export function GatewayView({ githubLogin }: GatewayViewProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const loadedAt = useRef<number | null>(null);
  const cancelRef = useRef<boolean>(false);

  const loadGateway = async () => {
    loadedAt.current = null;
    cancelRef.current = false;

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
      if (cancelRef.current) return;
      // Trailing slash on `/ui/` matters — the SPA's wouter base
      // expects it; without the slash the gateway 302s back here.
      setSrc(
        `${body.url.replace(/\/$/, "")}/_plugin/ui/?ticket=${encodeURIComponent(body.ticket)}`,
      );
      loadedAt.current = Date.now();
    } catch (e) {
      if (!cancelRef.current) setErr(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    setSrc(null);
    setErr(null);
    loadGateway();

    return () => {
      cancelRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [githubLogin]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (
        loadedAt.current !== null &&
        Date.now() - loadedAt.current > SESSION_REFRESH_THRESHOLD_MS
      ) {
        setSrc(null); // show spinner immediately
        setErr(null);
        loadGateway();
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
