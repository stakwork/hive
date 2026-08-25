"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Download, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type DownloadState = "idle" | "loading" | "error";

/**
 * Parses a `Content-Disposition` header value and returns the filename, or
 * `null` if none is present or the header is malformed.
 *
 * Handles both the plain `filename="..."` and the RFC 5987
 * `filename*=UTF-8''...` forms, preferring the RFC 5987 form.
 */
function parseFilename(header: string | null): string | null {
  if (!header) return null;

  // RFC 5987: filename*=UTF-8''...
  const rfc5987 = header.match(/filename\*=UTF-8''([^;,\s]+)/i);
  if (rfc5987?.[1]) {
    try {
      return decodeURIComponent(rfc5987[1]);
    } catch {
      // Malformed percent-encoding — fall through to the plain form.
    }
  }

  // Plain: filename="..." or filename=...
  const plain = header.match(/filename="([^"]+)"/i) ?? header.match(/filename=([^;,\s]+)/i);
  if (plain?.[1]) return plain[1];

  return null;
}

interface DownloadReportButtonProps {
  /** Absolute path of the export API route, e.g. `/api/workspaces/.../export`. */
  exportUrl: string;
  /** Button label when idle. Defaults to "Download ZIP". */
  label?: string;
}

/**
 * Client component that downloads a ZIP export from `exportUrl`.
 *
 * State machine: idle → loading → idle (success) | error → idle (retry).
 *
 * Mirrors the `handleDownload` pattern in `DocumentViewerModal` (fetch → Blob
 * → createObjectURL → anchor click → revokeObjectURL) but adds full state
 * handling, a non-OK error guard so 4xx/5xx JSON bodies never become corrupt
 * "downloads", and an AbortController tied to useEffect cleanup so in-flight
 * requests are cancelled on unmount.
 */
export function DownloadReportButton({
  exportUrl,
  label = "Download ZIP",
}: DownloadReportButtonProps) {
  const [state, setState] = useState<DownloadState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Holds the AbortController for the currently in-flight fetch, if any.
  // A ref rather than state so changes don't trigger re-renders.
  const abortRef = useRef<AbortController | null>(null);

  // Cancel any in-flight request when the component unmounts.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const triggerDownload = useCallback(async () => {
    if (state === "loading") return;

    // Create a fresh controller for this attempt; store it so cleanup can
    // cancel it and so a previous stale controller is not reused.
    const controller = new AbortController();
    abortRef.current = controller;

    setState("loading");
    setErrorMessage(null);

    let objectUrl: string | null = null;

    try {
      const response = await fetch(exportUrl, { signal: controller.signal });

      if (!response.ok) {
        // Intentionally do NOT read the body as a Blob — a 4xx/5xx body is
        // a JSON error object, not a ZIP, and piping it into createObjectURL
        // would produce a corrupted download.
        let detail: string | null = null;
        try {
          const json = (await response.json()) as { error?: string };
          if (typeof json?.error === "string") detail = json.error;
        } catch {
          // Body wasn't JSON — the HTTP status line is enough.
        }
        setErrorMessage(detail ?? `Server returned ${response.status}`);
        setState("error");
        return;
      }

      const blob = await response.blob();
      objectUrl = URL.createObjectURL(blob);

      const filename =
        parseFilename(response.headers.get("Content-Disposition")) ??
        "report-export.zip";

      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      anchor.style.display = "none";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);

      setState("idle");
    } catch (err) {
      // AbortError is expected on unmount — don't put the component into the
      // error state for a cancelled request since there's no component to
      // update anyway.
      if (err instanceof DOMException && err.name === "AbortError") return;

      const message =
        err instanceof Error ? err.message : "An unexpected error occurred";
      setErrorMessage(message);
      setState("error");
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      // Clear the stored ref only if this controller is still the current one
      // (a retry may have already created a new one).
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [exportUrl, state]);

  if (state === "error") {
    return (
      <div
        className="flex items-center gap-2"
        data-testid="download-report-error"
      >
        <AlertCircle className="h-4 w-4 shrink-0 text-destructive" />
        <span className="text-sm text-destructive">
          {errorMessage ?? "Download failed."}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={triggerDownload}
          data-testid="download-report-retry"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Retry
        </Button>
      </div>
    );
  }

  const isLoading = state === "loading";

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={triggerDownload}
      disabled={isLoading}
      aria-label={isLoading ? "Building download…" : label}
      data-testid="download-report-button"
    >
      {isLoading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Download className="h-3.5 w-3.5" />
      )}
      {isLoading ? "Building…" : label}
    </Button>
  );
}
