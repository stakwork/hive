/**
 * Post-run report generation for legal benchmark runs.
 *
 * When an operator checks "Generate Report" in the task details modal, the
 * flag is stored in the runner StakworkRun's `result` JSON. After the final
 * result webhook merges the scores and marks the run COMPLETED, the webhook
 * handler calls `generateBenchmarkRunReport` (inside Next's `after()`), which:
 *   1. Atomically claims the report (`reportStatus: "generating"` in the
 *      result JSON) so duplicate webhook deliveries can't spawn two reports.
 *   2. Creates a fresh org-canvas `SharedConversation` seeded with the review
 *      prompt (same shape as `automation-dispatcher`).
 *   3. Runs `runCanvasAgent` and appends the assistant turn.
 *   4. Merges `reportConversationId` / `reportChatPath` back into the run's
 *      result JSON and broadcasts STAKWORK_RUN_UPDATE so the Runs table
 *      picks up the link.
 */

import { db } from "@/lib/db";
import { type ModelMessage } from "ai";
import { runCanvasAgent, type CachedConcepts } from "@/lib/ai/runCanvasAgent";
import {
  messagesFromSteps,
  appendTurnMessages,
  type StoredMessage,
} from "@/services/canvas-turn-persistence";
import { resolveOrgWorkspaceSlugs } from "@/services/automation-dispatcher";
import {
  pusherServer,
  getWorkspaceChannelName,
  PUSHER_EVENTS,
} from "@/lib/pusher";
import { logger } from "@/lib/logger";
import { parseBenchmarkRunResult, type BenchmarkRunResult } from "@/types/legal";

const LOG_SERVICE = "legal-benchmark-report";

function parseResultJson(result: string | null): Record<string, unknown> {
  if (!result) return {};
  try {
    return JSON.parse(result) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Read-merge-write a patch into the run's result JSON. The result column is a
 * JSON string, so concurrent writers (e.g. the EVAL annotation webhook) are
 * merged at read time rather than clobbered.
 */
async function mergeIntoRunResult(
  runId: string,
  patch: Partial<BenchmarkRunResult>,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const row = await tx.stakworkRun.findUnique({
      where: { id: runId },
      select: { result: true },
    });
    const json = parseResultJson(row?.result ?? null);
    await tx.stakworkRun.update({
      where: { id: runId },
      data: { result: JSON.stringify({ ...json, ...patch }) },
    });
  });
}

/**
 * Generate the operator-requested post-run report for a completed
 * LEGAL_BENCHMARK_RUNNER run. No-op when the flag is absent or a report was
 * already generated/claimed. Errors are recorded on the run
 * (`reportStatus: "failed"`) and rethrown to the caller's catch.
 */
export async function generateBenchmarkRunReport(runId: string): Promise<void> {
  const run = await db.stakworkRun.findUnique({
    where: { id: runId },
    include: {
      workspace: {
        select: {
          slug: true,
          ownerId: true,
          sourceControlOrgId: true,
          sourceControlOrg: { select: { githubLogin: true } },
        },
      },
    },
  });

  if (!run) {
    logger.error("[report] Run not found", LOG_SERVICE, { runId });
    return;
  }

  // ── Atomic claim — duplicate webhook deliveries bail here ────────────────
  const claimed = await db.$transaction(async (tx) => {
    const row = await tx.stakworkRun.findUnique({
      where: { id: runId },
      select: { result: true },
    });
    const json = parseResultJson(row?.result ?? null);
    if (json.generateReport !== true) return false;
    if (json.reportStatus || json.reportConversationId) return false;
    await tx.stakworkRun.update({
      where: { id: runId },
      data: {
        result: JSON.stringify({ ...json, reportStatus: "generating" }),
      },
    });
    return true;
  });

  if (!claimed) {
    logger.info(
      "[report] Skipping — report not requested or already claimed",
      LOG_SERVICE,
      { runId },
    );
    return;
  }

  try {
    const parsed: Partial<BenchmarkRunResult> = parseBenchmarkRunResult(run.result) ?? {};
    const orgId = run.workspace.sourceControlOrgId;
    const githubLogin = run.workspace.sourceControlOrg?.githubLogin;
    const userId = run.userId ?? run.workspace.ownerId;

    if (!orgId || !githubLogin) {
      throw new Error(
        `Workspace ${run.workspace.slug} has no linked SourceControlOrg — cannot create an org-canvas report`,
      );
    }
    if (!run.projectId) {
      throw new Error("Run has no Stakwork projectId to review");
    }

    let workspaceSlugs = await resolveOrgWorkspaceSlugs(orgId, userId);
    if (workspaceSlugs.length === 0) {
      workspaceSlugs = [run.workspace.slug];
    }

    const scoreLine =
      typeof parsed.n_passed === "number" && typeof parsed.n_total === "number"
        ? ` It scored ${parsed.n_passed}/${parsed.n_total} criteria (${parsed.all_pass ? "PASS" : "FAIL"}).`
        : "";
    const prompt = `Review this project run: ${run.projectId}

What were the main reasons this workflow was not as effective as it could have been? Please return a report on the root causes and possible improvements. You can include proposals for Prompt updates, Concept updates, or Features (either code or workflows).

Context: this was a legal benchmark run of the Harvey LAB task "${parsed.taskTitle ?? "unknown"}" (${parsed.taskSlug ?? "unknown"}).${scoreLine}

At the end of the report, please use the graph walker to find the "Law" Concept node. Then find its neighbors, and propose an update to a sub Concept that includes some learnings from this run, so that next time, the agents will have better information and instructions.`;

    const now = new Date();
    const idPrefix = `benchmark-report-${runId}-${now.getTime().toString(36)}-`;
    const userRow: StoredMessage = {
      id: `${idPrefix}u`,
      role: "user",
      content: prompt,
      timestamp: now.toISOString(),
    };

    const conversation = await db.sharedConversation.create({
      data: {
        sourceControlOrgId: orgId,
        userId,
        workspaceId: null,
        messages: [userRow] as unknown as never,
        title: `Benchmark Report: ${parsed.taskTitle ?? runId}`,
        lastMessageAt: now,
        source: "org-canvas",
        settings: {
          extraWorkspaceSlugs: workspaceSlugs,
          benchmarkRunId: runId,
        } as unknown as never,
        followUpQuestions: [],
        // Shared so any org member can open the link from the Runs table
        isShared: true,
      },
      select: { id: true },
    });

    // Persist the link before the (slow) agent run so the Runs table can
    // surface it while the report is still being written.
    const reportChatPath = `/org/${githubLogin}?chat=${conversation.id}`;
    await mergeIntoRunResult(runId, {
      reportConversationId: conversation.id,
      reportChatPath,
    });
    await broadcastRunUpdate(run.workspace.slug, runId, run.type, run.featureId);

    logger.info("[report] Running canvas agent", LOG_SERVICE, {
      runId,
      conversationId: conversation.id,
      projectId: run.projectId,
    });

    const messages: ModelMessage[] = [{ role: "user", content: prompt }];
    const { result: agentResult } = await runCanvasAgent({
      userId,
      orgId,
      workspaceSlugs,
      messages,
      cachedConcepts: null as CachedConcepts | null,
      silentPusher: true,
      currentCanvasConversationId: conversation.id,
    });

    await agentResult.text;
    const steps = await agentResult.steps;

    const assistantPrefix = `${idPrefix}a`;
    const rows = messagesFromSteps(
      steps as Parameters<typeof messagesFromSteps>[0],
      assistantPrefix,
    );
    if (rows.length === 0) {
      rows.push({
        id: `${assistantPrefix}0`,
        role: "assistant",
        content: "(No response generated.)",
        timestamp: new Date().toISOString(),
      });
    }

    await appendTurnMessages({
      conversationId: conversation.id,
      rows,
      idPrefix: assistantPrefix,
      reason: "benchmark-report",
    });

    await mergeIntoRunResult(runId, { reportStatus: "completed" });
    await broadcastRunUpdate(run.workspace.slug, runId, run.type, run.featureId);

    logger.info("[report] Report generated", LOG_SERVICE, {
      runId,
      conversationId: conversation.id,
      messageRows: rows.length,
    });
  } catch (err) {
    await mergeIntoRunResult(runId, { reportStatus: "failed" }).catch(() => {});
    await broadcastRunUpdate(
      run.workspace.slug,
      runId,
      run.type,
      run.featureId,
    ).catch(() => {});
    throw err;
  }
}

async function broadcastRunUpdate(
  workspaceSlug: string,
  runId: string,
  type: string,
  featureId: string | null,
): Promise<void> {
  try {
    await pusherServer.trigger(
      getWorkspaceChannelName(workspaceSlug),
      PUSHER_EVENTS.STAKWORK_RUN_UPDATE,
      { runId, type, featureId, timestamp: new Date() },
    );
  } catch (pusherError) {
    logger.error("[report] Pusher trigger failed (non-fatal)", LOG_SERVICE, {
      runId,
      error: String(pusherError),
    });
  }
}
