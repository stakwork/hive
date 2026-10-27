"use client";

/**
 * The frame for a strut APP (strut plans/apps.md §7.4) — BESIDE
 * `HtmlArtifactFrame`, never instead of it: a page an agent wrote keeps its
 * own frame (blob URL, CSP meta, nav bridge). An app differs in two ways:
 *
 *  - **`srcdoc`, never a blob URL.** A blob document's `location.origin` is
 *    its creator's while its `pathname` is the whole blob URL, and the
 *    JSON-schema validator bundled into the MCP SDK (`@cfworker/json-schema`,
 *    via ext-apps) runs `new URL(origin + pathname)` at module time — the
 *    app's bundle dies before it mounts. As `srcdoc` the document is
 *    `about:srcdoc` with an opaque origin ("null"), the validator's fallback.
 *  - **Its bridge is ext-apps' `AppBridge`** (`./bridge`), relaying the
 *    page's `tools/call` to Hive's relay route as it is.
 *
 * The sandbox grants `allow-scripts` ONLY. Never `allow-same-origin`: a
 * srcdoc document inherits its parent's origin, so together with scripts it
 * would run as Hive itself — Hive's cookies, storage and DOM — and could
 * lift its own sandbox. No popups, forms, modals or top navigation either;
 * a link goes through `ui/open-link`, which this component opens.
 *
 * A deep link (strut plans/apps.md §7.1) is `?app=<name>&input=<the app's
 * own query>`: `toolInput` is that input as the page is opened with it, sent
 * again in place whenever it changes. A link the page opens to ITSELF is its
 * input now — resent even when unchanged, as the page may have moved —
 * with the host's address following (`appLinkHref`, replaced); a
 * link to another app is that app's page when the host has one.
 *
 * The document comes from the document route (`strutAppDocumentUrl`), which
 * reads it from the swarm with the swarm key; the token strut writes into it
 * is the app's file token, worth that app's files only. A loading overlay
 * covers the frame until the page's first `ui/notifications/size-changed`.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/hooks/use-theme";
import { strutAppDocumentUrl, strutAppInputOf, strutAppLinkOf, strutAppRelayUrl, strutDeepLinkOf, type StrutAppSource } from "@/lib/strut-apps";
import { isAllowedArtifactNavPath } from "@/lib/utils/html-artifact-nav";
import { connectStrutAppHost, type StrutAppHostConnection } from "./bridge";
import { hostContextFor, readHostStyles } from "./host-context";

export type { StrutAppSource };

export const STRUT_APP_FRAME_SANDBOX = "allow-scripts";

export interface StrutAppFrameProps {
  source: StrutAppSource;
  title?: string;
  className?: string;
  /** What the app is opened with (`ui/notifications/tool-input`), e.g. `{ runId }` or a link's `input`; sent again when it changes. */
  toolInput?: Record<string, unknown>;
  /**
   * `ui/message`: the conversation the app sits in (a job's). Absent where
   * there is none; the frame then says the message could not go anywhere.
   */
  onMessage?: (text: string) => void | Promise<void>;
  /** Hive's own view for a strut deep link (`wf=…&run=…`), or null when Hive has none here. */
  strutLinkHref?: (deepLink: string) => string | null;
  /** Hive's page for a link to an app (`?app=<name>&input=…`), or null when it has none for that app (then `strutLinkHref`). */
  appLinkHref?: (app: string, input?: string) => string | null;
  /** Changes when the app is rebuilt, so an open frame reloads. */
  reloadKey?: string | number;
}

type FrameState = { status: "loading" } | { status: "ready" } | { status: "error"; error: string };

async function fetchDocument(url: string): Promise<string> {
  // `no-cache`: the browser's copy is used only after the route says it is
  // current (a 304 against its ETag), so reopening an app downloads nothing.
  const res = await fetch(url, { credentials: "include", cache: "no-cache" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    const reason = typeof body?.error === "string" ? body.error : null;
    throw new Error(
      res.status === 404
        ? (reason ?? "This app is not available.")
        : res.status === 401 || res.status === 403
          ? "You don't have access to this app."
          : (reason ?? "The app could not be loaded."),
    );
  }
  return res.text();
}

export function StrutAppFrame({ source, title, className, toolInput, onMessage, strutLinkHref, appLinkHref, reloadKey }: StrutAppFrameProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const connRef = useRef<StrutAppHostConnection | null>(null);
  const [state, setState] = useState<FrameState>({ status: "loading" });
  const [height, setHeight] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const router = useRouter();
  const { resolvedTheme } = useTheme();

  // Read at connect time without reconnecting when the caller re-renders.
  const latest = useRef({ onMessage, strutLinkHref, appLinkHref, router, resolvedTheme, toolInput, app: source.app });
  latest.current = { onMessage, strutLinkHref, appLinkHref, router, resolvedTheme, toolInput, app: source.app };
  /** The input the open connection has, as a key (null before one connects). */
  const sentInput = useRef<string | null>(null);
  const inputKey = toolInput ? JSON.stringify(toolInput) : "";

  const documentUrl = strutAppDocumentUrl(source);
  const relayUrl = strutAppRelayUrl(source);
  const canMessage = !!onMessage;

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let cancelled = false;
    let conn: StrutAppHostConnection | null = null;
    setState({ status: "loading" });
    setHeight(null);
    setNotice(null);

    const openLink = (url: string): boolean => {
      const deepLink = strutDeepLinkOf(url);
      if (deepLink) {
        const target = strutAppLinkOf(deepLink);
        if (target && target.app === latest.current.app) {
          const args = strutAppInputOf(target.input);
          sentInput.current = args ? JSON.stringify(args) : "";
          connRef.current?.setToolInput(args);
          const here = latest.current.appLinkHref?.(target.app, target.input);
          if (here && isAllowedArtifactNavPath(here)) latest.current.router.replace(here, { scroll: false });
          return true;
        }
        const href = (target && latest.current.appLinkHref?.(target.app, target.input)) || latest.current.strutLinkHref?.(deepLink);
        if (!href || !isAllowedArtifactNavPath(href)) return false;
        latest.current.router.push(href);
        return true;
      }
      if (isAllowedArtifactNavPath(url)) {
        latest.current.router.push(url);
        return true;
      }
      if (/^https?:\/\//i.test(url)) {
        window.open(url, "_blank", "noopener,noreferrer");
        return true;
      }
      return false;
    };

    void (async () => {
      try {
        const html = await fetchDocument(documentUrl);
        if (cancelled) return;
        conn = await connectStrutAppHost({
          frame,
          relayUrl,
          hostContext: hostContextFor(latest.current.resolvedTheme === "dark" ? "dark" : "light", readHostStyles()),
          handlers: {
            onSize: ({ height: h }) => {
              if (cancelled) return;
              if (typeof h === "number" && h > 0) setHeight(Math.ceil(h));
              setState((s) => (s.status === "loading" ? { status: "ready" } : s));
            },
            onMessage: canMessage ? (text) => latest.current.onMessage?.(text) : undefined,
            onOpenLink: openLink,
            onUnavailable: (what) => {
              if (!cancelled) setNotice(`This app tried to ${what}.`);
            },
          },
        });
        if (cancelled) {
          await conn.close();
          return;
        }
        connRef.current = conn;
        // What initialize is followed by: the input as it is NOW.
        conn.setToolInput(latest.current.toolInput);
        sentInput.current = latest.current.toolInput ? JSON.stringify(latest.current.toolInput) : "";
        // Never a blob URL, never `src`: see the header.
        frame.srcdoc = html;
      } catch (e) {
        if (!cancelled) setState({ status: "error", error: e instanceof Error ? e.message : "The app could not be loaded." });
      }
    })();

    return () => {
      cancelled = true;
      connRef.current = null;
      sentInput.current = null;
      void conn?.close();
      frame.removeAttribute("srcdoc");
    };
  }, [documentUrl, relayUrl, canMessage, reloadKey]);

  // A theme change: hand the page the new context. Read on the next frame —
  // the provider re-themes the document in its own effect, after this one.
  useEffect(() => {
    const conn = connRef.current;
    if (!conn) return;
    const id = requestAnimationFrame(() => conn.setHostContext(hostContextFor(resolvedTheme === "dark" ? "dark" : "light", readHostStyles())));
    return () => cancelAnimationFrame(id);
  }, [resolvedTheme]);

  // A new input for the page already open: sent in place, no reload.
  useEffect(() => {
    const conn = connRef.current;
    if (!conn || sentInput.current === inputKey) return;
    sentInput.current = inputKey;
    conn.setToolInput(latest.current.toolInput);
  }, [inputKey]);

  // As tall as the page says it is, and never shorter than its area: a page
  // that fills the viewport then measures the area, so the two agree.
  const frameStyle: CSSProperties = { height: height ? `${height}px` : "100%", minHeight: "100%" };

  return (
    <div className={cn("relative h-full w-full overflow-auto", className)}>
      <iframe
        ref={frameRef}
        title={title || "App"}
        sandbox={STRUT_APP_FRAME_SANDBOX}
        referrerPolicy="no-referrer"
        className="block w-full border-0 bg-background"
        style={frameStyle}
      />
      {state.status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/30 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-label="Loading app" />
        </div>
      )}
      {/* The frame stays mounted under the error, so a reload has a window to connect to. */}
      {state.status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-muted p-6 text-center">
          <AlertTriangle className="h-5 w-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{state.error}</p>
        </div>
      )}
      {notice && (
        <div role="status" className="absolute inset-x-2 bottom-2 flex items-center gap-2 rounded-md border bg-background/95 px-3 py-2 text-xs text-muted-foreground shadow-sm">
          <span className="flex-1">{notice}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} className="rounded p-0.5 hover:bg-muted">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}

export default StrutAppFrame;
