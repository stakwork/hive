/**
 * Canvas-agent Sphinx tribe tools.
 *
 * `send_sphinx_message` posts immediately via Hive's existing
 * `sendToSphinx` path. The candidate pool is bound at merge time from
 * in-scope, writable, Sphinx-connected workspaces — the model cannot
 * invent a workspace or an org-level tribe.
 *
 * Execute defaults to **one tribe** (conversation order after
 * `sphinxChatPubkey` dedupe). Extra tribes are reached only when the
 * caller passes `destinations` that match name, slug, or swarm host
 * inside that already-bound pool.
 *
 * On a single-workspace turn (or an explicit `ws:<id>` scope) exactly
 * one target is bound and `destinations` is ignored. On the org-root
 * canvas (`currentCanvasRef === ROOT_REF`) the pool still includes
 * every connected writable conversation workspace, but a default send
 * still posts to one tribe.
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
import { getSwarmVanityAddress, WORKSPACE_PERMISSION_LEVELS } from "@/lib/constants";
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
const SPHINX_CHAT_HOST_SUFFIX = ".sphinx.chat";

const NOT_FOUND_ERROR = "Workspace not found or not accessible";
const SEND_FAILED_ERROR = "Failed to send Sphinx message";

const sendSphinxMessageSchema = z.object({
  message: z
    .string()
    .trim()
    .min(1, SEND_FAILED_ERROR)
    .max(MESSAGE_MAX_LENGTH, SEND_FAILED_ERROR)
    .describe("The tribe message to send immediately."),
  destinations: z
    .array(z.string().trim().min(1))
    .max(32)
    .optional()
    .describe(
      "Omit to post to the default one tribe. Pass only when the user named specific workspace(s) or tribe(s) by name, slug, or swarm host. Extra unnamed tribes are not sent.",
    ),
});

export interface SphinxToolTarget {
  workspaceId: string;
  workspaceSlug: string;
  sphinxChatPubkey: string;
  workspaceName: string;
  swarmDomain?: string;
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
 *
 * The returned pool is the bound set execute may pick from. Execute
 * defaults to one tribe; named `destinations` filter this pool and
 * never query outside it.
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
    select: {
      id: true,
      slug: true,
      name: true,
      sphinxChatPubkey: true,
      swarm: { select: { name: true } },
    },
  });
  const connectedById = new Map(connectedRows.map((row) => [row.id, row]));

  // Preserve candidate (conversation) order — findMany order is unspecified.
  const targets: SphinxToolTarget[] = [];
  for (const candidate of candidates) {
    const row = connectedById.get(candidate.workspaceId);
    if (!row) continue;
    const target: SphinxToolTarget = {
      workspaceId: row.id,
      workspaceSlug: row.slug,
      sphinxChatPubkey: row.sphinxChatPubkey ?? "",
      workspaceName: row.name,
    };
    if (row.swarm?.name) {
      target.swarmDomain = getSwarmVanityAddress(row.swarm.name);
    }
    targets.push(target);
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

/**
 * Keep the first occurrence of each non-empty `sphinxChatPubkey` in
 * conversation order. Empty pubkeys are skipped.
 */
function dedupeByPubkey(targets: SphinxToolTarget[]): SphinxToolTarget[] {
  const seen = new Set<string>();
  const result: SphinxToolTarget[] = [];
  for (const target of targets) {
    if (!target.sphinxChatPubkey) continue;
    if (seen.has(target.sphinxChatPubkey)) continue;
    seen.add(target.sphinxChatPubkey);
    result.push(target);
  }
  return result;
}

function swarmHostname(swarmDomain: string): string {
  if (swarmDomain.toLowerCase().endsWith(SPHINX_CHAT_HOST_SUFFIX)) {
    return swarmDomain.slice(0, -SPHINX_CHAT_HOST_SUFFIX.length);
  }
  return swarmDomain;
}

function targetMatchesDestination(target: SphinxToolTarget, name: string): boolean {
  const needle = name.toLowerCase();
  if (target.workspaceSlug.toLowerCase() === needle) return true;
  if (target.workspaceName.toLowerCase() === needle) return true;
  if (target.swarmDomain && target.swarmDomain.toLowerCase() === needle) return true;
  if (target.swarmDomain && swarmHostname(target.swarmDomain).toLowerCase() === needle) {
    return true;
  }
  return false;
}

/**
 * Pick which bound targets a send should actually hit.
 *
 * - Bound pool of 1 → always that target (`destinations` cannot retarget).
 * - Omitted / empty `destinations` → the first pubkey-deduped tribe.
 * - Named destinations → first bound match per name (slug, workspace
 *   name, full swarm domain, or swarm hostname), then pubkey-deduped.
 *   Unmatched names are dropped and never fall back to the default.
 */
function selectSendTargets(
  targets: SphinxToolTarget[],
  destinations?: string[],
): SphinxToolTarget[] {
  if (targets.length === 1) {
    return targets;
  }

  if (!destinations || destinations.length === 0) {
    const first = dedupeByPubkey(targets)[0];
    return first ? [first] : [];
  }

  const matched: SphinxToolTarget[] = [];
  for (const raw of destinations) {
    const name = raw.trim();
    if (!name) continue;
    const found = targets.find((target) => targetMatchesDestination(target, name));
    if (found) matched.push(found);
  }
  return dedupeByPubkey(matched);
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

const SEND_SPHINX_MESSAGE_DESCRIPTION =
  "Post a message to a Sphinx tribe. Call this tool only when the user asks to post to Sphinx or the tribe. Do not call this tool for ordinary chat, summaries, or other tool flows. " +
  "The default is one tribe. The message sends immediately. There is no draft or preview step. Never post to an org-wide tribe. " +
  "Omit destinations to post to the default tribe. Pass destinations only when the user names specific workspace(s) or tribe(s) by name, slug, or swarm host. A multi-tribe send requires two or more named destinations that match distinct tribes. " +
  "On a single bound workspace, do not pass destinations. " +
  "Write the message in ASD-STE100 Simplified Technical English: one idea per sentence (20 words or fewer), active voice, one word per meaning, no contractions, short paragraphs, and lists for 3 or more items. " +
  "Technical names (function names, paths, endpoints) are exempt from these style rules.";

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

  return {
    [SEND_SPHINX_MESSAGE_TOOL]: tool({
      description: SEND_SPHINX_MESSAGE_DESCRIPTION,
      inputSchema: sendSphinxMessageSchema,
      execute: async ({
        message,
        destinations,
      }: {
        message: string;
        destinations?: string[];
      }) => {
        const prefixed = actorLabel ? `[${actorLabel}] ${message}` : message;
        // Prefix + a 2000-char message can exceed the cap — always slice
        // the posted body so the wire never exceeds MESSAGE_MAX_LENGTH.
        const body = prefixed.slice(0, MESSAGE_MAX_LENGTH);

        const selected = selectSendTargets(targets, destinations);
        // A single bound workspace ignores destinations for both
        // targeting and error shape (existing single-target contract).
        const namedPath =
          targets.length > 1 && Boolean(destinations && destinations.length > 0);

        const outcomes: TargetOutcome[] = [];
        for (const target of selected) {
          outcomes.push(await sendToOneTarget({ userId, target, body }));
        }

        const succeeded = outcomes.find(
          (o): o is { success: true; messageId?: string } => o.success,
        );
        if (succeeded) {
          return { success: true, messageId: succeeded.messageId };
        }

        // Named destinations that match nothing / fail every send always
        // get a generic error — never the single-target not-found shape,
        // even when the match set collapsed to one unwritable target.
        if (namedPath) {
          return { error: SEND_FAILED_ERROR };
        }

        // No tribe list, no per-target breakdown — the model gets a
        // generic result either way. Preserve the specific single-target
        // error (e.g. write-access) when there was exactly one selected.
        if (outcomes.length === 1) {
          const only = outcomes[0];
          return { error: only.success ? SEND_FAILED_ERROR : only.error };
        }

        return { error: SEND_FAILED_ERROR };
      },
    }),
  };
}
