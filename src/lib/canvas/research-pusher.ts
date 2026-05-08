/**
 * Research Pusher fan-out — shared helpers so every code path that
 * mutates a `Research` row speaks the same wire shape.
 *
 * Lives next to `./pusher.ts` because research is one of the live-node
 * categories the canvas projects: any research mutation needs at least
 * one `CANVAS_UPDATED` fan-out, and the reassignment path piggybacks
 * on `notifyCanvasesUpdatedByLogin`. Keeping both modules siblings
 * makes that coupling explicit; outside callers reach for these via
 * the canvas barrel (`@/lib/canvas`).
 *
 * Three callers today:
 *
 *   - `src/lib/ai/researchTools.ts` (`save_research` / `update_research`):
 *     emit `created` / `updated` after the agent writes a row.
 *   - `src/app/api/orgs/[githubLogin]/research/route.ts` (DELETE):
 *     emit `deleted` after admin tears one down.
 *   - `src/app/api/orgs/[githubLogin]/research/[researchId]/route.ts`
 *     (PATCH initiativeId): emit `updated` and fan out CANVAS_UPDATED
 *     on both the source AND target canvas refs (root + initiative
 *     sub-canvas, or two initiative sub-canvases) so the row jumps
 *     canvases live.
 *
 * The two notify shapes are intentionally separate:
 *
 *   `RESEARCH_UPDATED`   — viewer-side. Wire = `{ slug, action,
 *                          fields?, timestamp }`. Subscribers are the
 *                          right-panel `<ResearchViewer>` instances.
 *   `CANVAS_UPDATED`     — canvas-side. Tells the projector to refetch
 *                          the affected ref. Routed through the shared
 *                          `notifyCanvasesUpdatedByLogin` helper.
 *
 * Errors are caught and logged so a Pusher hiccup never fails the
 * mutating request that triggered it.
 */
import { db } from "@/lib/db";
import { getOrgChannelName, PUSHER_EVENTS, pusherServer } from "@/lib/pusher";
import { notifyCanvasesUpdatedByLogin } from "./pusher";

export type ResearchEventAction = "created" | "updated" | "deleted";

/**
 * Fire `RESEARCH_UPDATED` on the org channel so the viewer can
 * hydrate (`created`), stream new content (`updated`), or render a
 * deleted state (`deleted`).
 */
export async function notifyResearchEventByLogin(
  githubLogin: string,
  slug: string,
  action: ResearchEventAction,
  fields?: string[],
): Promise<void> {
  try {
    await pusherServer.trigger(
      getOrgChannelName(githubLogin),
      PUSHER_EVENTS.RESEARCH_UPDATED,
      {
        slug,
        action,
        ...(fields ? { fields } : {}),
        timestamp: Date.now(),
      },
    );
  } catch (e) {
    console.error("[canvas/research-pusher] failed to send research update:", e);
  }
}

/**
 * Same as `notifyResearchEventByLogin` but resolves the org's
 * `githubLogin` from its `id` first. Used by the agent tools, which
 * only have `orgId` in scope.
 */
export async function notifyResearchEvent(
  orgId: string,
  slug: string,
  action: ResearchEventAction,
  fields?: string[],
): Promise<void> {
  try {
    const org = await db.sourceControlOrg.findUnique({
      where: { id: orgId },
      select: { githubLogin: true },
    });
    if (!org) return;
    await notifyResearchEventByLogin(org.githubLogin, slug, action, fields);
  } catch (e) {
    console.error("[canvas/research-pusher] notifyResearchEvent failed:", e);
  }
}

/**
 * Fan out CANVAS_UPDATED on every canvas affected by a research-row
 * reassignment. Mirrors `notifyFeatureReassignmentRefresh`'s posture:
 * resolve "before" + "after" refs (which canvas the row left, which
 * one it landed on) and emit on both with sensible de-duping.
 *
 * Research rows project on:
 *   - root canvas when `initiativeId IS NULL`
 *   - the initiative sub-canvas when `initiativeId` is set
 *
 * So a reassignment can be any of:
 *   - root → initiative   (refs: "", "initiative:<after>")
 *   - initiative → root   (refs: "initiative:<before>", "")
 *   - initiative → initiative (refs: "initiative:<before>", "initiative:<after>")
 *
 * Caller passes the `before` snapshot (taken before the DB write) and
 * the `after` value (post-write). Identical before/after collapses to
 * a single ref via the `notifyCanvasesUpdatedByLogin` de-dupe.
 */
export async function notifyResearchReassignmentRefresh(
  githubLogin: string,
  researchId: string,
  slug: string,
  before: { initiativeId: string | null },
  after: { initiativeId: string | null },
): Promise<void> {
  try {
    const refs: string[] = [];
    refs.push(before.initiativeId ? `initiative:${before.initiativeId}` : "");
    refs.push(after.initiativeId ? `initiative:${after.initiativeId}` : "");

    await notifyCanvasesUpdatedByLogin(githubLogin, refs, "research-reassigned", {
      researchId,
      slug,
    });
  } catch (e) {
    console.error(
      "[canvas/research-pusher] notifyResearchReassignmentRefresh failed:",
      e,
    );
  }
}
