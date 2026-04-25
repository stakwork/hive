/**
 * Canvas Pusher fan-out.
 *
 * Centralizes the `CANVAS_UPDATED` emission logic so every code path
 * that mutates canvas-relevant state (REST routes, agent tools, future
 * webhooks) speaks the same wire shape. Two callers today:
 *
 *   - `src/lib/ai/canvasTools.ts` — agent `update_canvas` / `patch_canvas`
 *     tools, which mutate the authored blob directly.
 *   - `src/app/api/orgs/[githubLogin]/initiatives/...` — REST routes
 *     for the DB-projected `Initiative` and `Milestone` models. Any
 *     mutation here changes what projectors emit; clients need to
 *     refetch the affected canvas to see the new projection.
 *
 * The wire format (event payload) is small and stable:
 *
 *   {
 *     ref: null | string,    // null = root canvas; string = sub-canvas ref
 *     action: string,        // human-readable: "created" / "patched" / etc
 *     ...detail,             // free-form caller-supplied fields
 *     timestamp: number,
 *   }
 *
 * Clients (`OrgCanvasBackground.tsx`) ignore unknown detail fields, so
 * additions here are non-breaking.
 */
import { db } from "@/lib/db";
import { getOrgChannelName, PUSHER_EVENTS, pusherServer } from "@/lib/pusher";
import { ROOT_REF } from "./scope";

/**
 * Delay before firing the Pusher trigger. On a brand-new page the
 * client lazily opens its Pusher WebSocket the first time
 * `getPusherClient()` runs, and `channel.subscribe()` resolves BEFORE
 * the server confirms the subscription. Events published during that
 * window are dropped silently (non-presence channels don't replay).
 * Giving the client a short head start makes first-canvas updates
 * reliably land live instead of only on refresh. 300ms is invisible
 * to users (any human action that triggers this just finished a
 * multi-hundred-ms round trip) but comfortably longer than the typical
 * Pusher handshake.
 */
const CANVAS_NOTIFY_DELAY_MS = 300;

/**
 * Emit `CANVAS_UPDATED` on the org channel. `ref` follows the same
 * empty-string-sentinel convention as `Canvas.ref`: `""` (or `ROOT_REF`)
 * addresses the root canvas and gets serialized to `null` on the wire;
 * any other string addresses a sub-canvas verbatim.
 *
 * Errors are caught and logged — never thrown. A failed Pusher trigger
 * shouldn't take down the mutating request that called it; the worst
 * case is open clients see stale state until they refresh.
 */
export async function notifyCanvasUpdatedByLogin(
  githubLogin: string,
  ref: string,
  action: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    const channelName = getOrgChannelName(githubLogin);
    await new Promise((r) => setTimeout(r, CANVAS_NOTIFY_DELAY_MS));
    await pusherServer.trigger(channelName, PUSHER_EVENTS.CANVAS_UPDATED, {
      ref: ref === ROOT_REF ? null : ref,
      action,
      ...(detail ?? {}),
      timestamp: Date.now(),
    });
    console.log(
      `[canvas/pusher] CANVAS_UPDATED → ${channelName} (${action}, ref=${ref || "root"})`,
      detail ?? {},
    );
  } catch (e) {
    console.error("[canvas/pusher] failed to send canvas update:", e);
  }
}

/**
 * Same as `notifyCanvasUpdatedByLogin` but resolves the org's
 * `githubLogin` from its `id` first. Used by callers (notably the
 * agent tools) that only have the orgId at hand.
 */
export async function notifyCanvasUpdated(
  orgId: string,
  ref: string,
  action: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    const org = await db.sourceControlOrg.findUnique({
      where: { id: orgId },
      select: { githubLogin: true },
    });
    if (!org) {
      console.warn(
        "[canvas/pusher] notifyCanvasUpdated: no SourceControlOrg for orgId",
        orgId,
      );
      return;
    }
    await notifyCanvasUpdatedByLogin(org.githubLogin, ref, action, detail);
  } catch (e) {
    console.error("[canvas/pusher] notifyCanvasUpdated failed:", e);
  }
}

/**
 * Convenience: emit `CANVAS_UPDATED` on multiple refs at once with a
 * single `action`. The `await` is sequential so the pusher delay
 * compounds — that's fine, we're already in a human-action path
 * where +300ms is invisible.
 *
 * Common pattern: a milestone change affects both the initiative
 * sub-canvas (the milestone moves/changes) AND the root canvas (the
 * parent initiative's progress rollup shifts). Pass both refs.
 */
export async function notifyCanvasesUpdatedByLogin(
  githubLogin: string,
  refs: string[],
  action: string,
  detail?: Record<string, unknown>,
): Promise<void> {
  // De-dupe so callers don't have to think about it.
  const unique = Array.from(new Set(refs));
  for (const ref of unique) {
    await notifyCanvasUpdatedByLogin(githubLogin, ref, action, detail);
  }
}
