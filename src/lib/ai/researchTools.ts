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
 * One web_search result captured from Anthropic's `webSearch` provider
 * tool. We only care about `url` for citation linkification; `title`
 * is kept around in case we ever want to render link previews.
 */
export interface CapturedSearchResult {
  url: string;
  title?: string;
}

/**
 * Build research tools for the canvas-chat agent. Always merged when
 * `orgId` is supplied to `/api/ask/quick`; the prompt suffix teaches
 * the agent when to reach for them (external/web research, vs
 * connection docs which are integration-focused).
 *
 * `webSearchResults` is a closure-shared array that the route
 * populates inside `streamText`'s `onStepFinish` callback as
 * `web_search` calls return. By the time the agent reaches
 * `update_research`, every search result it can cite is in this
 * array \u2014 in the SAME ORDER Anthropic emitted them, which is
 * exactly the order the `<cite index="N-M">` indices reference.
 *
 * Why a closure-shared array instead of plumbing through tool input:
 * Anthropic's `<cite>` indices reference a flat list of ALL search
 * results from ALL `web_search` calls in the turn, in stream order.
 * The agent doesn't reliably know how to align its `sources` array
 * with those indices (we tried; it sent only the URLs it cited from,
 * which broke the index alignment). Capturing on the server side is
 * deterministic.
 */
export function buildResearchTools(
  orgId: string,
  userId: string,
  webSearchResults: CapturedSearchResult[],
): ToolSet {
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

    list_research: tool({
      description:
        "List all Research documents in this org, most recently updated " +
        "first. Returns a compact array of `{ slug, topic, title, " +
        "summary, status, initiativeId, updatedAt }` — `status` is " +
        "`\"ready\"` when the markdown writeup has landed, " +
        "`\"researching\"` while it's still null. Use this when the user " +
        "asks what research already exists, or when you want to check " +
        "for a prior writeup before kicking off a new one. Pair with " +
        "`read_research` to pull the full markdown body for a specific " +
        "slug.",
      inputSchema: z.object({
        initiativeId: z
          .string()
          .optional()
          .describe(
            "Optional cuid filter. When set, returns only research " +
              "scoped to that initiative's sub-canvas. Omit for all " +
              "research in the org (root + every initiative).",
          ),
      }),
      execute: async ({ initiativeId }: { initiativeId?: string }) => {
        try {
          const rows = await db.research.findMany({
            where: { orgId, ...(initiativeId && { initiativeId }) },
            orderBy: { updatedAt: "desc" },
            select: {
              slug: true,
              topic: true,
              title: true,
              summary: true,
              content: true,
              initiativeId: true,
              updatedAt: true,
            },
          });
          return rows.map((r) => ({
            slug: r.slug,
            topic: r.topic,
            title: r.title,
            summary: r.summary,
            // Same status derivation as the projector + node-detail
            // route — keep these in sync if the rule changes.
            status: r.content !== null ? "ready" : "researching",
            initiativeId: r.initiativeId,
            updatedAt: r.updatedAt,
          }));
        } catch (e) {
          console.error("[researchTools] list_research failed:", e);
          return { error: "Failed to list research." };
        }
      },
    }),

    read_research: tool({
      description:
        "Read a Research document's full markdown body by slug. Returns " +
        "`{ slug, topic, title, summary, content, status, initiativeId, " +
        "updatedAt }`. Use this when the user asks about a specific " +
        "existing research doc, when you need to extend or reference " +
        "prior research in a Connection writeup, or when deciding " +
        "whether a follow-up `update_research` should rewrite vs. " +
        "augment. Note: `update_research` is full-replace today — if " +
        "you want to extend, read first, then send the combined " +
        "markdown back. Returns `{ error }` if no research exists at " +
        "this slug; status is `\"researching\"` while content is still " +
        "null (the agent hasn't finished writing yet).",
      inputSchema: z.object({
        slug: z.string().min(1).describe("The slug of the research to read."),
      }),
      execute: async ({ slug }: { slug: string }) => {
        try {
          const row = await db.research.findUnique({
            where: { orgId_slug: { orgId, slug } },
            select: {
              slug: true,
              topic: true,
              title: true,
              summary: true,
              content: true,
              initiativeId: true,
              createdAt: true,
              updatedAt: true,
            },
          });
          if (!row) {
            return {
              error: `No research found with slug "${slug}". Use list_research to see available slugs.`,
            };
          }
          return {
            slug: row.slug,
            topic: row.topic,
            title: row.title,
            summary: row.summary,
            content: row.content,
            status: row.content !== null ? "ready" : "researching",
            initiativeId: row.initiativeId,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          };
        } catch (e) {
          console.error("[researchTools] read_research failed:", e);
          return { error: "Failed to read research." };
        }
      },
    }),

    update_research: tool({
      description:
        "Update an existing Research document with the markdown writeup. Call this ONCE after web_search has gathered enough information to write the doc. The `content` field replaces the previous content (no streaming/append semantics today \u2014 write the full markdown in one call).\n\n" +
        "Cite sources inline as you naturally would (e.g. `<cite index=\"N-M\">...</cite>` for Anthropic web_search citations); the tool will convert them into clickable markdown links automatically using the search results from the current conversation turn. You don't need to pass URLs separately.",
      inputSchema: z.object({
        slug: z.string().describe("The slug returned from save_research."),
        content: z
          .string()
          .min(1)
          .describe(
            "Full markdown writeup. Cite sources inline however you normally would; the tool linkifies them server-side using the captured web_search results.",
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

          // Citation linkification. Anthropic's web_search emits
          // `<cite index="N-M">anchor</cite>` where `N` is 1-indexed
          // into the flat list of ALL search results from EVERY
          // web_search call in this turn (in stream order). The
          // route's `onStepFinish` populates `webSearchResults` as
          // those calls return, so by the time we run here the array
          // is the exact reference list those indices point into.
          //
          // Out-of-range indices (or empty results) collapse to the
          // anchor text. The doc stays readable; that span just isn't
          // a link. Same fallback for any future tag shape we don't
          // recognize \u2014 we never want to leave raw `<cite>` markup
          // in the persisted markdown, since the viewer renders
          // standard GFM and would show it as literal text.
          const citationMatches = content.match(/<cite index="\d+/g) ?? [];
          let convertedCount = 0;
          let skippedCount = 0;
          const linkifiedContent = content.replace(
            /<cite index="(\d+)(?:-\d+(?:,\d+-\d+)*)?">(.*?)<\/cite>/g,
            (_match, indexStr: string, anchor: string) => {
              if (webSearchResults.length === 0) {
                skippedCount++;
                return anchor;
              }
              const idx = parseInt(indexStr, 10) - 1;
              const r = webSearchResults[idx];
              if (!r || typeof r.url !== "string") {
                skippedCount++;
                return anchor;
              }
              convertedCount++;
              // Anchor text is model-generated and could contain `]`
              // characters that would break markdown link parsing.
              // Cheap escape: replace any `]` in the anchor with `\]`.
              const safeAnchor = anchor.replace(/\]/g, "\\]");
              return `[${safeAnchor}](${r.url})`;
            },
          );

          console.log(
            `[researchTools] update_research citation conversion: slug=${slug} citations=${citationMatches.length} converted=${convertedCount} skipped=${skippedCount} availableSources=${webSearchResults.length}`,
          );
          if (skippedCount > 0 && webSearchResults.length > 0) {
            // Log the first few out-of-range indices to help debug.
            const indices = (content.match(/<cite index="(\d+)/g) ?? [])
              .slice(0, 10)
              .map((s) => s.match(/\d+/)?.[0])
              .filter(Boolean);
            console.log(
              `[researchTools] sample citation indices encountered: [${indices.join(", ")}], available range: 1..${webSearchResults.length}`,
            );
          }

          await db.research.update({
            where: { orgId_slug: { orgId, slug } },
            data: { content: linkifiedContent },
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
