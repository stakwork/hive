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
 * ## Webhook fan-back safety net
 *
 * When a canvas conversation is active (`ctx.currentCanvasConversationId`),
 * the tool creates a `PENDING` `AgentRun` arbitration row and passes a
 * `webhookUrl` to the swarm so long runs (that outlive the Vercel lambda)
 * are delivered exactly once into the conversation via the callback path.
 *
 * Delivery state machine:
 *   - **Inline success**: claim PENDING → DELIVERED_INLINE, return content to the model.
 *   - **Inline race** (webhook claimed first): return a short "already posted" note.
 *   - **Initiation failure** (repoAgent throws before a request_id): claim PENDING → FAILED
 *     immediately (no callback can ever arrive — avoids orphaned PENDING rows).
 *   - **User cancellation / abort** (REPO_AGENT_CANCELLED_MARKER): claim PENDING → FAILED
 *     so a late "completed despite abort" webhook no-ops the claim.
 *   - **Poll timeout after genuine start** (has request_id): leave PENDING; tell the model
 *     the run is still running and its result will post to the conversation when done.
 *   - **No ctx / no conversation**: behave exactly as before — no row, no webhookUrl.
 *
 * NEVER log the raw token or full webhookUrl. Log only runId and status.
 */

import { tool, type ToolSet } from "ai";
import { z } from "zod";
import crypto from "crypto";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { config } from "@/config/env";
import { repoAgent } from "./askTools";
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
 * Attempt to atomically claim a `PENDING` AgentRun row to `newStatus`.
 * Returns `true` when this caller won the claim, `false` when the row was
 * already claimed (exactly-once: the other path already won).
 */
async function claimAgentRun(
  runId: string,
  newStatus: "DELIVERED_INLINE" | "FAILED",
  error?: string,
): Promise<boolean> {
  const { count } = await db.agentRun.updateMany({
    where: { id: runId, status: "PENDING" },
    data: {
      status: newStatus,
      ...(error ? { error } : {}),
    },
  });
  return count > 0;
}

/**
 * Set up the webhook fan-back arbitration row.
 *
 * Returns the row id, the raw token (to pass to the swarm), and the
 * webhookUrl (with only the run id in the query string — the token is a
 * separate body field). Returns `null` when the safety net should not be
 * activated (no conversation / no public base URL).
 *
 * NEVER log rawToken or the full webhookUrl.
 */
async function setupFanBack(
  ctx: CapabilityContext,
  title: string,
): Promise<{ runId: string; rawToken: string; webhookUrl: string } | null> {
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

  // High-entropy token — stored hashed, sent raw in the swarm callback header.
  // NEVER log rawToken or the full webhookUrl.
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

  // The webhookUrl carries only the run id in the query string.
  // The raw token travels as a separate body field so the swarm can relay
  // it in the x-agent-run-token header on the callback POST — it never
  // appears in the URL and is never captured in proxy/access logs.
  const webhookUrl = `${ctx.publicBaseUrl}/api/agent-runs/webhook?id=${agentRun.id}`;
  console.log("[workflow_explorer_agent] fan-back row created", { runId: agentRun.id });

  return { runId: agentRun.id, rawToken, webhookUrl };
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
        "Heavy/slow (minutes): call it ONCE with a complete, self-contained prompt rather than several times.",
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
        // public base URL. When absent, the tool behaves exactly as before.
        const title = prompt.slice(0, 120) + (prompt.length > 120 ? "…" : "");
        const fanBack = ctx ? await setupFanBack(ctx, title).catch((e) => {
          // Non-fatal: if row creation fails, degrade gracefully (no safety net
          // for this run, but the inline path still works).
          console.error("[workflow_explorer_agent] fan-back setup failed (non-fatal)", {
            error: e instanceof Error ? e.message : String(e),
          });
          return null;
        }) : null;

        // Tracks whether the swarm returned a request_id (= run started).
        // Affects the poll-timeout handling: a timeout *before* a request_id
        // means initiation failed; *after* means the run is still in progress.
        let hasRequestId = false;

        try {
          const { swarmUrl, swarmApiKey } = await resolveWorkflowLibrarySwarm();

          if (run_step) {
            console.log("[workflow_explorer_agent] step execution enabled for this call");
          }

          const rr = await repoAgent(
            swarmUrl,
            swarmApiKey,
            {
              prompt,
              mode: "workflow",
              stakworkApiKey: config.STAKWORK_API_KEY || undefined,
              ...(run_step ? { toolsConfig: { stakwork_run_step: true } } : {}),
              // Fan-back fields — only sent when the safety net is active.
              // webhookUrl: run id in query, token separate so it never appears in logs.
              // webhookToken: relayed by the swarm in x-agent-run-token on the callback POST.
              ...(fanBack
                ? {
                    webhookUrl: fanBack.webhookUrl,
                    // The swarm must relay this value in `x-agent-run-token` on the callback.
                    // Naming it `webhookToken` matches the agreed swarm contract; it never
                    // appears in the URL and is only transmitted server-to-server.
                    webhookToken: fanBack.rawToken,
                  }
                : {}),
            },
            /* bifrost */ undefined,
            /* hooks */ fanBack
              ? {
                  onRequestId: async (requestId: string) => {
                    hasRequestId = true;
                    console.log("[workflow_explorer_agent] run started", {
                      runId: fanBack.runId,
                      requestId,
                    });
                    // Save requestId for observability / log-correlation.
                    // NOT part of the arbitration key — a secondary best-effort write.
                    await db.agentRun.update({
                      where: { id: fanBack.runId },
                      data: { requestId },
                    }).catch((e) =>
                      console.warn("[workflow_explorer_agent] requestId save failed (non-fatal)", {
                        runId: fanBack.runId,
                        error: e instanceof Error ? e.message : String(e),
                      }),
                    );
                  },
                }
              : undefined,
          );

          // ── User cancellation ──────────────────────────────────────────
          // `repoAgent` returns the REPO_AGENT_CANCELLED_MARKER string when the
          // user hit Stop. Claim PENDING → FAILED so a late "completed despite
          // abort" webhook finds zero PENDING rows and no-ops — satisfying the
          // "aborts read as failures" requirement.
          if (typeof rr === "string") {
            if (fanBack) {
              const claimed = await claimAgentRun(fanBack.runId, "FAILED", "user_cancelled");
              console.log("[workflow_explorer_agent] cancelled — row FAILED", {
                runId: fanBack.runId,
                claimed,
              });
            }
            return "Workflow explorer agent was cancelled";
          }

          // ── Inline success ─────────────────────────────────────────────
          const content = (rr as Record<string, string>).content;

          if (fanBack) {
            // Claim PENDING → DELIVERED_INLINE.
            //
            // ORDERING: we claim BEFORE returning the content to the model.
            // If the lambda crashes between this claim and the model seeing the
            // content, the webhook will no-op (row no longer PENDING) and that
            // single result is lost. This is the same failure mode as any inline
            // tool result today (short-run behavior is unchanged — req #1). The
            // alternative (claim after) risks double-delivery if the webhook
            // beats us to the fan-out. Accept the crash-loss; eliminate it only
            // with a distributed transaction (out of scope).
            const claimed = await claimAgentRun(fanBack.runId, "DELIVERED_INLINE");
            console.log("[workflow_explorer_agent] inline result", {
              runId: fanBack.runId,
              claimed,
            });
            if (!claimed) {
              // The webhook already claimed and fanned out — exactly-once: no-op.
              return "The workflow explorer result has already been posted to this conversation.";
            }
          }

          return content;
        } catch (e) {
          console.error("Error executing workflow explorer agent:", e);

          if (fanBack) {
            if (!hasRequestId) {
              // ── Initiation failure ────────────────────────────────────
              // repoAgent threw before the swarm returned a request_id, so no
              // callback can ever arrive. Claim PENDING → FAILED immediately to
              // avoid an orphaned-forever PENDING row (closing the window the raw
              // draft left open).
              const claimed = await claimAgentRun(
                fanBack.runId,
                "FAILED",
                e instanceof Error ? e.message : "initiation_failed",
              );
              console.log("[workflow_explorer_agent] initiation failure — row FAILED", {
                runId: fanBack.runId,
                claimed,
              });
              return "Could not execute workflow explorer agent";
            } else {
              // ── Poll timeout after genuine start ──────────────────────
              // The swarm accepted the run (request_id was received) but it
              // outlived the inline poll budget. The row stays PENDING — the
              // swarm will call back via the webhook when done. Tell the model
              // the run is still in progress so the user knows to wait and a
              // later successful webhook doesn't contradict what they were told.
              // NEVER say "could not execute" here — the run IS running.
              //
              // RESIDUAL GAP: if the swarm process dies mid-run, this row stays
              // PENDING forever. A stale-row sweep is deferred to a follow-up
              // (at which point @@index([status, createdAt]) should be added).
              console.log("[workflow_explorer_agent] poll timeout — run in progress (PENDING)", {
                runId: fanBack.runId,
              });
              return (
                "The workflow explorer is still running — it will post its result to this " +
                "conversation when it finishes. No further action is needed from you."
              );
            }
          }

          return "Could not execute workflow explorer agent";
        }
      },
    }),
  };
}
