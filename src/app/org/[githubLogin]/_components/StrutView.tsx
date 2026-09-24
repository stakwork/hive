"use client";

import React, { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

// The embed token lives 8h (see the embed-url route); re-mint an hour early.
const TOKEN_REFRESH_THRESHOLD_MS = 7 * 60 * 60 * 1000;

interface StrutViewProps {
  githubLogin: string;
}

/**
 * The strut UI's deep-link params (`?wf` workflow, `?run`, `?v` version,
 * `?chat`). They ride on `/org/<slug>/strut` so a Hive link opens the same
 * view; never `key` / `embed_origin`, which are the embed's own.
 */
const DEEP_LINK_PARAMS = ["wf", "run", "v", "chat"] as const;
type DeepLink = Partial<Record<(typeof DEEP_LINK_PARAMS)[number], string>>;

function readDeepLink(search: string): DeepLink {
  const p = new URLSearchParams(search);
  const out: DeepLink = {};
  for (const k of DEEP_LINK_PARAMS) {
    const v = p.get(k);
    if (v) out[k] = v;
  }
  return out;
}

/**
 * The frame URL: the minted `/lab/?key=` plus the deep link, plus our origin
 * as `embed_origin` so strut posts its location changes back to us (and to no
 * one else).
 */
function frameUrl(embedUrl: string, link: DeepLink): string {
  const url = new URL(embedUrl);
  for (const [k, v] of Object.entries(link)) url.searchParams.set(k, v);
  url.searchParams.set("embed_origin", window.location.origin);
  return url.toString();
}

/** Mirror strut's deep link into our own address bar (no navigation). */
function writeDeepLink(link: DeepLink) {
  const url = new URL(window.location.href);
  for (const k of DEEP_LINK_PARAMS) {
    const v = link[k];
    if (v) url.searchParams.set(k, v);
    else url.searchParams.delete(k);
  }
  if (url.href !== window.location.href) {
    window.history.replaceState(window.history.state, "", url);
  }
}

interface EmbedUrlResponse {
  /** `{mcp}/lab/?key=<jwt>` — ready to drop into the iframe. */
  url: string;
}

async function fetchEmbedUrl(githubLogin: string): Promise<string> {
  const resp = await fetch(
    `/api/orgs/${encodeURIComponent(githubLogin)}/strut/embed-url`,
    { method: "POST" },
  );
  if (!resp.ok) {
    const body = await resp.json().catch(() => null);
    throw new Error(body?.error || `HTTP ${resp.status}`);
  }
  const body = (await resp.json()) as EmbedUrlResponse;
  if (!body?.url) throw new Error("No strut URL returned");
  return body.url;
}

/**
 * Full-bleed iframe host for the strut workflow builder that the org
 * swarm's stakgraph mcp serves at `/lab`.
 *
 * The lab lives on a per-swarm origin (`swarm-abc.sphinx.chat:3355`), so
 * we cross-origin-embed it. Hive mints a short-lived JWT via
 * `/api/orgs/[githubLogin]/strut/embed-url` and loads `/lab/?key=<jwt>`;
 * the strut UI keeps the key in sessionStorage, strips it from the URL,
 * and sends it as a Bearer header from then on — no Basic-auth prompt.
 *
 * Like `GatewayView`, a `visibilitychange` listener re-mints and reloads
 * when the user returns to the tab after the token has (nearly) expired.
 * The reload is cheap: strut reattaches its open chat from localStorage.
 *
 * Deep links: strut keeps `?wf / run / v / chat` in its own (iframe) URL,
 * which we can't see, so the two sides trade them. On load our params go
 * onto the frame URL; after that strut posts `strut:location` on every
 * change and we mirror it into our address bar — so the Hive URL is always
 * a link to what's on screen. The frame `src` is never recomputed from those
 * updates (that would reload strut on every click); a re-mint uses the
 * latest one, so the reload lands where the user was.
 */
export function StrutView({ githubLogin }: StrutViewProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mintCount, setMintCount] = useState(0);
  const loadedAt = useRef<number | null>(null);
  // The latest deep link: our URL at mount, then whatever strut reports.
  const deepLink = useRef<DeepLink | null>(null);
  if (deepLink.current === null && typeof window !== "undefined") {
    deepLink.current = readDeepLink(window.location.search);
  }

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setErr(null);
    loadedAt.current = null;

    fetchEmbedUrl(githubLogin)
      .then((url) => {
        if (cancelled) return;
        setSrc(frameUrl(url, deepLink.current ?? {}));
        loadedAt.current = Date.now();
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [githubLogin, mintCount]);

  useEffect(() => {
    if (!src) return;
    const frameOrigin = new URL(src).origin;
    const handleMessage = (e: MessageEvent) => {
      if (e.origin !== frameOrigin) return;
      const data = e.data as { type?: unknown; params?: unknown } | null;
      if (data?.type !== "strut:location" || typeof data.params !== "object" || !data.params) {
        return;
      }
      const link: DeepLink = {};
      const params = data.params as Record<string, unknown>;
      for (const k of DEEP_LINK_PARAMS) {
        const v = params[k];
        if (typeof v === "string" && v) link[k] = v;
      }
      deepLink.current = link;
      writeDeepLink(link);
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [src]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (
        loadedAt.current !== null &&
        Date.now() - loadedAt.current > TOKEN_REFRESH_THRESHOLD_MS
      ) {
        setMintCount((n) => n + 1);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  if (err) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
        <div className="max-w-md text-center px-4">
          <div className="font-medium text-foreground mb-2">
            Strut unavailable
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
      title="Strut"
      className="flex-1 w-full h-full border-0 bg-background"
      // microphone: dictation (getUserMedia is denied in a cross-origin
      // frame without it). clipboard-write: the UI's copy buttons.
      allow="microphone; clipboard-write"
      // allow-same-origin: the UI's session/localStorage (its key, open
      // chat, prefs). allow-modals: it confirm()s before cancelling or
      // re-running a run — without this those silently no-op.
      // allow-popups(-to-escape-sandbox) + allow-downloads: run artifacts
      // open in a new tab.
      sandbox="allow-same-origin allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads"
    />
  );
}
