/**
 * Research tools — agent surface for the canvas Research feature.
 *
 * Two tools, modeled directly on `connectionTools.ts`:
 *
 *   1. `save_research`   — creates the row immediately so the Research
 *                          node appears on the canvas right away.
 *                          Required: slug, topic, title, summary.
 *                          Optional: initiativeId (when on an
 *                          initiative sub-canvas).
 *   2. `update_research` — fills `content` (markdown) once the agent
 *                          has done its `web_search` calls and
 *                          synthesized a writeup. Single field today;
 *                          extend if we ever want to stream sections
 *                          like Connection's diagram/architecture/spec.
 *
 * Why two tools instead of one:
 *
 *   The on-canvas UX requires the node to **appear immediately** when
 *   the agent decides to research something \u2014 long before the
 *   markdown is ready. Splitting create from update is what makes that
 *   possible: `save_research` lands a row in seconds (just topic +
 *   title + summary), the projector emits the live node within one
 *   Pusher round-trip, and the user watches the spinner badge while
 *   `web_search` runs and `update_research` eventually fills `content`.
 *
 * Wiring:
 *
 *   - Spread into the `/api/ask/quick` toolset alongside
 *     `buildConnectionTools` / `buildCanvasTools` /
 *     `buildInitiativeTools` whenever `orgId` is supplied.
 *   - Pusher fan-out: every call fires `CANVAS_UPDATED` on the affected
 *     scope (root if `initiativeId` is null; `initiative:<id>` if set)
 *     so the canvas refetches and re-projects. `save_research` also
 *     fires `RESEARCH_UPDATED` so an open viewer (right panel) can
 *     prepare its skeleton; `update_research` fires
 *     `RESEARCH_UPDATED` so the viewer streams the markdown in.
 *
 * The chat is the single source of truth for research lifecycle \u2014
 * every save/update lands as a tool call on a `CanvasChatMessage`, so
 * the conversation transcript captures what was researched, when, and
 * why. The DB row is the materialized result; the chat is the audit
 * log.
 */
import { tool, ToolSet } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { getOrgChannelName, PUSHER_EVENTS, pusherServer } from "@/lib/pusher";
import { notifyCanvasUpdated } from "@/lib/canvas";

/**
 * Fire the right-panel viewer event so an open viewer can hydrate
 * (`save_research`) or stream content in (`update_research`). Separate
 * from the canvas refetch event because the viewer doesn't need to
 * re-project the whole canvas to render a markdown change.
 */
async function notifyResearchEvent(
  orgId: string,
  slug: string,
  action: "created" | "updated",
  fields?: string[],
): Promise<void> {
  try {
    const org = await db.sourceControlOrg.findUnique({
      where: { id: orgId },
      select: { githubLogin: true },
    });
    if (!org) return;
    await pusherServer.trigger(
      getOrgChannelName(org.githubLogin),
      PUSHER_EVENTS.RESEARCH_UPDATED,
      {
        slug,
        action,
        ...(fields ? { fields } : {}),
        timestamp: Date.now(),
      },
    );
  } catch (e) {
    console.error("[researchTools] failed to send research update:", e);
  }
}

/**
 * Build research tools for the canvas-chat agent. Always merged when
 * `orgId` is supplied to `/api/ask/quick`; the prompt suffix teaches
 * the agent when to reach for them (external/web research, vs
 * connection docs which are integration-focused).
 */
export function buildResearchTools(orgId: string, userId: string): ToolSet {
  return {
    save_research: tool({
      description:
        "Create a new Research document. Call this IMMEDIATELY when starting external/web research \u2014 the moment you know the topic, before any web_search calls. The on-canvas Research node appears as soon as this returns; the user sees their research kicking off live. Returns { slug, id } \u2014 use the slug for the subsequent update_research call.\n\n" +
        "Required fields:\n" +
        "  - slug: short kebab-case identifier (e.g. 'stripe-connect-payouts', 'sse-vs-websockets').\n" +
        "  - topic: the user's original wording of the research request, verbatim if available. Used as the on-canvas card label \u2014 keeping it as the user wrote it makes the authored\u2192live swap visually seamless when the user kicked off via the `+ Research` menu. If you initiated the research yourself, write a short topic that reads like the user might have asked for it.\n" +
        "  - title: a polished, slightly more formal title (e.g. 'Stripe Connect: multi-party payout flows'). Used as the right-panel viewer header.\n" +
        "  - summary: one sentence describing what this research will cover. Shown above the markdown body in the viewer while content is still being written.\n\n" +
        "Optional:\n" +
        "  - initiativeId: cuid of the initiative this research belongs to. Pass it when the user is currently looking at an initiative sub-canvas (the canvas-scope hint will tell you `currentCanvasRef: \"initiative:<id>\"`). Omit for org-wide research that should land on the root canvas.",
      inputSchema: z.object({
        slug: z
          .string()
          .min(1)
          .describe("Short kebab-case identifier, unique within the org."),
        topic: z
          .string()
          .min(1)
          .describe(
            "The user's original wording of the research request, used as the on-canvas card label.",
          ),
        title: z
          .string()
          .min(1)
          .describe(
            "A polished title for the right-panel viewer header.",
          ),
        summary: z
          .string()
          .min(1)
          .describe(
            "One-sentence overview of what the research will cover.",
          ),
        initiativeId: z
          .string()
          .optional()
          .describe(
            "Cuid of the initiative this research belongs to. Omit for org-wide research on the root canvas.",
          ),
      }),
      execute: async ({
        slug,
        topic,
        title,
        summary,
        initiativeId,
      }: {
        slug: string;
        topic: string;
        title: string;
        summary: string;
        initiativeId?: string;
      }) => {
        try {
          // If `initiativeId` is supplied, validate it belongs to this
          // org \u2014 don't trust the model with cross-org references.
          // A bad id collapses to root scope (initiativeId = null)
          // rather than failing outright; we'd rather show the research
          // on the root canvas than reject the agent's call.
          let resolvedInitiativeId: string | null = null;
          if (initiativeId) {
            const init = await db.initiative.findFirst({
              where: { id: initiativeId, orgId },
              select: { id: true },
            });
            if (init) resolvedInitiativeId = init.id;
          }

          const research = await db.research.create({
            data: {
              slug,
              topic,
              title,
              summary,
              orgId,
              initiativeId: resolvedInitiativeId,
              createdBy: userId,
            },
            select: { id: true, slug: true },
          });

          // Two fan-outs: the canvas refetches (so the new node
          // appears) AND the viewer hydrates. Different scope:
          // CANVAS_UPDATED targets a specific ref; RESEARCH_UPDATED
          // is org-wide.
          const ref = resolvedInitiativeId
            ? `initiative:${resolvedInitiativeId}`
            : "";
          await notifyCanvasUpdated(orgId, ref, "research-created", {
            slug: research.slug,
            researchId: research.id,
          });
          await notifyResearchEvent(orgId, research.slug, "created");

          return {
            slug: research.slug,
            id: research.id,
            status: "created",
          };
        } catch (e) {
          // Most likely cause: duplicate (orgId, slug). Mirror
          // connectionTools' posture \u2014 return a structured error
          // string instead of throwing so the model can retry with a
          // different slug.
          console.error("[researchTools] save_research failed:", e);
          return {
            error:
              "Failed to save research. The slug may already be in use; try a different one.",
          };
        }
      },
    }),

    update_research: tool({
      description:
        "Update an existing Research document with the markdown writeup. Call this ONCE after web_search has gathered enough information to write the doc. The `content` field replaces the previous content (no streaming/append semantics today \u2014 write the full markdown in one call).",
      inputSchema: z.object({
        slug: z.string().describe("The slug returned from save_research."),
        content: z
          .string()
          .min(1)
          .describe(
            "Full markdown writeup. Cite sources inline as the model normally would; the viewer renders standard GitHub-flavored markdown.",
          ),
      }),
      execute: async ({
        slug,
        content,
      }: {
        slug: string;
        content: string;
      }) => {
        try {
          // Look up first to find the (initiativeId, ref) we need to
          // notify on. Could collapse into one query, but updateMany
          // returns just a count; we want the row's location to fan
          // out the right canvas event.
          const row = await db.research.findUnique({
            where: { orgId_slug: { orgId, slug } },
            select: { id: true, initiativeId: true },
          });
          if (!row) {
            return {
              error: `No research found with slug "${slug}". Did you mean to call save_research first?`,
            };
          }

          await db.research.update({
            where: { orgId_slug: { orgId, slug } },
            data: { content },
          });

          const ref = row.initiativeId ? `initiative:${row.initiativeId}` : "";
          // CANVAS_UPDATED fires so the projector flips the card's
          // `customData.status` from "researching" to "ready" (the
          // projector derives status from `content !== null`). This
          // is what stops the spinner badge.
          await notifyCanvasUpdated(orgId, ref, "research-updated", {
            slug,
            researchId: row.id,
            fields: ["content"],
          });
          await notifyResearchEvent(orgId, slug, "updated", ["content"]);

          return { slug, status: "updated", fields: ["content"] };
        } catch (e) {
          console.error("[researchTools] update_research failed:", e);
          return { error: "Failed to update research." };
        }
      },
    }),
  };
}
