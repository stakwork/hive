/**
 * Canvas-agent Sphinx tribe tools.
 *
 * `send_sphinx_message` posts immediately to the workspace(s) bound at
 * merge time via Hive's existing `sendToSphinx` path. Destination is
 * never an argument — the model cannot pick a workspace or invent an
 * org-level tribe.
 *
 * On a single-workspace turn (or an explicit `ws:<id>` scope) exactly
 * one target is bound. On the org-root canvas (`currentCanvasRef ===
 * ROOT_REF`), every Sphinx-connected, writable workspace in the
 * conversation is bound and the tool fans a single call out to all of
 * them in parallel — there is still no org-level tribe.
 *
 * The tool is registered only when `resolveSphinxToolTarget` finds at
 * least one Sphinx-connected in-scope workspace; execute still
 * re-checks connection and requires `canWrite` before decrypt or send,
 * per target.
 */

import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rate-limit";
import { sendToSphinx } from "@/lib/sphinx/daily-pr-summary";
import { validateWorkspaceAccessById } from "@/services/workspace";
import { ROOT_REF } from "@/lib/canvas/scope";
import { WORKSPACE_PERMISSION_LEVELS } from "@/lib/constants";
import { WorkspaceRole } from "@prisma/client";

export const SEND_SPHINX_MESSAGE_TOOL = "send_sphinx_message";

// Same threshold as `validateWorkspaceAccessById().canWrite`.
const SPHINX_WRITABLE_ROLES = (
  Object.keys(WORKSPACE_PERMISSION_LEVELS) as WorkspaceRole[]
).filter(
  (role) =>
    WORKSPACE_PERMISSION_LEVELS[role] >=
    WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.DEVELOPER],
);

const MESSAGE_MAX_LENGTH = 2000;
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_SECS = 600;
const SEND_TIMEOUT_MS = 10_000;

const NOT_FOUND_ERROR = "Workspace not found or not accessible";
const SEND_FAILED_ERROR = "Failed to send Sphinx message";

const sendSphinxMessageSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, SEND_FAILED_ERROR)
    .max(MESSAGE_MAX_LENGTH, SEND_FAILED_ERROR)
    .describe("The tribe message to send immediately."),
});

export interface SphinxToolTarget {
  workspaceId: string;
  workspaceSlug: string;
}

export interface ResolveSphinxToolTargetArgs {
  readonly?: boolean;
  silentPusher?: boolean;
  userId: string | null;
  publicViewer?: boolean;
  workspaceConfigs: Array<{ workspaceId: string; slug: string }>;
  currentCanvasRef?: string;
}

/**
 * Resolve every in-scope workspace that may receive `send_sphinx_message`
 * on this turn.
 *
 * Returns `[]` (do not merge the tool) when the turn is readonly, an
 * auto-turn, unauthenticated, a public viewer, or no in-scope candidate
 * is Sphinx-connected + writable by the caller.
 *
 * Candidate selection (`resolveSphinxCandidate`) is scope-based:
 *   - Single-workspace turn → that one workspace.
 *   - Multi-workspace + explicit `ws:<id>` → that conversation workspace
 *     only (if present).
 *   - Multi-workspace + org-root (`currentCanvasRef === ROOT_REF`) →
 *     every conversation workspace (still filtered below to
 *     connected + writable — never an org-wide tribe).
 *   - Anything else (missing ref, `initiative:*`, `node:*`,
 *     `feature:*`, opaque refs) → no candidates.
 */
export async function resolveSphinxToolTarget(
  args: ResolveSphinxToolTargetArgs,
): Promise<SphinxToolTarget[]> {
  const {
    readonly,
    silentPusher,
    userId,
    publicViewer,
    workspaceConfigs,
    currentCanvasRef,
  } = args;

  if (readonly || silentPusher || !userId || publicViewer) {
    return [];
  }

  const candidates = resolveSphinxCandidate(workspaceConfigs, currentCanvasRef);
  if (candidates.length === 0) {
    return [];
  }

  // One round trip: Sphinx-connected AND writable by the caller (owner, or
  // an active member at DEVELOPER+). This runs on every org-root canvas
  // turn, so it must not fan out per workspace — the previous serial
  // `validateWorkspaceAccessById` loop cost ~4s across 8 workspaces.
  // `execute` re-validates `canWrite` per target before decrypt or send.
  const connectedRows = await db.workspace.findMany({
    where: {
      id: { in: candidates.map((c) => c.workspaceId) },
      sphinxEnabled: true,
      deleted: false,
      sphinxChatPubkey: { not: null },
      sphinxBotId: { not: null },
      sphinxBotSecret: { not: null },
      OR: [
        { ownerId: userId },
        {
          members: {
            some: { userId, leftAt: null, role: { in: SPHINX_WRITABLE_ROLES } },
          },
        },
      ],
    },
    select: { id: true, slug: true },
  });
  const connectedById = new Map(connectedRows.map((row) => [row.id, row]));

  // Preserve candidate (conversation) order — findMany order is unspecified.
  const targets: SphinxToolTarget[] = [];
  for (const candidate of candidates) {
    const row = connectedById.get(candidate.workspaceId);
    if (!row) continue;
    targets.push({ workspaceId: row.id, workspaceSlug: row.slug });
  }

  return targets;
}

function resolveSphinxCandidate(
  workspaceConfigs: Array<{ workspaceId: string; slug: string }>,
  currentCanvasRef?: string,
): Array<{ workspaceId: string; slug: string }> {
  if (workspaceConfigs.length === 1) {
    return [workspaceConfigs[0]];
  }

  if (workspaceConfigs.length > 1) {
    // Org-root only. Do NOT treat a missing/undefined ref, or any
    // non-`ws:` ref, as org-root — that would merge the tool for
    // initiative-adjacent, authored, opaque, and no-scope turns
    // (including MCP calls without a canvas scope).
    if (currentCanvasRef === ROOT_REF) {
      return workspaceConfigs;
    }

    if (typeof currentCanvasRef === "string" && currentCanvasRef.startsWith("ws:")) {
      const id = currentCanvasRef.slice("ws:".length);
      if (!id) {
        return [];
      }
      const found = workspaceConfigs.find((c) => c.workspaceId === id);
      return found ? [found] : [];
    }

    return [];
  }

  return [];
}

type TargetOutcome =
  | { success: true; messageId?: string }
  | { success: false; error: string };

async function sendToOneTarget(opts: {
  userId: string;
  target: SphinxToolTarget;
  body: string;
}): Promise<TargetOutcome> {
  const { userId, target, body } = opts;
  const { workspaceId, workspaceSlug } = target;

  try {
    const rl = await checkRateLimit(
      `send_sphinx_message:${userId}:${workspaceId}`,
      RATE_LIMIT_MAX,
      RATE_LIMIT_WINDOW_SECS,
    );
    if (!rl.allowed) {
      return { success: false, error: SEND_FAILED_ERROR };
    }

    const access = await validateWorkspaceAccessById(workspaceId, userId);
    if (!access.canWrite) {
      return { success: false, error: NOT_FOUND_ERROR };
    }

    const workspace = await db.workspace.findFirst({
      where: { id: workspaceId, deleted: false },
      select: {
        sphinxEnabled: true,
        sphinxChatPubkey: true,
        sphinxBotId: true,
        sphinxBotSecret: true,
      },
    });

    if (
      !workspace ||
      !workspace.sphinxEnabled ||
      !workspace.sphinxChatPubkey ||
      !workspace.sphinxBotId ||
      !workspace.sphinxBotSecret
    ) {
      return { success: false, error: NOT_FOUND_ERROR };
    }

    let botSecret: string;
    try {
      botSecret = EncryptionService.getInstance().decryptField(
        "sphinxBotSecret",
        workspace.sphinxBotSecret,
      );
    } catch {
      logger.warn("[SPHINX] Failed to send Sphinx message", "SPHINX", {
        workspaceSlug,
      });
      return { success: false, error: SEND_FAILED_ERROR };
    }

    const result = await sendToSphinx(
      {
        chatPubkey: workspace.sphinxChatPubkey,
        botId: workspace.sphinxBotId,
        botSecret,
      },
      body,
      AbortSignal.timeout(SEND_TIMEOUT_MS),
    );

    if (result.success) {
      logger.info("[SPHINX] Sphinx message sent", "SPHINX", {
        workspaceSlug,
        messageId: result.messageId,
        success: true,
      });
      return { success: true, messageId: result.messageId };
    }

    logger.warn("[SPHINX] Failed to send Sphinx message", "SPHINX", {
      workspaceSlug,
      statusCode: result.statusCode,
    });
    return { success: false, error: SEND_FAILED_ERROR };
  } catch {
    logger.warn("[SPHINX] Failed to send Sphinx message", "SPHINX", {
      workspaceSlug,
    });
    return { success: false, error: SEND_FAILED_ERROR };
  }
}

export function buildSphinxTools(opts: {
  userId: string;
  targets: SphinxToolTarget[];
  /**
   * The acting user's GitHub handle, prepended to every posted message
   * as `[<actorLabel>] <message>` so the tribe can see who asked.
   * Omitted (or empty) → post the message unchanged.
   */
  actorLabel?: string;
}): ToolSet {
  const { userId, targets, actorLabel } = opts;

  if (targets.length === 0) {
    return {};
  }

  const description =
    targets.length === 1
      ? "Post a message to this workspace's Sphinx tribe. The message sends immediately when this tool is called. There is no draft or preview step. " +
        "Post ONLY to the current workspace's Sphinx tribe. Never attempt to target another workspace or an org-wide tribe. " +
        "Write the message in ASD-STE100 Simplified Technical English: one idea per sentence (20 words or fewer), active voice, one word per meaning, no contractions, short paragraphs, and lists for 3 or more items. " +
        "Technical names (function names, paths, endpoints) are exempt from these style rules."
      : "Post a message to every Sphinx-connected workspace tribe in this conversation that you can write to. One call fans out to all of them; the message sends immediately, with no draft or preview step. " +
        "Destination is bound server-side to the writable, Sphinx-connected workspaces already in this conversation — you cannot pick a workspace and there is no org-wide tribe. " +
        "Write the message in ASD-STE100 Simplified Technical English: one idea per sentence (20 words or fewer), active voice, one word per meaning, no contractions, short paragraphs, and lists for 3 or more items. " +
        "Technical names (function names, paths, endpoints) are exempt from these style rules.";

  return {
    [SEND_SPHINX_MESSAGE_TOOL]: tool({
      description,
      inputSchema: sendSphinxMessageSchema,
      execute: async ({ message }: { message: string }) => {
        const prefixed = actorLabel ? `[${actorLabel}] ${message}` : message;
        // Prefix + a 2000-char message can exceed the cap — always slice
        // the posted body so the wire never exceeds MESSAGE_MAX_LENGTH.
        const body = prefixed.slice(0, MESSAGE_MAX_LENGTH);

        const outcomes = await Promise.all(
          targets.map((target) => sendToOneTarget({ userId, target, body })),
        );

        const succeeded = outcomes.find(
          (o): o is { success: true; messageId?: string } => o.success,
        );
        if (succeeded) {
          return { success: true, messageId: succeeded.messageId };
        }

        // No tribe list, no per-target breakdown — the model gets a
        // generic result either way. Preserve the specific single-target
        // error (e.g. write-access) when there was exactly one target.
        if (outcomes.length === 1) {
          const only = outcomes[0];
          return { error: only.success ? SEND_FAILED_ERROR : only.error };
        }

        return { error: SEND_FAILED_ERROR };
      },
    }),
  };
}
