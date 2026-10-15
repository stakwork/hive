"use client";

import React, { useMemo, useState } from "react";
import { CircleCheck, CircleDashed, CircleX, Server } from "lucide-react";
import { parseStrutArtifactKey, strutArtifactReaderUrl } from "@/lib/strut-jobs";
import { listArtifacts, type ArtifactRef } from "../_state/canvasChatArtifacts";
import { selectActiveMessages, useCanvasChatStore } from "../_state/canvasChatStore";
import { liveItemsToShow, useJobLiveStore, type JobLiveItem } from "../_state/jobLiveStore";
import { useChatOrgLogin } from "./artifacts/useArtifactPanel";
import { WalkthroughInline } from "./artifacts/viewers/walkthrough";

/**
 * What a strut job is doing while its turn runs (strut
 * plans/live-artifacts.md), under the working card: the shots it takes, a
 * walkthrough as it records (scrubbable already), the pods it holds, each
 * check's verdict as it lands. Fed by the job's live updates
 * (`jobLiveStore`); only what arrived since the card appeared, and nothing
 * the conversation already shows as an artifact under the same link — the
 * turn's own cards take over when its row lands.
 */

/** The newest shots shown as thumbnails; the rest are in the job's files. */
const MAX_THUMBNAILS = 6;

const EMPTY: JobLiveItem[] = [];

function verdictIcon(state: string | undefined) {
  if (state === "supported") return <CircleCheck className="h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />;
  if (state === "refuted") return <CircleX className="h-3 w-3 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden />;
  return <CircleDashed className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />;
}

const VERDICT_WORDS: Record<string, string> = { supported: "holds", refuted: "does not hold", planned: "waits on a person's look" };

/** A frame or a screenshot strut serves: shown through the reader route. */
const isFileLink = (url: string | undefined): url is string => !!url && parseStrutArtifactKey(url) !== null;

export function JobLiveStrip({ jobId, since }: { jobId: string; since: number }) {
  const githubLogin = useChatOrgLogin();
  const items = useJobLiveStore((s) => s.byJob[jobId] ?? EMPTY);
  const messages = useCanvasChatStore(selectActiveMessages);
  // What the conversation already shows, by link: a live item for the same file is not shown twice.
  const delivered = useMemo(
    () => new Set(listArtifacts(messages).flatMap((a: ArtifactRef) => (a.source.type === "graph" ? [a.source.key] : []))),
    [messages],
  );
  const shown = liveItemsToShow(items, { since, delivered });
  if (shown.length === 0) return null;

  const shots = shown.filter((i) => i.kind === "image" && isFileLink(i.url)).slice(-MAX_THUMBNAILS);
  const recordings = shown.filter((i) => i.kind === "walkthrough" && isFileLink(i.url));
  const lines = shown.filter((i) => !shots.includes(i) && !recordings.includes(i) && i.kind !== "image");

  return (
    <div data-testid="job-live-strip" className="space-y-2 border-t px-3 py-2">
      {recordings.map((r) => (
        <div key={r.key} data-testid="job-live-walkthrough" className="overflow-hidden rounded-md border">
          <div className="px-2 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {r.state === "recording" ? "Recording" : "Walkthrough"}
            {r.title ? ` · ${r.title}` : ""}
          </div>
          <WalkthroughInline
            artifact={{ id: r.key, kind: "walkthrough", title: r.title ?? "Walkthrough", source: { type: "graph", swarmId: r.swarmId, key: r.url! } }}
            content={{ swarmId: r.swarmId, key: r.url! }}
          />
        </div>
      ))}
      {shots.length > 0 && (
        <div data-testid="job-live-shots" className="flex gap-1.5 overflow-x-auto">
          {shots.map((s) => (
            <Thumbnail key={s.key} href={strutArtifactReaderUrl(githubLogin, s.swarmId, s.url!)} title={s.title ?? "Screenshot"} />
          ))}
        </div>
      )}
      {lines.map((i) => (
        <div key={i.key} data-testid="job-live-line" className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          {i.kind === "evidence" ? verdictIcon(i.state) : <Server className="h-3 w-3 shrink-0" aria-hidden />}
          <span className="min-w-0 truncate">
            {i.kind === "evidence" ? (
              <>
                <span className="text-foreground/90">{i.title ?? "A claim"}</span> {VERDICT_WORDS[i.state ?? ""] ?? i.state}
              </>
            ) : (
              <>
                {i.kind} {i.state ?? "updated"}
                {i.url && !isFileLink(i.url) && (
                  <>
                    {" · "}
                    <a href={i.url} target="_blank" rel="noreferrer" className="hover:underline">
                      {i.url}
                    </a>
                  </>
                )}
              </>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function Thumbnail({ href, title }: { href: string; title: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" title={title} className="block h-16 w-24 shrink-0 overflow-hidden rounded border bg-muted/30">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={href} alt={title} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover object-top" />
    </a>
  );
}
