/**
 * Canvas-agent Sphinx tribe tools.
 *
 * `send_sphinx_message` posts immediately to the workspace bound at merge
 * time via Hive's existing `sendToSphinx` path. Destination is never an
 * argument — the model cannot pick another workspace or an org-level tribe.
 *
 * The tool is registered only when `resolveSphinxToolTarget` finds a
 * Sphinx-connected in-scope workspace; execute still re-checks connection
 * and requires `canWrite` before decrypt or send.
 */

import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { logger } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rate-limit";
import { sendToSphinx } from "@/lib/sphinx/daily-pr-summary";
import { validateWorkspaceAccessById } from "@/services/workspace";

export const SEND_SPHINX_MESSAGE_TOOL = "send_sphinx_message";

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
 * Resolve the single in-scope workspace that may receive `send_sphinx_message`.
 *
 * Returns null (do not merge the tool) when the turn is readonly, an
 * auto-turn, unauthenticated, a public viewer, the candidate is not
 * Sphinx-connected, or multi-workspace scope is not an explicit `ws:<id>`
 * of a conversation workspace.
 */
export async function resolveSphinxToolTarget(
  args: ResolveSphinxToolTargetArgs,
): Promise<SphinxToolTarget | null> {
  const {
    readonly,
    silentPusher,
    userId,
    publicViewer,
    workspaceConfigs,
    currentCanvasRef,
  } = args;

  if (readonly || silentPusher || !userId || publicViewer) {
    return null;
  }

  const candidate = resolveSphinxCandidate(workspaceConfigs, currentCanvasRef);
  if (!candidate) {
    return null;
  }

  const connected = await db.workspace.findFirst({
    where: {
      id: candidate.workspaceId,
      sphinxEnabled: true,
      deleted: false,
      sphinxChatPubkey: { not: null },
      sphinxBotId: { not: null },
      sphinxBotSecret: { not: null },
    },
    select: { id: true, slug: true },
  });

  if (!connected) {
    return null;
  }

  return { workspaceId: connected.id, workspaceSlug: connected.slug };
}

function resolveSphinxCandidate(
  workspaceConfigs: Array<{ workspaceId: string; slug: string }>,
  currentCanvasRef?: string,
): { workspaceId: string; slug: string } | null {
  if (workspaceConfigs.length === 1) {
    return workspaceConfigs[0];
  }

  if (workspaceConfigs.length > 1) {
    if (typeof currentCanvasRef !== "string" || !currentCanvasRef.startsWith("ws:")) {
      return null;
    }
    const id = currentCanvasRef.slice("ws:".length);
    if (!id) {
      return null;
    }
    return workspaceConfigs.find((c) => c.workspaceId === id) ?? null;
  }

  return null;
}

export function buildSphinxTools(opts: {
  userId: string;
  workspaceId: string;
  workspaceSlug: string;
}): ToolSet {
  const { userId, workspaceId, workspaceSlug } = opts;

  return {
    [SEND_SPHINX_MESSAGE_TOOL]: tool({
      description:
        "Post a message to this workspace's Sphinx tribe. The message sends immediately when this tool is called. There is no draft or preview step. " +
        "Post ONLY to the current workspace's Sphinx tribe. Never attempt to target another workspace or an org-wide tribe. " +
        "Write the message in ASD-STE100 Simplified Technical English: one idea per sentence (20 words or fewer), active voice, one word per meaning, no contractions, short paragraphs, and lists for 3 or more items. " +
        "Technical names (function names, paths, endpoints) are exempt from these style rules.",
      inputSchema: sendSphinxMessageSchema,
      execute: async ({ message }: { message: string }) => {
        try {
          const rl = await checkRateLimit(
            `send_sphinx_message:${userId}:${workspaceId}`,
            RATE_LIMIT_MAX,
            RATE_LIMIT_WINDOW_SECS,
          );
          if (!rl.allowed) {
            return { error: SEND_FAILED_ERROR };
          }

          const access = await validateWorkspaceAccessById(workspaceId, userId);
          if (!access.canWrite) {
            return { error: NOT_FOUND_ERROR };
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
            return { error: NOT_FOUND_ERROR };
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
            return { error: SEND_FAILED_ERROR };
          }

          const result = await sendToSphinx(
            {
              chatPubkey: workspace.sphinxChatPubkey,
              botId: workspace.sphinxBotId,
              botSecret,
            },
            message,
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
          return { error: SEND_FAILED_ERROR };
        } catch {
          logger.warn("[SPHINX] Failed to send Sphinx message", "SPHINX", {
            workspaceSlug,
          });
          return { error: SEND_FAILED_ERROR };
        }
      },
    }),
  };
}
