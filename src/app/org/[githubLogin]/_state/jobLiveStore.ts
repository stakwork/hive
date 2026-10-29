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

/** Updates that are signals, never things to show: a Verify's end, and a
 *  run's graph writes (strut plans/live-feeds.md §2 — the canvas reads its
 *  trees again on them, through the org channel's nudge). */
const SIGNALS = new Set(["verify", "graph"]);

/**
 * What a turn in flight shows: what arrived since it started, minus what
 * the conversation already shows as an artifact — the same file under the
 * same link (strut plans/live-artifacts.md §5: a live item and a delivered
 * artifact are matched by URL, never by id). A signal is not a thing to
 * show. "Since it started" is `launchedAt` when the caller knows it on
 * STRUT's clock (an orchestrator turn's strut run id, a millisecond
 * timestamp) — compared with each update's `at`, strut's own stamp, so an
 * update that came before the card appeared still counts — else `since`,
 * when it was received on this page. Pure.
 */
export function liveItemsToShow(
  items: readonly JobLiveItem[] | undefined,
  opts: { since?: number; launchedAt?: number; delivered?: ReadonlySet<string> } = {},
): JobLiveItem[] {
  const after = (i: JobLiveItem): boolean => {
    const at = opts.launchedAt === undefined ? NaN : Date.parse(i.at);
    if (!Number.isNaN(at)) return at >= opts.launchedAt!;
    return opts.since === undefined || i.receivedAt >= opts.since;
  };
  return (items ?? []).filter((i) => !SIGNALS.has(i.kind) && after(i) && !(i.url && opts.delivered?.has(i.url)));
}

/** The job's line of what it is doing now (strut `job/status`, plans/live-feeds.md §4):
 *  the newest `status` update among `items`, which the store keeps newest last. Pure. */
export function liveStatus(items: readonly JobLiveItem[]): JobLiveItem | undefined {
  for (let n = items.length - 1; n >= 0; n--) if (items[n].kind === "status" && items[n].title) return items[n];
  return undefined;
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
