"use client";

import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { strutArtifactReaderUrl } from "@/lib/strut-jobs";
import type { ArtifactViewerProps } from "../../../_state/canvasChatArtifacts";
import { useLatestUpdateFor } from "../../../_state/jobLiveStore";
import { useChatOrgLogin } from "../useArtifactPanel";
import { PanelToolbar } from "../chrome";
import { parseWalkthroughManifest, type WalkthroughManifest } from "../walkthroughManifest";

/**
 * A walkthrough (strut `browser/walkthrough`, plans/live-artifacts.md §4):
 * a strut job's recording of a flow, frame by frame, scrubbed like a video.
 * The manifest is read through the reader route and read AGAIN whenever the
 * job reports the recording changed (`useLatestUpdateFor`, fed by the job's
 * live updates), so a recording in progress fills in as it is made. The
 * frames are its siblings on the swarm, through the same route.
 */

type Loaded = { status: "loading" } | { status: "failed" } | { status: "ready"; manifest: WalkthroughManifest };

/** The manifest at `key`, read again on each update the job reports for it. Key the caller by `key`: a failed re-read keeps what it had. */
export function useWalkthrough(swarmId: string, key: string): Loaded {
  const githubLogin = useChatOrgLogin();
  // A new frame on this recording: read the manifest again.
  const tick = useLatestUpdateFor(key)?.receivedAt ?? 0;
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    fetch(strutArtifactReaderUrl(githubLogin, swarmId, key), { credentials: "same-origin", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((raw) => {
        const manifest = parseWalkthroughManifest(raw, key);
        if (!cancelled) setLoaded(manifest ? { status: "ready", manifest } : { status: "failed" });
      })
      .catch(() => {
        if (!cancelled) setLoaded((prev) => (prev.status === "ready" ? prev : { status: "failed" }));
      });
    return () => {
      cancelled = true;
    };
  }, [githubLogin, swarmId, key, tick]);
  return loaded;
}

const STATUS_WORDS: Record<string, string> = { recording: "Recording…", done: "Done", stopped: "Stopped" };

/** The frames, one at a time, with a slider and a strip to step through them. ← → step on the panel. */
function Scrubber({ swarmId, manifest, compact }: { swarmId: string; manifest: WalkthroughManifest; compact?: boolean }) {
  const githubLogin = useChatOrgLogin();
  const count = manifest.frames.length;
  const [at, setAt] = useState<number | null>(null);
  // Following the newest frame until the reader picks one.
  const i = Math.min(at ?? count - 1, count - 1);
  useEffect(() => {
    if (compact) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setAt(Math.max(0, i - 1));
      if (e.key === "ArrowRight") setAt(Math.min(count - 1, i + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [compact, i, count]);
  if (count === 0) return <p className="px-3 py-6 text-center text-xs text-muted-foreground">No frames yet.</p>;
  const frame = manifest.frames[i];
  const src = (key: string) => strutArtifactReaderUrl(githubLogin, swarmId, key);
  return (
    <div data-testid="walkthrough" className={cn("flex flex-col gap-2", compact ? "p-2" : "min-h-0 flex-1 p-3")}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src(frame.key)}
        alt={frame.caption}
        className={cn(
          "w-full rounded border bg-muted/30 object-contain",
          compact ? "max-h-56" : "min-h-0 flex-1",
          frame.failed && "border-rose-500/60",
        )}
      />
      <div className="flex items-baseline gap-2 text-xs">
        <span data-testid="walkthrough-count" className="shrink-0 tabular-nums text-muted-foreground">
          {i + 1} / {count}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{frame.caption}</span>
        {!compact && frame.pageUrl && <span className="max-w-[40%] truncate text-muted-foreground">{frame.pageUrl}</span>}
      </div>
      {frame.failed && <p className="text-xs text-rose-600 dark:text-rose-400">{frame.failed}</p>}
      {count > 1 && (
        <input
          type="range"
          min={0}
          max={count - 1}
          value={i}
          aria-label="Frame"
          onChange={(e) => setAt(Number(e.target.value))}
          onClick={(e) => e.stopPropagation()}
          className="w-full"
        />
      )}
      {!compact && count > 1 && (
        <div className="flex gap-1 overflow-x-auto pb-1">
          {manifest.frames.map((f, n) => (
            <button
              key={f.key}
              type="button"
              title={f.caption}
              onClick={() => setAt(n)}
              className={cn(
                "w-24 shrink-0 overflow-hidden rounded border-2 opacity-70 hover:opacity-100",
                n === i ? "border-foreground/60 opacity-100" : "border-transparent",
                f.failed && "border-rose-500/60",
              )}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src(f.key)} alt={f.caption} loading="lazy" className="block w-full" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Unavailable() {
  return <p className="px-3 py-6 text-center text-xs text-muted-foreground">This recording could not be loaded.</p>;
}

/** The card's preview: the newest frame (or the one picked), its caption, a slider — operable in place. */
export function WalkthroughInline({ content }: ArtifactViewerProps<"walkthrough">) {
  const loaded = useWalkthrough(content.swarmId, content.key);
  if (loaded.status === "loading") return <p className="px-3 py-4 text-xs text-muted-foreground">Loading…</p>;
  if (loaded.status === "failed") return <Unavailable />;
  return <Scrubber swarmId={content.swarmId} manifest={loaded.manifest} compact />;
}

/** The panel: the frame large, its page, the slider and a filmstrip; what stopped it, when something did. */
export function WalkthroughPanel({ content }: ArtifactViewerProps<"walkthrough">) {
  const loaded = useWalkthrough(content.swarmId, content.key);
  const manifest = loaded.status === "ready" ? loaded.manifest : null;
  return (
    <div className="flex h-full flex-col">
      <PanelToolbar>
        <span className="min-w-0 truncate font-medium">{manifest?.title ?? "Walkthrough"}</span>
        {manifest?.status && (
          <span className={cn("ml-auto text-muted-foreground", manifest.status === "stopped" && "text-rose-600 dark:text-rose-400")}>
            {STATUS_WORDS[manifest.status] ?? manifest.status}
          </span>
        )}
      </PanelToolbar>
      {loaded.status === "loading" && <p className="px-3 py-6 text-xs text-muted-foreground">Loading…</p>}
      {loaded.status === "failed" && <Unavailable />}
      {manifest && <Scrubber swarmId={content.swarmId} manifest={manifest} />}
      {manifest && manifest.failed.length > 0 && !manifest.frames.some((f) => f.failed) && (
        <p className="px-3 pb-3 text-xs text-rose-600 dark:text-rose-400">{manifest.failed.join(" · ")}</p>
      )}
    </div>
  );
}
