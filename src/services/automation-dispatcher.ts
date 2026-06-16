/**
 * Dispatcher for due `Automation` records (recurring scheduled prompts).
 *
 * Called by the per-minute cron at `/api/cron/automations`. For each enabled
 * automation whose `nextRunAt` has passed, the dispatcher:
 *   1. Claims it via SELECT FOR UPDATE SKIP LOCKED and immediately advances
 *      `nextRunAt` to the next occurrence (concurrent- + retry-safe; a daily
 *      automation never double-fires within the same minute window).
 *   2. Resolves the org's workspace slugs (org-canvas spans all workspaces).
 *   3. Creates a brand-new org-canvas `SharedConversation` seeded with the
 *      automation's prompt as the first user message.
 *   4. Runs `runCanvasAgent` and appends the assistant turn.
 *   5. Records the new conversation on `lastRunConversationId` with
 *      `lastRunSeenAt = null` so the canvas page can auto-open it.
 *
 * Per-automation errors are caught and logged; remaining automations still
 * run. Because `nextRunAt` is advanced at claim time, a failed run is simply
 * skipped until the next day rather than hot-looping every minute.
 */

import { db } from "@/lib/db";
import { type ModelMessage } from "ai";
import { runCanvasAgent, type CachedConcepts } from "@/lib/ai/runCanvasAgent";
import {
  messagesFromSteps,
  appendTurnMessages,
  type StoredMessage,
} from "@/services/canvas-turn-persistence";
import { generateTitle } from "@/lib/ai/conversationHelpers";
import { computeNextRunAt } from "@/lib/automations/schedule";
import { isApiError } from "@/types/errors";

/**
 * Best-effort, human-readable message for any thrown value. Plain
 * `ApiError` objects (thrown by `buildWorkspaceConfigs` et al.) are not
 * `Error` instances, so `String(err)` would yield "[object Object]" —
 * unwrap them here so prod logs surface the real cause.
 */
function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (isApiError(err)) return `${err.kind}: ${err.message}`;
  if (typeof err === "object" && err !== null) {
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

const LOG_PREFIX = "[Automations]";
const MAX_PER_RUN = 10;
const MAX_WORKSPACE_SLUGS = 20;

export interface AutomationDispatchResult {
  fired: number;
  failed: number;
  errors: string[];
}

/**
 * Canvas-ready workspace slugs under an org, capped at MAX_WORKSPACE_SLUGS.
 *
 * Mirrors `buildWorkspaceConfigs`'s acceptance criteria (and the
 * `orgContextScout` filter): a workspace is only included if it
 *   (a) is accessible to the automation's user (owner or active member),
 *   (b) has a configured swarm with a swarmUrl, and
 *   (c) has at least one repository.
 * Passing a slug that fails any of these makes `runCanvasAgent` throw
 * inside the tool-assembly path, which would abort the whole org
 * automation. Filtering at the source keeps the run robust against
 * half-configured workspaces (e.g. a "testing" workspace with no swarm).
 */
async function resolveOrgWorkspaceSlugs(
  sourceControlOrgId: string,
  userId: string,
): Promise<string[]> {
  const workspaces = await db.workspace.findMany({
    where: {
      sourceControlOrgId,
      deletedAt: null,
      OR: [
        { ownerId: userId },
        { members: { some: { userId, leftAt: null } } },
      ],
      swarm: { swarmUrl: { not: null } },
      repositories: { some: {} },
    },
    select: { slug: true },
    orderBy: { createdAt: "asc" },
    take: MAX_WORKSPACE_SLUGS,
  });
  return workspaces.map((w) => w.slug);
}

export async function dispatchDueAutomations(): Promise<AutomationDispatchResult> {
  const result: AutomationDispatchResult = { fired: 0, failed: 0, errors: [] };

  const sweepNow = new Date();
  console.log(
    `${LOG_PREFIX} Starting dispatch run at ${sweepNow.toISOString()}`,
  );

  const due = await db.automation.findMany({
    where: { enabled: true, nextRunAt: { lte: sweepNow } },
    orderBy: { nextRunAt: "asc" },
    take: MAX_PER_RUN,
  });

  if (due.length === 0) {
    // Surface upcoming automations so it's obvious WHY nothing fired (e.g.
    // the scheduled time is still in the future, or everything is disabled).
    const upcoming = await db.automation.findMany({
      orderBy: { nextRunAt: "asc" },
      take: 5,
      select: {
        id: true,
        name: true,
        enabled: true,
        nextRunAt: true,
        timeOfDay: true,
        timezone: true,
      },
    });
    if (upcoming.length === 0) {
      console.log(`${LOG_PREFIX} No automations exist yet — nothing to do`);
    } else {
      console.log(
        `${LOG_PREFIX} 0 due. Next ${upcoming.length} automation(s):`,
      );
      for (const u of upcoming) {
        const mins = Math.round(
          (new Date(u.nextRunAt).getTime() - sweepNow.getTime()) / 60000,
        );
        console.log(
          `${LOG_PREFIX}   • "${u.name}" (${u.id}) enabled=${u.enabled} ` +
            `at ${u.timeOfDay} ${u.timezone} → nextRunAt=${new Date(
              u.nextRunAt,
            ).toISOString()} (in ${mins} min)`,
        );
      }
    }
    console.log(`${LOG_PREFIX} Dispatch complete — fired: 0, failed: 0`);
    return result;
  }

  console.log(`${LOG_PREFIX} Found ${due.length} due automation(s)`);

  for (const automation of due) {
    console.log(
      `${LOG_PREFIX} Dispatching automationId=${automation.id} name="${automation.name}" org=${automation.sourceControlOrgId} nextRunAt=${new Date(automation.nextRunAt).toISOString()}`,
    );

    try {
      // ── Claim + advance the schedule atomically ──────────────────────
      // Lock the row, re-check it's still due (another worker may have taken
      // it), then push `nextRunAt` to the next occurrence so it can't refire.
      const now = new Date();
      const nextRunAt = computeNextRunAt(
        automation.timeOfDay,
        automation.timezone,
        now,
      );

      let claimed = false;
      await db.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<
          { id: string; enabled: boolean; next_run_at: Date }[]
        >`
          SELECT id, enabled, next_run_at FROM automations
          WHERE id = ${automation.id}
          FOR UPDATE SKIP LOCKED
        `;
        if (
          locked.length === 0 ||
          !locked[0].enabled ||
          new Date(locked[0].next_run_at).getTime() > now.getTime()
        ) {
          return;
        }
        await tx.automation.update({
          where: { id: automation.id },
          data: { nextRunAt, lastRunAt: now },
        });
        claimed = true;
      });

      if (!claimed) {
        console.log(
          `${LOG_PREFIX} automationId=${automation.id} already claimed/not-due — skipping`,
        );
        continue;
      }
      console.log(
        `${LOG_PREFIX} automationId=${automation.id} claimed; re-armed nextRunAt=${nextRunAt.toISOString()}`,
      );

      // ── Resolve workspace scope ──────────────────────────────────────
      const workspaceSlugs = await resolveOrgWorkspaceSlugs(
        automation.sourceControlOrgId,
        automation.userId,
      );
      if (workspaceSlugs.length === 0) {
        throw new Error(
          `No workspaces found for org ${automation.sourceControlOrgId}`,
        );
      }
      console.log(
        `${LOG_PREFIX} automationId=${automation.id} workspaceSlugs=[${workspaceSlugs.join(", ")}]`,
      );

      // ── Create the fresh org-canvas conversation ─────────────────────
      const idPrefix = `automation-${automation.id}-${Date.now().toString(36)}-`;
      const userRow: StoredMessage = {
        id: `${idPrefix}u`,
        role: "user",
        content: automation.prompt,
        timestamp: now.toISOString(),
      };

      const conversation = await db.sharedConversation.create({
        data: {
          sourceControlOrgId: automation.sourceControlOrgId,
          userId: automation.userId,
          workspaceId: null,
          messages: [userRow] as unknown as never,
          title: automation.name || generateTitle([userRow]),
          lastMessageAt: now,
          source: "org-canvas",
          settings: {
            extraWorkspaceSlugs: workspaceSlugs,
            automationId: automation.id,
            automationName: automation.name,
          } as unknown as never,
          followUpQuestions: [],
          isShared: false,
        },
        select: { id: true },
      });
      console.log(
        `${LOG_PREFIX} automationId=${automation.id} created conversationId=${conversation.id}; running agent…`,
      );

      // ── Run the agent ────────────────────────────────────────────────
      const messages: ModelMessage[] = [
        { role: "user", content: automation.prompt },
      ];

      const { result: agentResult } = await runCanvasAgent({
        userId: automation.userId,
        orgId: automation.sourceControlOrgId,
        workspaceSlugs,
        messages,
        cachedConcepts: null as CachedConcepts | null,
        silentPusher: true,
        currentCanvasConversationId: conversation.id,
      });

      await agentResult.text;
      const steps = await agentResult.steps;
      console.log(
        `${LOG_PREFIX} automationId=${automation.id} agent finished — ${steps.length} step(s)`,
      );

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
        reason: "automation",
      });
      console.log(
        `${LOG_PREFIX} automationId=${automation.id} appended ${rows.length} message row(s) to conversationId=${conversation.id}`,
      );

      // ── Mark the run available for auto-open ─────────────────────────
      await db.automation.update({
        where: { id: automation.id },
        data: { lastRunConversationId: conversation.id, lastRunSeenAt: null },
      });

      console.log(
        `${LOG_PREFIX} Fired automationId=${automation.id} conversationId=${conversation.id}`,
      );
      result.fired++;
    } catch (err) {
      const message = describeError(err);
      console.error(
        `${LOG_PREFIX} FAILED automationId=${automation.id} error=${message}`,
      );
      result.errors.push(`${automation.id}: ${message}`);
      result.failed++;
    }
  }

  console.log(
    `${LOG_PREFIX} Dispatch complete — fired: ${result.fired}, failed: ${result.failed}`,
  );
  return result;
}
