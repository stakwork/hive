"use client";

/**
 * The single renderer for stored HTML pages.
 *
 * Untrusted markup is never injected into Hive's DOM. Instead the bytes are
 * fetched from an authenticated body proxy, wrapped in a blob URL, and shown
 * in an iframe whose `sandbox` grants **only** `allow-scripts`:
 *
 *   - `allow-scripts`          — the page may run JS, so charts and
 *                               interactive widgets work
 *   - no `allow-same-origin`  — it is a unique opaque origin, so it cannot
 *                               reach Hive's cookies, storage, or DOM. This
 *                               flag must NEVER be added: together with
 *                               `allow-scripts` on a blob minted by Hive's
 *                               origin it would let the page strip its own
 *                               sandbox.
 *   - no `allow-top-navigation` / `allow-popups` /
 *     `allow-popups-to-escape-sandbox` / `allow-forms` / `allow-modals`
 *
 * Before the blob is built, `injectHtmlArtifactCsp` prepends a
 * Content-Security-Policy meta tag that limits where the sandboxed page may
 * load code and assets from (a fixed CDN allowlist) and what it may talk to.
 * See `@/lib/utils/html-artifact-csp` for the policy and its rationale.
 *
 * The blob URL is the only value ever assigned to `src`; the proxy URL and
 * raw S3 URLs are never navigated to. `dangerouslySetInnerHTML` and `srcDoc`
 * are deliberately unused.
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { htmlArtifactProxyUrl, type HtmlArtifactSource } from "@/lib/utils/html-body-proxy";
import { injectHtmlArtifactCsp } from "@/lib/utils/html-artifact-csp";

export type { HtmlArtifactSource };

export const HTML_FRAME_SANDBOX = "allow-scripts";

interface HtmlArtifactFrameProps {
  source: HtmlArtifactSource;
  title?: string;
  className?: string;
  /**
   * Optional cache-buster. `update_html` returns `updatedAt`; keying
   * the fetch effect on it (in addition to `source`) re-fetches fresh
   * bytes after a successful patch so an already-open frame or
   * sidebar card doesn't keep showing a stale blob.
   */
  updatedAt?: string;
}

export function HtmlArtifactFrame({ source, title, className, updatedAt }: HtmlArtifactFrameProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const objectUrlRef = useRef<string | null>(null);

  const url = htmlArtifactProxyUrl(source);

  useEffect(() => {
    let cancelled = false;

    const revoke = () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(url, {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) {
          throw new Error(
            res.status === 404
              ? "This page is no longer available."
              : "You don't have access to this page.",
          );
        }
        const html = await res.text();
        if (cancelled) return;
        // Re-type the opaque download as HTML only inside the blob, which
        // renders in the sandboxed frame's opaque origin, with the CSP
        // meta tag prepended so the policy governs everything in the page.
        const htmlBlob = new Blob([injectHtmlArtifactCsp(html)], {
          type: "text/html; charset=utf-8",
        });
        revoke();
        const next = URL.createObjectURL(htmlBlob);
        objectUrlRef.current = next;
        setBlobUrl(next);
      } catch (e) {
        if (cancelled) return;
        setBlobUrl(null);
        setError(e instanceof Error ? e.message : "Failed to load this page.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
      revoke();
    };
  }, [url, updatedAt]);

  if (loading) {
    return (
      <div
        className={cn(
          "flex h-full w-full items-center justify-center bg-muted/30 text-muted-foreground",
          className,
        )}
      >
        <Loader2 className="h-4 w-4 animate-spin" aria-label="Loading page" />
      </div>
    );
  }

  if (error || !blobUrl) {
    return (
      <div
        className={cn(
          "flex h-full w-full flex-col items-center justify-center gap-2 bg-muted/30 p-6 text-center",
          className,
        )}
      >
        <AlertTriangle className="h-5 w-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {error ?? "Failed to load this page."}
        </p>
      </div>
    );
  }

  return (
    <iframe
      src={blobUrl}
      title={title || "HTML artifact"}
      sandbox={HTML_FRAME_SANDBOX}
      referrerPolicy="no-referrer"
      className={cn("h-full w-full border-0 bg-white", className)}
    />
  );
}

export default HtmlArtifactFrame;
