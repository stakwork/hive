/**
 * `workflow_explorer_agent` — a read-only research sub-agent over the
 * Stakwork workflow library.
 *
 * Unlike the per-workspace `repo_agent` tool (built in `askTools` from the
 * acting workspace's swarm), this tool ALWAYS targets the hardcoded
 * `stakwork` workspace's swarm — that swarm's Jarvis knowledge graph holds
 * the canonical library of Stakwork Workflows, Skills, and Scripts. It
 * invokes the swarm's `/repo/agent` endpoint with `mode: "workflow"`, a
 * persona specialized for researching those node types (IO-schema semantic
 * search, reading workflow recipes) so the canvas agent can ground new
 * workflow designs in proven, reusable building blocks.
 *
 * Composed via the `workflows` capability, which is org-gated to the
 * Stakwork source-control org (see `capabilities.ts`) — other orgs' agents
 * never see this tool.
 *
 * ## Webhook delivery (canvas conversations)
 *
 * When a canvas conversation is active (`ctx.currentCanvasConversationId` +
 * `ctx.publicBaseUrl`), the tool is DISPATCH-ONLY: it creates a `PENDING`
 * `AgentRun` row, initiates the run with a `webhookUrl`, and returns
 * immediately. The swarm's terminal webhook is the sole delivery path — the
 * result is fanned into the conversation by `/api/agent-runs/webhook` when
 * the run finishes. No poll loop, no inline-vs-webhook race, and the lambda
 * is never pinned for the life of a long run.
 *
 * Delivery state machine:
 *   - **Dispatch success**: row stays PENDING; the webhook later claims it to
 *     DELIVERED_WEBHOOK (result posted) or FAILED (failure note posted).
 *   - **Initiation failure** (dispatch throws — no request_id): claim PENDING → FAILED
 *     immediately (no callback can ever arrive — avoids orphaned PENDING rows).
 *   - **No ctx / no conversation / no publicBaseUrl**: no delivery target exists, so
 *     the tool falls back to the classic inline poll path — no row, no webhookUrl,
 *     result returned to the model in-turn.
 *
 * RESIDUAL GAP: if the swarm process dies mid-run (webhook never fires and
 * retries exhaust), the row stays PENDING forever. A stale-row sweep that
 * re-polls /progress with the saved requestId is deferred to a follow-up
 * (add @@index([status, createdAt]) alongside it).
 *
 * NEVER log the raw token or full webhookUrl. Log only runId and status.
 */

import { tool, type ToolSet } from "ai";
import { z } from "zod";
import crypto from "crypto";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { config } from "@/config/env";
import { repoAgent, dispatchRepoAgent } from "./askTools";
import type { CapabilityContext } from "./capabilities";
import { resolveOrgConversationRowId } from "@/services/org-canvas-conversation";

/** The workspace whose swarm hosts the Jarvis workflow-library graph. */
const WORKFLOW_LIBRARY_WORKSPACE_SLUG = "stakwork";

/**
 * Resolve the workflow-library workspace's swarm credentials by slug.
 * Deliberately skips per-user membership validation — the tool is a
 * fixed backend shared by every caller the `workflows` capability gate
 * admits, not a per-user workspace surface. Mirrors the URL/decrypt
 * conventions of `buildWorkspaceConfigs`.
 */
async function resolveWorkflowLibrarySwarm(): Promise<{
  swarmUrl: string;
  swarmApiKey: string;
}> {
  const workspace = await db.workspace.findFirst({
    where: { slug: WORKFLOW_LIBRARY_WORKSPACE_SLUG, deleted: false },
    select: { id: true },
  });
  if (!workspace) {
    throw new Error(
      `Workflow library workspace not found: ${WORKFLOW_LIBRARY_WORKSPACE_SLUG}`,
    );
  }

  const swarm = await db.swarm.findFirst({
    where: { workspaceId: workspace.id },
  });
  if (!swarm?.swarmUrl) {
    throw new Error(
      `Swarm not configured for workspace: ${WORKFLOW_LIBRARY_WORKSPACE_SLUG}`,
    );
  }

  const swarmUrlObj = new URL(swarm.swarmUrl);
  let baseSwarmUrl = `https://${swarmUrlObj.hostname}:3355`;
  if (swarm.swarmUrl.includes("localhost")) {
    baseSwarmUrl = "http://localhost:3355";
  }

  return {
    swarmUrl: baseSwarmUrl,
    swarmApiKey: EncryptionService.getInstance().decryptField(
      "swarmApiKey",
      swarm.swarmApiKey || "",
    ),
  };
}

/** SHA-256 hex hash of a raw token. Used to derive and verify tokenHash. */
function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Atomically claim a `PENDING` AgentRun row to FAILED (initiation failure —
 * no webhook can ever arrive for it). Returns `true` when this caller won
 * the claim, `false` when the row was already claimed.
 */
async function markAgentRunFailed(runId: string, error: string): Promise<boolean> {
  const { count } = await db.agentRun.updateMany({
    where: { id: runId, status: "PENDING" },
    data: { status: "FAILED", error },
  });
  return count > 0;
}

/**
 * Set up the webhook fan-back arbitration row.
 *
 * Returns the row id and the webhookUrl to register with the swarm. The
 * bearer token rides in the URL's query string (`token=`) because
 * stakgraph's `postTerminalWebhook` POSTs the registered URL verbatim with
 * no custom headers — there is no other channel for it. The exposure is
 * blunted by the token being single-use (the atomic claim consumes it),
 * 256-bit random, and stored only as a SHA-256 hash. Returns `null` when
 * the safety net should not be activated (no conversation / no public
 * base URL).
 *
 * NEVER log the full webhookUrl — it contains the bearer token.
 */
async function setupFanBack(
  ctx: CapabilityContext,
  title: string,
): Promise<{ runId: string; webhookUrl: string } | null> {
  if (!ctx.currentCanvasConversationId || !ctx.userId || !ctx.orgId || !ctx.publicBaseUrl) {
    return null;
  }

  // IDOR guard: validate the caller owns this conversation before creating a row.
  const conversationId = await resolveOrgConversationRowId({
    conversationId: ctx.currentCanvasConversationId,
    userId: ctx.userId,
    orgId: ctx.orgId,
  });
  if (!conversationId) {
    console.warn("[workflow_explorer_agent] conversation not found or not owned — skipping fan-back", {
      conversationId: ctx.currentCanvasConversationId,
    });
    return null;
  }

  // High-entropy token — stored hashed, carried raw in the webhookUrl the
  // swarm POSTs back to. NEVER log rawToken or the full webhookUrl.
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);

  const agentRun = await db.agentRun.create({
    data: {
      tokenHash,
      conversationId,
      orgId: ctx.orgId,
      userId: ctx.userId,
      title,
    },
    select: { id: true },
  });

  // The webhookUrl carries both the run id and the raw bearer token —
  // stakgraph POSTs this URL verbatim with no custom headers, so the query
  // string is the only channel the token can travel in.
  const webhookUrl = `${ctx.publicBaseUrl}/api/agent-runs/webhook?id=${agentRun.id}&token=${rawToken}`;
  console.log("[workflow_explorer_agent] fan-back row created", { runId: agentRun.id });

  return { runId: agentRun.id, webhookUrl };
}

export function buildWorkflowExplorerTools(ctx?: CapabilityContext): ToolSet {
  return {
    workflow_explorer_agent: tool({
      description:
        "Dispatch a research agent over the Stakwork workflow library (the stakwork workspace's knowledge graph) to find existing Workflows, Skills, and Scripts relevant to a workflow being designed. " +
        "It searches components semantically by what they take as input and produce as output, reads full workflow recipes (step orderings + the skills each step uses), and reports proven, reusable building blocks with usage statistics — plus gaps where nothing exists yet. " +
        "It can also pull ground-truth run data from the Stakwork API: which workflows invoke a skill (with real use counts), recent runs and their success/error states, and the actual params and outputs each step sent — useful for citing working configurations (exact URL formats, variable interpolations) or diagnosing why a similar workflow failed. " +
        "Use it when designing or discussing a NEW Stakwork workflow: e.g. 'what existing skills take a video url as input?', 'is there already a transcription workflow, and how does it compose its steps?', 'show me real params from a successful run that uses AzureOCR'. " +
        "READ-ONLY by default — it cannot create or modify workflows. Pass run_step: true (ONLY when the user explicitly asks to run/execute/test a specific step) to additionally let it execute one workflow step with supplied inputs and report the output. " +
        "Heavy/slow (minutes): call it ONCE with a complete, self-contained prompt rather than several times. " +
        "In a canvas conversation this tool runs in the BACKGROUND: it returns immediately with a dispatch confirmation (no findings), and the explorer's full report is posted directly into the conversation when it finishes. Tell the user it's underway — do NOT re-call the tool to fetch results and do NOT invent findings.",
      inputSchema: z.object({
        prompt: z
          .string()
          .describe(
            "Self-contained research task for the workflow explorer. State the goal of the workflow being designed, the input/output shapes if known (e.g. 'takes a video url, produces a transcript with timestamps'), and ask for reusable building blocks and gaps. " +
              "When run_step is true, also name the workflow (id if known) and step id, give the input values the user supplied (or tell it to discover required inputs and use stated test values / mock_mode), and ask for the step's resolved inputs and outputs.",
          ),
        run_step: z
          .boolean()
          .optional()
          .describe(
            "Enable single-step EXECUTION (stakwork_run_step) on the explorer for this call. " +
              "Set true ONLY when the user has explicitly asked to run/execute/test a workflow step — never for ordinary research. " +
              "Executions are real and billable.",
          ),
      }),
      execute: async ({ prompt, run_step }: { prompt: string; run_step?: boolean }) => {
        // ── Webhook fan-back setup ────────────────────────────────────────
        // Only activated when a canvas conversation is present and we have a
        // public base URL. When absent, the tool falls back to the classic
        // inline poll path (there is no delivery target for a webhook).
        const title = prompt.slice(0, 120) + (prompt.length > 120 ? "…" : "");
        const fanBack = ctx ? await setupFanBack(ctx, title).catch((e) => {
          // Non-fatal: if row creation fails, degrade gracefully to the
          // inline poll path for this run.
          console.error("[workflow_explorer_agent] fan-back setup failed (non-fatal)", {
            error: e instanceof Error ? e.message : String(e),
          });
          return null;
        }) : null;

        try {
          const { swarmUrl, swarmApiKey } = await resolveWorkflowLibrarySwarm();

          if (run_step) {
            console.log("[workflow_explorer_agent] step execution enabled for this call");
          }

          const baseParams = {
            prompt,
            mode: "workflow" as const,
            stakworkApiKey: config.STAKWORK_API_KEY || undefined,
            ...(run_step ? { toolsConfig: { stakwork_run_step: true } } : {}),
          };

          if (fanBack) {
            // ── Dispatch-only: the webhook is the sole delivery path ─────
            // Initiate the run and return immediately — no poll loop. The
            // swarm POSTs the terminal payload to webhookUrl (id + bearer
            // token in its query string) and /api/agent-runs/webhook fans
            // the result into the conversation.
            const requestId = await dispatchRepoAgent(swarmUrl, swarmApiKey, {
              ...baseParams,
              webhookUrl: fanBack.webhookUrl,
            });
            console.log("[workflow_explorer_agent] dispatched", {
              runId: fanBack.runId,
              requestId,
            });
            // Save requestId for observability and the future stale-row
            // sweep. NOT part of the arbitration key — best-effort write.
            await db.agentRun.update({
              where: { id: fanBack.runId },
              data: { requestId },
            }).catch((e) =>
              console.warn("[workflow_explorer_agent] requestId save failed (non-fatal)", {
                runId: fanBack.runId,
                error: e instanceof Error ? e.message : String(e),
              }),
            );
            return (
              "The workflow explorer is researching in the background — its findings will be " +
              "posted directly to this conversation when ready (typically within a few minutes). " +
              "Let the user know it's underway; do not call this tool again for the same request."
            );
          }

          // ── Inline poll path (no canvas delivery target) ───────────────
          const rr = await repoAgent(swarmUrl, swarmApiKey, baseParams);
          if (typeof rr === "string") return "Workflow explorer agent was cancelled";
          return (rr as Record<string, string>).content;
        } catch (e) {
          console.error("Error executing workflow explorer agent:", e);

          if (fanBack) {
            // ── Initiation failure ────────────────────────────────────────
            // Dispatch threw, so the swarm never accepted the run and no
            // callback can ever arrive. Claim PENDING → FAILED immediately
            // to avoid an orphaned-forever PENDING row.
            const claimed = await markAgentRunFailed(
              fanBack.runId,
              e instanceof Error ? e.message : "initiation_failed",
            );
            console.log("[workflow_explorer_agent] initiation failure — row FAILED", {
              runId: fanBack.runId,
              claimed,
            });
          }

          return "Could not execute workflow explorer agent";
        }
      },
    }),
  };
}
