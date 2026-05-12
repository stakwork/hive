/**
 * Plan-mode org-context scout.
 *
 * Before dispatching a plan-mode workflow to Stakwork, we fire the
 * canvas/org agent (the same one that powers the org SidebarChat) as
 * a brief read-only scout: "look at the whole org's canvases, see if
 * any high-level organizational context matters for this user's plan
 * request, and report back." Whatever text it produces gets attached
 * to the Stakwork workflow as `vars.orgContext`, so the plan agent
 * running on the swarm has org-wide awareness (not just the feature's
 * workspace).
 *
 * Why a scout instead of pushing structured context:
 *   The org canvases are typed but exploring them productively (which
 *   initiatives matter? which notes? which research?) is fundamentally
 *   a judgement call. The org agent already has the tooling and prompt
 *   to do that exploration; rather than reinventing it as a heuristic
 *   here in Hive, we just ask it.
 *
 * Why a scout instead of giving the plan agent a callback into Hive:
 *   Keeps the org-data egress inside Hive's existing trust boundary —
 *   the swarm agent receives the *result text*, not credentials to
 *   query the org tree itself. Simpler auth story, no new endpoint
 *   surface for the swarm to call back into.
 *
 * Skip conditions (all return null silently — plan dispatch proceeds
 * without orgContext):
 *   - Feature flag `PLAN_MODE_ORG_CONTEXT_ENABLED` is not "true"
 *   - Not the first message of the plan (subsequent turns rely on the
 *     plan agent having captured what it needs in the first turn)
 *   - Workspace has no `sourceControlOrgId` (no org canvases exist)
 *   - No accessible sibling workspaces in the org
 *   - Scout call throws / times out (60s soft cap)
 *   - Scout emits the `NO_ORG_CONTEXT` sentinel or returns empty text
 *
 * The scout is best-effort: any failure path returns null. Plan-mode
 * dispatch is never blocked or aborted by this — it only adds context
 * when it can, and degrades gracefully otherwise.
 */

import { db } from "@/lib/db";
import { runCanvasAgent } from "@/lib/ai/runCanvasAgent";

/**
 * Sentinel the scout is asked to emit when it found nothing useful.
 * We accept either this exact token or empty/whitespace output as the
 * "no context" signal, since agents sometimes emit unsolicited filler.
 */
const NO_CONTEXT_SENTINEL = "NO_ORG_CONTEXT";

/**
 * Hard cap on workspaces passed to the scout. `runCanvasAgent`
 * enforces the same limit internally (askToolsMulti's contract); we
 * sort by recency before slicing so very large orgs still scout the
 * most-active workspaces.
 */
const MAX_WORKSPACES = 20;

/**
 * Soft timeout for the entire scout call (in ms). Exceeded → we
 * abandon the scout and proceed without orgContext. 60s gives the
 * agent room to do meaningful exploration (5-10 tool calls across
 * root + a couple of sub-canvases) while still capping the worst
 * case at one minute on the user-visible critical path.
 */
const SCOUT_TIMEOUT_MS = 60_000;

export interface ScoutOrgContextArgs {
  /** The workspace the plan is being created in. */
  workspaceId: string;
  /** The dispatching user. Scope of canvas visibility is their membership. */
  userId: string;
  /** The user's plan-request message — given to the scout verbatim for relevance judgement. */
  message: string;
  /**
   * Whether this is the first message of the plan-mode conversation.
   * Scout only runs on the first message; subsequent turns short-circuit.
   */
  isFirstMessage: boolean;
}

/**
 * Run the org-context scout. Returns the scout's text output to attach
 * as `vars.orgContext`, or `null` to skip attachment.
 */
export async function scoutOrgContext(
  args: ScoutOrgContextArgs,
): Promise<string | null> {
  // Unconditional entry breadcrumb. Always emitted so a missing log
  // line means the function was never called (caller opted out via
  // `skipOrgContextScout`, or the dispatch path didn't reach this
  // point at all). The flag + first-message states are surfaced so
  // we can tell at a glance which skip path is about to fire.
  console.log(
    `[orgContextScout] entered: workspaceId=${args.workspaceId} isFirstMessage=${args.isFirstMessage} flag=${process.env.PLAN_MODE_ORG_CONTEXT_ENABLED ?? "<unset>"}`,
  );

  // ── Skip conditions ──────────────────────────────────────────────
  if (process.env.PLAN_MODE_ORG_CONTEXT_ENABLED !== "true") {
    console.log("[orgContextScout] skip: PLAN_MODE_ORG_CONTEXT_ENABLED not 'true'");
    return null;
  }
  if (!args.isFirstMessage) {
    console.log("[orgContextScout] skip: not first message of plan");
    return null;
  }

  const startedAt = Date.now();

  // Resolve the org from the workspace. Workspaces without an
  // associated SourceControlOrg have no canvases — nothing to scout.
  const workspace = await db.workspace.findUnique({
    where: { id: args.workspaceId },
    select: { sourceControlOrgId: true },
  });
  const orgId = workspace?.sourceControlOrgId ?? null;
  if (!orgId) {
    console.log("[orgContextScout] skip: workspace has no sourceControlOrgId");
    return null;
  }

  // Resolve all sibling workspaces in the org that:
  //   (a) the dispatching user can access (owner or active member),
  //   (b) have a configured swarm with a swarmUrl,
  //   (c) have at least one repository.
  // These three conditions match `buildWorkspaceConfigs`'s acceptance
  // criteria; passing slugs that fail any of them would make
  // runCanvasAgent throw inside the tool-assembly path. Filtering at
  // the source keeps the scout robust against half-configured
  // workspaces.
  //
  // We sort by `updatedAt desc` and take up to MAX_WORKSPACES so very
  // large orgs scout the most-active workspaces first. Per
  // runCanvasAgent's contract this can't exceed 20.
  const candidates = await db.workspace.findMany({
    where: {
      sourceControlOrgId: orgId,
      deleted: false,
      OR: [
        { ownerId: args.userId },
        { members: { some: { userId: args.userId, leftAt: null } } },
      ],
      swarm: { swarmUrl: { not: null } },
      repositories: { some: {} },
    },
    select: { slug: true },
    orderBy: { updatedAt: "desc" },
    take: MAX_WORKSPACES,
  });
  const slugs = candidates.map((w) => w.slug);
  if (slugs.length === 0) {
    console.log(
      `[orgContextScout] skip: no accessible workspaces with swarm+repos in org ${orgId}`,
    );
    return null;
  }

  // ── Fire the scout ───────────────────────────────────────────────
  // Soft timeout via Promise.race. We can't cancel the underlying
  // streamText call (the AI SDK doesn't surface an AbortController on
  // the result handle here), but we can stop waiting on it — the
  // background Promise will resolve later and be garbage-collected.
  // Any in-flight tool calls (canvas reads, web_search) will complete
  // server-side and be discarded; that's fine for a read-only scout.
  //
  // The timer is cleared as soon as the scout resolves so we don't
  // hold the Node event loop open for the full timeout window after
  // a fast scout completes (matters in test runners and serverless).
  let text: string;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    const scoutPromise = runScout({ userId: args.userId, orgId, slugs, message: args.message });
    const timeoutPromise = new Promise<null>((resolve) => {
      timeoutHandle = setTimeout(() => resolve(null), SCOUT_TIMEOUT_MS);
    });
    const raced = await Promise.race([scoutPromise, timeoutPromise]);
    if (raced === null) {
      console.log(
        `[orgContextScout] skip: timed out after ${SCOUT_TIMEOUT_MS}ms (slugs=${slugs.length}, orgId=${orgId})`,
      );
      return null;
    }
    text = raced;
  } catch (error) {
    console.error("[orgContextScout] scout call failed:", error);
    return null;
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }

  // ── Parse the scout's reply ──────────────────────────────────────
  // The agent's system prompt teaches it to emit `[END_OF_ANSWER]` as
  // a stop marker. The AI SDK also configures it as a `stopSequence`,
  // so streamText cuts off at the marker — but we strip defensively
  // in case the prompt drift leaves it in the text.
  const cleaned = text
    .replace(/\[END_OF_ANSWER\]/g, "")
    .trim();

  // Accept either the explicit sentinel or any empty/whitespace
  // response as the "nothing useful" signal. Belt-and-suspenders
  // because agents sometimes ignore the sentinel and just emit
  // filler like "I didn't find anything relevant." We err on the
  // side of attaching when in doubt — the plan agent can ignore
  // marginal context, but it can't invent missing context.
  if (cleaned.length === 0) {
    console.log(
      `[orgContextScout] skip: scout returned empty text (${Date.now() - startedAt}ms, slugs=${slugs.length})`,
    );
    return null;
  }
  if (cleaned === NO_CONTEXT_SENTINEL) {
    console.log(
      `[orgContextScout] skip: scout emitted NO_ORG_CONTEXT sentinel (${Date.now() - startedAt}ms, slugs=${slugs.length})`,
    );
    return null;
  }

  console.log(
    `[orgContextScout] attached orgContext (${Date.now() - startedAt}ms, slugs=${slugs.length}, ${cleaned.length} chars): ${truncate(cleaned, 200)}`,
  );
  return cleaned;
}

/**
 * Inner scout invocation. Extracted from `scoutOrgContext` so the
 * timeout race in the caller has a single awaitable Promise to
 * compete with. Returns the scout's final text (post-stream
 * consumption).
 */
async function runScout(args: {
  userId: string;
  orgId: string;
  slugs: string[];
  message: string;
}): Promise<string> {
  const { userId, orgId, slugs, message } = args;

  const scoutPrompt = buildScoutPrompt(message);

  const { result } = await runCanvasAgent({
    userId,
    orgId,
    workspaceSlugs: slugs,
    // No scope hint — let the agent land on the org root canvas and
    // decide where to drill. The whole point of this scout is org-
    // wide visibility, not workspace-local.
    scope: undefined,
    // Strip every write tool. The scout MUST NOT mutate canvases,
    // research, connections, initiatives, or features. `readonly`
    // is enforced inside runCanvasAgent before streamText sees the
    // tool set, so this guarantee holds even if a future prompt
    // change tells the agent to write something.
    readonly: true,
    // Programmatic caller, no live UI subscriber — suppress the
    // HIGHLIGHT_NODES Pusher fan-out that the org chat surface
    // uses for "the agent is researching node X" animations.
    silentPusher: true,
    messages: [{ role: "user", content: scoutPrompt }],
  });

  // `.text` on the streamText result auto-consumes the stream and
  // resolves to the final step's text. We don't need the tool-call
  // trace or intermediate steps — the plan agent only consumes prose.
  return await result.text;
}

/**
 * Build the scout's user message. Kept intentionally short and high-
 * level — we trust the org agent's existing system prompt + canvas
 * tools to figure out what's relevant. The plan-request message is
 * embedded so the agent can judge relevance against it.
 */
function buildScoutPrompt(planRequestMessage: string): string {
  return [
    `A user in this organization is starting plan mode for a new feature. Their request:`,
    "",
    planRequestMessage.trim(),
    "",
    `Explore the root canvas and the workspace sub-canvases to get a high-level view of the org as a whole. Surface anything relevant to their plan request — be quick. If nothing in the org context seems relevant, reply with exactly: ${NO_CONTEXT_SENTINEL}`,
    "",
    `End your reply with [END_OF_ANSWER].`,
  ].join("\n");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "…";
}
