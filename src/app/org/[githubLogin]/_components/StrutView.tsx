"use client";

import React, { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

// The embed token lives 8h (see the embed-url route); re-mint an hour early.
const TOKEN_REFRESH_THRESHOLD_MS = 7 * 60 * 60 * 1000;

interface StrutViewProps {
  githubLogin: string;
}

/**
 * Strut's deep link rides on `/org/<slug>/strut` as ONE opaque param,
 * `?strut=<its query>` (e.g. `?strut=wf%3Ddigest%26run%3D1`), so a Hive
 * link reopens the same view. Strut owns the vocabulary (`wf`, `run`, `v`,
 * `chat`, `elicit`, whatever comes next — `web/src/embed.ts`); Hive only
 * carries what strut reported and hands it back, and never has to learn a
 * key. The frame is untrusted content, so each pair is still bounded and
 * the embed's own `key` / `embed_origin` are dropped unconditionally.
 */
const DEEP_LINK_PARAM = "strut";
const KEY_RE = /^[a-z][a-z0-9_]{0,31}$/;
const MAX_VALUE_LENGTH = 512;
const MAX_LINK_LENGTH = 2048;
const EMBED_PARAMS = new Set(["key", "embed_origin"]);

/**
 * Legacy (removable): links minted between 2026-09-22 (stakwork/hive#5334)
 * and the `?strut=` param carried these keys bare on the Hive URL.
 */
const LEGACY_PARAMS = ["wf", "run", "v", "chat"];

function filterLink(entries: Iterable<[string, unknown]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of entries) {
    if (!KEY_RE.test(k) || EMBED_PARAMS.has(k)) continue;
    if (typeof v !== "string" || !v || v.length > MAX_VALUE_LENGTH) continue;
    out[k] = v;
  }
  return out;
}

function readDeepLink(search: string): Record<string, string> {
  const here = new URLSearchParams(search);
  const packed = here.get(DEEP_LINK_PARAM);
  if (packed !== null) return filterLink(new URLSearchParams(packed));
  return filterLink(LEGACY_PARAMS.map((k) => [k, here.get(k)]));
}

/**
 * The frame URL: the minted `/lab/?key=` plus the deep link, plus our origin
 * as `embed_origin` so strut posts its location changes back to us (and to no
 * one else). Nothing else of our own query goes across.
 */
function frameUrl(embedUrl: string, link: Record<string, string>): string {
  const url = new URL(embedUrl);
  for (const [k, v] of Object.entries(link)) url.searchParams.set(k, v);
  url.searchParams.set("embed_origin", window.location.origin);
  return url.toString();
}

/** Mirror strut's (serialized) deep link into our own address bar (no navigation). */
function writeDeepLink(packed: string) {
  const url = new URL(window.location.href);
  if (packed) url.searchParams.set(DEEP_LINK_PARAM, packed);
  else url.searchParams.delete(DEEP_LINK_PARAM);
  for (const k of LEGACY_PARAMS) url.searchParams.delete(k);
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
 * Deep links: strut keeps its own deep link in its own (iframe) URL, which
 * we can't see, so the two sides trade it. On load our `?strut=` goes onto
 * the frame URL as strut's own params; after that strut posts
 * `strut:location` on every change and we mirror it into `?strut=` — so
 * the Hive URL is always a link to what's on screen. The frame `src` is
 * never recomputed from those updates (that would reload strut on every
 * click); a re-mint uses the latest one, so the reload lands where the
 * user was.
 */
export function StrutView({ githubLogin }: StrutViewProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [mintCount, setMintCount] = useState(0);
  const loadedAt = useRef<number | null>(null);
  // The latest deep link: our URL at mount, then whatever strut reports.
  const deepLink = useRef<Record<string, string> | null>(null);
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
      if (data?.type !== "strut:location") return;
      const params = data.params;
      if (typeof params !== "object" || params === null || Array.isArray(params)) return;
      const link = filterLink(Object.entries(params));
      const packed = new URLSearchParams(link).toString();
      if (packed.length > MAX_LINK_LENGTH) return;
      deepLink.current = link;
      writeDeepLink(packed);
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
