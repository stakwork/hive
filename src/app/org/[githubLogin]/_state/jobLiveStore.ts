/**
 * What strut jobs are doing RIGHT NOW, as their live updates arrive (strut
 * plans/live-artifacts.md): a shot just taken, a walkthrough recording frame
 * by frame, a pod held or let go, a check's verdict, a Verify that ended.
 * Fed by the conversation channel's `CANVAS_JOB_UPDATE`
 * (`useCanvasChatAutoSave`), read by the working card of a turn in flight
 * (`JobLiveStrip`), the walkthrough viewer (to read its manifest again on a
 * new frame) and the claims card (to show a Verify running).
 *
 * In memory only, and never the record: an update points at something
 * that has a home — a job file, the claims ledger, the turn's deliverables —
 * and what lasts arrives as the conversation's rows. A page that missed an
 * update just shows less until the turn's row lands.
 */
import { create } from "zustand";
import type { CanvasJobUpdate } from "@/lib/pusher";

/** A live update, kept: the newest state of one thing a job reported. */
export type JobLiveItem = CanvasJobUpdate & { key: string; receivedAt: number };

/** One thing a job reports about — strut coalesces on the same key: kind, link, id. */
export const liveKey = (u: Pick<CanvasJobUpdate, "kind" | "url" | "id">): string => `${u.kind}\u0000${u.url ?? ""}\u0000${u.id ?? ""}`;

/** How many things a job keeps live at once; the oldest go first. */
export const MAX_LIVE_ITEMS = 50;

/** An update applied: the thing's newest state replaces its earlier one and moves to the end. Pure. */
export function applyJobUpdate(items: readonly JobLiveItem[], update: CanvasJobUpdate, receivedAt: number): JobLiveItem[] {
  const key = liveKey(update);
  const next = [...items.filter((i) => i.key !== key), { ...update, key, receivedAt }];
  return next.length > MAX_LIVE_ITEMS ? next.slice(next.length - MAX_LIVE_ITEMS) : next;
}

/**
 * What a turn in flight shows: what arrived since it started, minus what
 * the conversation already shows as an artifact — the same file under the
 * same link (strut plans/live-artifacts.md §5: a live item and a delivered
 * artifact are matched by URL, never by id). A `verify` end is a signal,
 * not a thing to show. Pure.
 */
export function liveItemsToShow(items: readonly JobLiveItem[] | undefined, opts: { since?: number; delivered?: ReadonlySet<string> } = {}): JobLiveItem[] {
  return (items ?? []).filter(
    (i) => i.kind !== "verify" && (opts.since === undefined || i.receivedAt >= opts.since) && !(i.url && opts.delivered?.has(i.url)),
  );
}

interface JobLiveState {
  byJob: Record<string, JobLiveItem[]>;
  /** A Verify a person started on this page and strut has not ended: when it started. */
  verifying: Record<string, number>;
  apply: (update: CanvasJobUpdate) => void;
  startVerify: (jobId: string) => void;
}

export const useJobLiveStore = create<JobLiveState>()((set) => ({
  byJob: {},
  verifying: {},
  apply: (update) =>
    set((s) => {
      const byJob = { ...s.byJob, [update.jobId]: applyJobUpdate(s.byJob[update.jobId] ?? [], update, Date.now()) };
      if (update.kind !== "verify" || update.state !== "done" || !(update.jobId in s.verifying)) return { byJob };
      const { [update.jobId]: _ended, ...verifying } = s.verifying;
      return { byJob, verifying };
    }),
  startVerify: (jobId) => set((s) => ({ verifying: { ...s.verifying, [jobId]: Date.now() } })),
}));

/** The newest update about one link — what a viewer of that file re-reads on. */
export function useLatestUpdateFor(url: string): JobLiveItem | undefined {
  return useJobLiveStore((s) => {
    let latest: JobLiveItem | undefined;
    for (const items of Object.values(s.byJob)) for (const i of items) if (i.url === url && (!latest || i.receivedAt > latest.receivedAt)) latest = i;
    return latest;
  });
}
