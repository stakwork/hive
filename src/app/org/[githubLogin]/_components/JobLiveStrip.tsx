"use client";

import React, { useMemo, useState } from "react";
import { Clapperboard, ImageIcon, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { parseStrutArtifactKey, strutArtifactReaderUrl } from "@/lib/strut-jobs";
import { listArtifacts, type ArtifactRef } from "../_state/canvasChatArtifacts";
import { selectActiveMessages, useCanvasChatStore } from "../_state/canvasChatStore";
import { liveItemsToShow, useJobLiveStore, type JobLiveItem } from "../_state/jobLiveStore";
import { plural } from "./artifacts/lines";
import { useChatOrgLogin } from "./artifacts/useArtifactPanel";
import { useWalkthrough } from "./artifacts/viewers/walkthrough";

/**
 * What a strut job is doing while its turn runs (strut
 * plans/live-artifacts.md), under the working card, kept small: ONE tile
 * for the newest thing it showed — the recording it is making (its newest
 * frame) or the shot it just took — which opens on the artifact panel, and
 * one line counting the rest: recordings and how many stopped, shots, what
 * it holds, the checks' verdicts. A job retries a recording that stopped,
 * so earlier ones are counted, never drawn. Fed by the job's live updates
 * (`jobLiveStore`); only what arrived since the card appeared, and nothing
 * the conversation already shows under the same link — the turn's own
 * cards take over when its row lands.
 */

const EMPTY: JobLiveItem[] = [];

/** A manifest or a screenshot strut serves: read through the reader route. */
const isFileLink = (url: string | undefined): url is string => !!url && parseStrutArtifactKey(url) !== null;

type Visual = JobLiveItem & { kind: "walkthrough" | "image"; url: string };

/** What the tile shows: a recording or a shot, as a file strut serves. */
const isVisual = (i: JobLiveItem): i is Visual => (i.kind === "walkthrough" || i.kind === "image") && isFileLink(i.url);

/** A live item as the panel opens it: the same graph key the turn's delivered card will have, so that card takes over. */
export function liveArtifact(item: Visual): ArtifactRef {
  const walkthrough = item.kind === "walkthrough";
  return {
    id: item.url,
    kind: item.kind,
    title: item.title ?? (walkthrough ? "Walkthrough" : "Screenshot"),
    label: walkthrough ? "Walkthrough" : "Screenshot",
    source: { type: "graph", swarmId: item.swarmId, key: item.url },
  };
}

const VERDICTS: [state: string, word: string][] = [
  ["supported", "supported"],
  ["refuted", "refuted"],
  ["planned", "waiting on a look"],
];

/** The line under the tile: how many of each thing, never a list. A single hold with a page links to it. Pure. */
export function liveTally(items: readonly JobLiveItem[]): { text: string; href?: string }[] {
  const parts: { text: string; href?: string }[] = [];
  const recordings = items.filter((i) => i.kind === "walkthrough" && isFileLink(i.url));
  if (recordings.length > 0) {
    const stopped = recordings.filter((i) => i.state === "stopped").length;
    parts.push({ text: `${plural(recordings.length, "recording")}${stopped > 0 ? `, ${stopped} stopped` : ""}` });
  }
  const shots = items.filter((i) => i.kind === "image" && isFileLink(i.url)).length;
  if (shots > 0) parts.push({ text: plural(shots, "shot") });
  // A hold's kind is passed through (`pod`); one let go is no longer the job's.
  const held = items.filter((i) => i.state === "held");
  for (const kind of new Set(held.map((i) => i.kind))) {
    const ofKind = held.filter((i) => i.kind === kind);
    const href = ofKind.length === 1 && ofKind[0].url && /^https?:\/\//.test(ofKind[0].url) ? ofKind[0].url : undefined;
    parts.push({ text: `${ofKind.length === 1 ? kind : plural(ofKind.length, kind)} held`, ...(href ? { href } : {}) });
  }
  const evidence = items.filter((i) => i.kind === "evidence");
  if (evidence.length > 0) {
    const words = VERDICTS.map(([state, word]) => [evidence.filter((i) => i.state === state).length, word] as const)
      .filter(([count]) => count > 0)
      .map(([count, word]) => `${count} ${word}`);
    parts.push({ text: `${plural(evidence.length, "check")}${words.length > 0 ? `: ${words.join(", ")}` : ""}` });
  }
  return parts;
}

export function JobLiveStrip({ jobId, since }: { jobId: string; since: number }) {
  const items = useJobLiveStore((s) => s.byJob[jobId] ?? EMPTY);
  const messages = useCanvasChatStore(selectActiveMessages);
  // What the conversation already shows, by link: a live item for the same file is not shown twice.
  const delivered = useMemo(
    () => new Set(listArtifacts(messages).flatMap((a: ArtifactRef) => (a.source.type === "graph" ? [a.source.key] : []))),
    [messages],
  );
  const shown = liveItemsToShow(items, { since, delivered });
  if (shown.length === 0) return null;

  // The store moves a thing to the end on each update, so the last visual is the one that changed most recently.
  const visuals = shown.filter(isVisual);
  const now = visuals[visuals.length - 1];
  const tally = now && shown.length === 1 ? [] : liveTally(shown);
  const verdicts = shown.filter((i) => i.kind === "evidence").map((i) => `${i.state ?? "evidence"}: ${i.title ?? "a claim"}`);

  return (
    <div data-testid="job-live-strip" className="space-y-1.5 border-t px-3 py-2">
      {now &&
        (now.kind === "walkthrough" ? <WalkthroughTile key={now.key} item={now} /> : <ShotTile key={now.key} item={now} />)}
      {tally.length > 0 && (
        <div
          data-testid="job-live-tally"
          title={verdicts.length > 0 ? verdicts.join("\n") : undefined}
          className="truncate text-xs text-muted-foreground"
        >
          {tally.map((part, i) => (
            <React.Fragment key={part.text}>
              {i > 0 && " · "}
              {part.href ? (
                <a href={part.href} target="_blank" rel="noreferrer" className="hover:text-foreground hover:underline">
                  {part.text}
                </a>
              ) : (
                part.text
              )}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

const RECORDING_WORDS: Record<string, string> = { recording: "Recording", done: "Recorded", stopped: "Stopped" };

/** The recording: its newest frame, read off the manifest it rewrites after each one. */
function WalkthroughTile({ item }: { item: Visual }) {
  const githubLogin = useChatOrgLogin();
  const loaded = useWalkthrough(item.swarmId, item.url);
  const manifest = loaded.status === "ready" ? loaded.manifest : null;
  const frame = manifest?.frames[manifest.frames.length - 1];
  const state = item.state ?? manifest?.status ?? "recording";
  const title = manifest?.title ?? item.title;
  return (
    <Tile
      item={item}
      src={frame && strutArtifactReaderUrl(githubLogin, item.swarmId, frame.key)}
      Icon={Clapperboard}
      label={[RECORDING_WORDS[state] ?? state, title].filter(Boolean).join(" · ")}
      caption={frame && manifest ? `${frame.caption || "Frame"} · ${plural(manifest.frames.length, "frame")}` : undefined}
      stopped={state === "stopped"}
    />
  );
}

function ShotTile({ item }: { item: Visual }) {
  const githubLogin = useChatOrgLogin();
  return (
    <Tile
      item={item}
      src={strutArtifactReaderUrl(githubLogin, item.swarmId, item.url)}
      Icon={ImageIcon}
      label="Screenshot"
      caption={item.title}
    />
  );
}

function Tile({
  item,
  src,
  Icon,
  label,
  caption,
  stopped = false,
}: {
  item: Visual;
  src: string | undefined;
  Icon: LucideIcon;
  label: string;
  caption?: string;
  stopped?: boolean;
}) {
  const [brokenSrc, setBrokenSrc] = useState<string | null>(null);
  return (
    <button
      type="button"
      data-testid="job-live-now"
      title="Open on the panel"
      onClick={() => useCanvasChatStore.getState().openLiveArtifact(liveArtifact(item))}
      className="flex w-full min-w-0 items-center gap-2.5 rounded-md border p-1.5 text-left transition-colors hover:bg-muted/50"
    >
      <span className="flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted/30">
        {src && src !== brokenSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="" onError={() => setBrokenSrc(src)} className="h-full w-full object-cover object-top" />
        ) : (
          <Icon aria-hidden className="h-4 w-4 text-muted-foreground" />
        )}
      </span>
      <span className="min-w-0 flex-1 text-xs">
        <span className={cn("block truncate font-medium", stopped && "text-rose-600 dark:text-rose-400")}>{label}</span>
        {caption && <span className="block truncate text-muted-foreground">{caption}</span>}
      </span>
    </button>
  );
}
