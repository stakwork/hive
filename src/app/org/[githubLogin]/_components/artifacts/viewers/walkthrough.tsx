"use client";

import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pause, Play } from "lucide-react";
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

/**
 * The manifest at `key`, read again on each update the job reports for it.
 * Read through React Query, keyed by the update tick, so every view of the
 * same recording (the chat card, the panel, a claim's evidence, the live
 * strip) shares one read per new frame.
 */
export function useWalkthrough(swarmId: string, key: string): Loaded {
  const githubLogin = useChatOrgLogin();
  // A new frame on this recording: read the manifest again.
  const tick = useLatestUpdateFor(key)?.receivedAt ?? 0;
  const query = useQuery({
    queryKey: ["walkthrough-manifest", githubLogin, swarmId, key, tick],
    queryFn: async () => {
      const r = await fetch(strutArtifactReaderUrl(githubLogin, swarmId, key), { credentials: "same-origin", cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      const manifest = parseWalkthroughManifest(await r.json(), key);
      if (!manifest) throw new Error("unreadable manifest");
      return manifest;
    },
    // A new frame is a new key; views that mount together share the read.
    retry: false,
  });
  // While a new tick's read is in flight, or after it fails: the last good manifest.
  const recording = `${swarmId}:${key}`;
  const [lastGood, setLastGood] = useState<{ recording: string; manifest: WalkthroughManifest } | null>(null);
  if (query.data && lastGood?.manifest !== query.data) setLastGood({ recording, manifest: query.data });
  const manifest = query.data ?? (lastGood?.recording === recording ? lastGood.manifest : undefined);
  if (manifest) return { status: "ready", manifest };
  return query.isError ? { status: "failed" } : { status: "loading" };
}

const STATUS_WORDS: Record<string, string> = { recording: "Recording…", done: "Done", stopped: "Stopped" };

/** How long each frame shows while playing. */
const STEP_MS = 800;

/** The native range, drawn as a round thumb over the step bar behind it. */
const RANGE = cn(
  "relative block h-3 w-full cursor-pointer appearance-none rounded-full bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
  "[&::-webkit-slider-runnable-track]:h-3 [&::-webkit-slider-runnable-track]:bg-transparent",
  "[&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-blue-500 [&::-webkit-slider-thumb]:bg-background [&::-webkit-slider-thumb]:shadow",
  "[&::-moz-range-track]:bg-transparent [&::-moz-range-progress]:bg-transparent",
  "[&::-moz-range-thumb]:size-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-blue-500 [&::-moz-range-thumb]:bg-background [&::-moz-range-thumb]:shadow",
);

/**
 * The frames, one at a time, with play, a slider and a strip to step through them. ← → step on the panel.
 * Every frame is mounted, stacked and hidden but the one showing, so the
 * browser has them all by the time the reader scrubs or plays to one.
 */
function Scrubber({ swarmId, manifest, compact }: { swarmId: string; manifest: WalkthroughManifest; compact?: boolean }) {
  const githubLogin = useChatOrgLogin();
  const count = manifest.frames.length;
  const [at, setAt] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  // Following the newest frame until the reader picks one.
  const i = Math.min(at ?? count - 1, count - 1);
  // Playing: the next frame every STEP_MS, from wherever the reader is, until the last.
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => {
      setAt(Math.min(i + 1, count - 1));
      if (i + 1 >= count - 1) setPlaying(false);
    }, STEP_MS);
    return () => clearTimeout(t);
  }, [playing, i, count]);
  const togglePlay = () => {
    // At the end, play starts over.
    if (!playing && i >= count - 1) setAt(0);
    setPlaying(!playing);
  };
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
      <div className={cn("grid", !compact && "min-h-0 flex-1 grid-rows-[minmax(0,1fr)]")}>
        {manifest.frames.map((f, n) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={f.key}
            src={src(f.key)}
            alt={f.caption}
            aria-hidden={n !== i || undefined}
            loading={n === i ? "eager" : "lazy"}
            fetchPriority={n === i ? "high" : "low"}
            className={cn(
              "w-full rounded border bg-muted/30 object-contain [grid-area:1/1]",
              compact ? "max-h-56" : "h-full min-h-0",
              n !== i && "invisible",
              f.failed && "border-rose-500/60",
            )}
          />
        ))}
      </div>
      <div className="flex items-baseline gap-2 text-xs">
        <span data-testid="walkthrough-count" className="shrink-0 tabular-nums text-muted-foreground">
          {i + 1} / {count}
        </span>
        <span className="min-w-0 flex-1 truncate font-medium">{frame.caption}</span>
        {!compact && frame.pageUrl && <span className="max-w-[40%] truncate text-muted-foreground">{frame.pageUrl}</span>}
      </div>
      {frame.failed && <p className="text-xs text-rose-600 dark:text-rose-400">{frame.failed}</p>}
      {count > 1 && (
        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            aria-label={playing ? "Pause" : "Play"}
            onClick={togglePlay}
            className="flex size-6 shrink-0 items-center justify-center rounded-full text-blue-600 hover:bg-muted dark:text-blue-400"
          >
            {playing ? <Pause className="size-3.5 fill-current" /> : <Play className="size-3.5 fill-current" />}
          </button>
          <div className="relative min-w-0 flex-1">
            {/* A segment per step, in two alternating blues; the ones still ahead are faded. Inset by the thumb's radius so the edges meet the steps. */}
            <div
              data-testid="walkthrough-steps"
              aria-hidden
              className="pointer-events-none absolute inset-x-1.5 top-1/2 flex h-1.5 -translate-y-1/2 overflow-hidden rounded-full"
            >
              {Array.from({ length: count - 1 }, (_, n) => (
                <span key={n} className={cn("flex-1", n % 2 ? "bg-blue-400" : "bg-blue-500", n >= i && "opacity-40")} />
              ))}
            </div>
            <input
              type="range"
              min={0}
              max={count - 1}
              value={i}
              aria-label="Frame"
              onChange={(e) => setAt(Number(e.target.value))}
              className={RANGE}
            />
          </div>
        </div>
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
