"use client";

/**
 * The single renderer for stored HTML pages.
 *
 * Untrusted markup is never injected into Hive's DOM. Instead the bytes are
 * fetched from an authenticated body proxy, wrapped in a blob URL, and shown
 * in an iframe whose `sandbox` grants **nothing**:
 *
 *   - no `allow-scripts`      — the page cannot run JS
 *   - no `allow-same-origin`  — it is a unique opaque origin, so it cannot
 *                               reach Hive's cookies, storage, or DOM
 *   - no `allow-top-navigation` / `allow-popups-to-escape-sandbox`
 *
 * The blob URL is the only value ever assigned to `src`; the proxy URL and
 * raw S3 URLs are never navigated to. `dangerouslySetInnerHTML` and `srcDoc`
 * are deliberately unused.
 *
 * Interactive charts/scripts are out of scope for this locked frame.
 */
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Two address shapes — never a raw `s3Key`. */
export type HtmlArtifactSource =
  | { githubLogin: string; slug: string }
  | { taskId: string; artifactId: string };

export const HTML_FRAME_SANDBOX = "";

function proxyUrl(source: HtmlArtifactSource): string {
  if ("githubLogin" in source) {
    return `/api/orgs/${encodeURIComponent(source.githubLogin)}/html-pages/${encodeURIComponent(source.slug)}`;
  }
  return `/api/tasks/${encodeURIComponent(source.taskId)}/artifacts/${encodeURIComponent(source.artifactId)}/html`;
}

interface HtmlArtifactFrameProps {
  source: HtmlArtifactSource;
  title?: string;
  className?: string;
}

export function HtmlArtifactFrame({ source, title, className }: HtmlArtifactFrameProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const objectUrlRef = useRef<string | null>(null);

  const url = proxyUrl(source);

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
        const bytes = await res.blob();
        if (cancelled) return;
        // Re-type the opaque download as HTML only inside the blob, which
        // renders in the sandboxed frame's opaque origin.
        const htmlBlob = new Blob([bytes], { type: "text/html" });
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
  }, [url]);

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
