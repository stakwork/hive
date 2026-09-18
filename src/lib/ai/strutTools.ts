/**
 * Strut sub-agent tools — the canvas agent dispatching a workspace swarm's
 * strut AI builder (the workflow-authoring assistant mounted at the swarm's
 * `/lab`, see strut `AGENTS.md`).
 *
 *   - `dispatch_strut`   — start a strut chat, or continue one by `chatId`.
 *   - `check_strut_chat` — read a chat's status + latest reply (fallback).
 *   - `list_strut_chats` — find a chat id again.
 *
 * ## Delivery: strut's turn-end callback, not a poll
 *
 * A strut turn takes seconds or HOURS, and one dispatch can produce several
 * turns (a `run_workflow` that auto-detaches ends its turn with "I'll report
 * back"; the run/verify notification wakes the chat later, on its own). So
 * `dispatch_strut` is dispatch-only, like `workflow_explorer_agent`: it
 * creates a `PENDING` `AgentRun` row (`agentKind: "strut_chat"`), POSTs the
 * message to strut with a `callback.url` carrying the row id + a bearer
 * token, and returns. Strut POSTs EVERY turn end to
 * `/api/agent-runs/webhook/strut`, which fans each into the conversation and
 * wakes the canvas agent once strut reports `settled: true`.
 *
 * Differences from the single-shot `AgentRun` webhook:
 *   - the token is MULTI-use while the row is PENDING (one post per turn);
 *     the settled post claims the row and retires it;
 *   - `sessionId` holds the strut chat id, `requestId` the dispatched turn;
 *   - continuing a chat replaces its callback URL on the strut side, so any
 *     earlier PENDING row for that chat can never be called again — it is
 *     retired here as superseded.
 *
 * `callback: true` in strut's 202 is the proof that swarm's strut honors
 * callbacks. An older strut ignores the field and would never call back, so
 * its absence is reported to the model (with the chat id) rather than left
 * as a dispatch that silently never reports.
 *
 * RESIDUAL GAP: strut's pending state is in-process — a swarm restart
 * mid-run drops the final callback and the row stays PENDING.
 * `check_strut_chat` is the fallback.
 *
 * NEVER log the raw token or the full callback URL.
 */

import { tool, type ToolSet } from "ai";
import { z } from "zod";
import crypto from "crypto";
import { db } from "@/lib/db";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
import { resolveOrgConversationRowId } from "@/services/org-canvas-conversation";
import type { CapabilityContext } from "./capabilities";

export const DISPATCH_STRUT_TOOL = "dispatch_strut";
export const STRUT_AGENT_KIND = "strut_chat";

const STRUT_TIMEOUT_MS = 15_000;
/** Cap on the reply text `check_strut_chat` hands the model. */
const MAX_REPLY_CHARS = 20_000;
const MAX_LISTED_CHATS = 30;

interface StrutTarget {
  workspaceId: string;
  labBase: string;
  swarmApiKey: string;
}

/**
 * Resolve a workspace's strut lab, validating that the acting user can
 * access the workspace AND that it belongs to the active org — before any
 * swarm credential is touched.
 */
async function resolveStrut(ctx: CapabilityContext, workspaceSlug: string): Promise<StrutTarget | { error: string }> {
  const access = await getWorkspaceSwarmAccess(workspaceSlug, ctx.userId);
  if (!access.success) {
    return {
      error:
        access.error.type === "WORKSPACE_NOT_FOUND" || access.error.type === "ACCESS_DENIED"
          ? `Workspace '${workspaceSlug}' not found, or you do not have access to it.`
          : `Workspace '${workspaceSlug}' has no active swarm, so it has no strut.`,
    };
  }
  const workspace = await db.workspace.findUnique({
    where: { id: access.data.workspaceId },
    select: { sourceControlOrgId: true },
  });
  if (workspace?.sourceControlOrgId !== ctx.orgId) {
    return { error: `Workspace '${workspaceSlug}' does not belong to the active org.` };
  }
  return {
    workspaceId: access.data.workspaceId,
    labBase: `${transformSwarmUrlToRepo2Graph(access.data.swarmUrl)}/lab`,
    swarmApiKey: access.data.swarmApiKey,
  };
}

async function strutFetch(target: StrutTarget, path: string, init?: { body: unknown }): Promise<Response> {
  return fetch(`${target.labBase}${path}`, {
    method: init ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      "x-api-token": target.swarmApiKey,
    },
    ...(init ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(STRUT_TIMEOUT_MS),
  });
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Create the `AgentRun` row strut's callbacks are delivered against. Returns
 * `null` when there is no delivery target (no canvas conversation / public
 * base URL) — the dispatch then goes out without a callback.
 */
async function setupCallback(
  ctx: CapabilityContext,
  row: { title: string; prompt: string; workspaceId: string; workspaceSlug: string; chatId?: string },
): Promise<{ runId: string; callbackUrl: string } | null> {
  if (!ctx.currentCanvasConversationId || !ctx.publicBaseUrl) return null;

  // IDOR guard: the caller must own this conversation.
  const conversationId = await resolveOrgConversationRowId({
    conversationId: ctx.currentCanvasConversationId,
    userId: ctx.userId,
    orgId: ctx.orgId,
  });
  if (!conversationId) return null;

  const rawToken = crypto.randomBytes(32).toString("hex");
  const agentRun = await db.agentRun.create({
    data: {
      tokenHash: hashToken(rawToken),
      agentKind: STRUT_AGENT_KIND,
      conversationId,
      orgId: ctx.orgId,
      userId: ctx.userId,
      title: row.title,
      prompt: row.prompt,
      workspaceId: row.workspaceId,
      workspaceSlug: row.workspaceSlug,
      ...(row.chatId ? { sessionId: row.chatId } : {}),
    },
    select: { id: true },
  });
  return {
    runId: agentRun.id,
    callbackUrl: `${ctx.publicBaseUrl}/api/agent-runs/webhook/strut?id=${agentRun.id}&token=${rawToken}`,
  };
}

async function failRun(runId: string, error: string): Promise<void> {
  await db.agentRun
    .updateMany({ where: { id: runId, status: "PENDING" }, data: { status: "FAILED", error } })
    .catch((e) =>
      console.warn("[dispatch_strut] failed to retire row (non-fatal)", {
        runId,
        error: e instanceof Error ? e.message : String(e),
      }),
    );
}

/** The last assistant message that has text, from a strut transcript. */
export function lastAssistantText(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as { role?: string; content?: unknown };
    if (m?.role !== "assistant") continue;
    const text =
      typeof m.content === "string"
        ? m.content
        : Array.isArray(m.content)
          ? m.content
              .filter((p): p is { type: "text"; text: string } => p?.type === "text" && typeof p.text === "string")
              .map((p) => p.text)
              .join("")
          : "";
    if (text.trim()) return text;
  }
  return null;
}

export function buildStrutTools(ctx: CapabilityContext): ToolSet {
  return {
    [DISPATCH_STRUT_TOOL]: tool({
      description:
        "Dispatch a workspace's strut AI builder — the workflow-authoring agent on that workspace's swarm. " +
        "It builds and revises strut workflows and custom steps, runs them, and evaluates their runs (run logs, outputs, claims/evidence). " +
        "Omit `chatId` to start a NEW strut conversation; pass a `chatId` to CONTINUE one — strut keeps the whole transcript, so a follow-up can be short. " +
        "Runs in the BACKGROUND: this returns at once with the `chatId`, and strut's replies are posted into this conversation as they land — seconds to hours later, and possibly several (a long workflow run ends one reply with 'I'll report back' and the verdict arrives as a later one). " +
        "Tell the user it's underway; do NOT re-dispatch to fetch results and do NOT invent findings. " +
        "`status: 'busy'` means that chat is mid-turn — not a failure; wait for its reply, then continue. " +
        "Strut has a shell and can publish and run code on the swarm: dispatch only what the user asked for.",
      inputSchema: z.object({
        workspace: z.string().describe("Slug of the workspace whose strut to dispatch."),
        title: z.string().min(1).describe("Short label for this dispatch, shown on the result in this conversation."),
        prompt: z
          .string()
          .min(1)
          .describe(
            "The message for strut. For a NEW chat it must be self-contained — strut cannot see this conversation: state the goal, inputs/outputs, and any workflow names or run ids. When continuing, strut already has the earlier turns.",
          ),
        chatId: z
          .string()
          .optional()
          .describe(
            "Continue this strut chat (from an earlier dispatch or `list_strut_chats`). Omit to start a new one.",
          ),
      }),
      execute: async ({ workspace, title, prompt, chatId }) => {
        const target = await resolveStrut(ctx, workspace);
        if ("error" in target) return { status: "error", error: target.error };

        const callback = await setupCallback(ctx, {
          title,
          prompt,
          workspaceId: target.workspaceId,
          workspaceSlug: workspace,
          chatId,
        }).catch((e) => {
          console.error("[dispatch_strut] callback setup failed (non-fatal)", {
            error: e instanceof Error ? e.message : String(e),
          });
          return null;
        });

        let res: Response;
        try {
          res = await strutFetch(target, "/chat", {
            body: {
              message: prompt,
              ...(chatId ? { chatId } : { title }),
              ...(callback ? { callback: { url: callback.callbackUrl } } : {}),
            },
          });
        } catch (e) {
          if (callback) await failRun(callback.runId, "initiation_failed");
          console.error("[dispatch_strut] strut unreachable", {
            workspace,
            error: e instanceof Error ? e.message : String(e),
          });
          return { status: "error", error: `Could not reach strut on workspace '${workspace}'.` };
        }

        if (res.status === 409) {
          if (callback) await failRun(callback.runId, "chat_busy");
          return {
            status: "busy",
            chatId,
            note: "That strut chat has a turn in progress. Its reply will be posted here when it ends — continue the chat after that.",
          };
        }
        if (!res.ok) {
          if (callback) await failRun(callback.runId, `strut_http_${res.status}`);
          const detail = ((await res.json().catch(() => null)) as { error?: string } | null)?.error;
          return {
            status: "error",
            error:
              res.status === 404 && chatId
                ? `Strut chat '${chatId}' not found on workspace '${workspace}'.`
                : detail || `Strut returned HTTP ${res.status}.`,
          };
        }

        const accepted = (await res.json().catch(() => ({}))) as { chatId?: string; turn?: number; callback?: boolean };
        const strutChatId = accepted.chatId ?? chatId;
        console.log("[dispatch_strut] dispatched", {
          workspace,
          runId: callback?.runId ?? null,
          chatId: strutChatId,
          turn: accepted.turn,
          continued: !!chatId,
        });

        if (callback && accepted.callback !== true) {
          // The turn IS running — this strut just will never call back.
          await failRun(callback.runId, "strut_callbacks_unsupported");
          return {
            status: "dispatched_without_callback",
            chatId: strutChatId,
            note: "Strut accepted the message, but this swarm's strut is too old to post replies back here. Tell the user, and read the reply later with check_strut_chat.",
          };
        }
        if (!callback) {
          return {
            status: "dispatched_without_callback",
            chatId: strutChatId,
            note: "Dispatched outside a canvas conversation, so there is nowhere to post the reply. Read it with check_strut_chat.",
          };
        }

        await db.agentRun
          .update({
            where: { id: callback.runId },
            data: { sessionId: strutChatId, requestId: accepted.turn != null ? String(accepted.turn) : null },
          })
          .catch((e) =>
            console.warn("[dispatch_strut] chat id save failed (non-fatal)", {
              runId: callback.runId,
              error: e instanceof Error ? e.message : String(e),
            }),
          );
        if (chatId) {
          // Strut now calls the NEW url for this chat; older rows are dead.
          await db.agentRun
            .updateMany({
              where: {
                agentKind: STRUT_AGENT_KIND,
                workspaceId: target.workspaceId,
                sessionId: chatId,
                status: "PENDING",
                id: { not: callback.runId },
              },
              data: { status: "FAILED", error: "superseded" },
            })
            .catch(() => undefined);
        }

        return {
          status: "dispatched",
          chatId: strutChatId,
          note: "Strut is working in the background. Its replies will be posted into this conversation; do not call this tool again for the same request.",
        };
      },
    }),

    check_strut_chat: tool({
      description:
        "Read a strut chat's current status and its latest reply. A fallback — strut's replies are normally posted into this conversation on their own. Use it when the user asks how a dispatch is going, or when a reply seems overdue (a swarm restart drops it).",
      inputSchema: z.object({
        workspace: z.string().describe("Slug of the workspace whose strut hosts the chat."),
        chatId: z.string().describe("The strut chat id."),
      }),
      execute: async ({ workspace, chatId }) => {
        const target = await resolveStrut(ctx, workspace);
        if ("error" in target) return { status: "error", error: target.error };
        try {
          const res = await strutFetch(target, `/chat/${encodeURIComponent(chatId)}`);
          if (res.status === 404) return { status: "error", error: `Strut chat '${chatId}' not found.` };
          if (!res.ok) return { status: "error", error: `Strut returned HTTP ${res.status}.` };
          const { meta, messages } = (await res.json()) as {
            meta?: { title?: string; status?: string; currentTurn?: number; updatedAt?: string };
            messages?: unknown;
          };
          const reply = lastAssistantText(messages);
          return {
            chatId,
            title: meta?.title,
            // "live" = a turn is running now (a dispatch would be `busy`).
            chatStatus: meta?.status,
            turn: meta?.currentTurn,
            updatedAt: meta?.updatedAt,
            latestReply: reply && reply.length > MAX_REPLY_CHARS ? `${reply.slice(0, MAX_REPLY_CHARS)}…` : reply,
          };
        } catch (e) {
          console.error("[check_strut_chat] failed", { workspace, error: e instanceof Error ? e.message : String(e) });
          return { status: "error", error: `Could not reach strut on workspace '${workspace}'.` };
        }
      },
    }),

    list_strut_chats: tool({
      description: "List a workspace's strut chats (newest first) — to find a chat id to continue or check.",
      inputSchema: z.object({
        workspace: z.string().describe("Slug of the workspace whose strut to list."),
      }),
      execute: async ({ workspace }) => {
        const target = await resolveStrut(ctx, workspace);
        if ("error" in target) return { status: "error", error: target.error };
        try {
          const res = await strutFetch(target, "/chats");
          if (!res.ok) return { status: "error", error: `Strut returned HTTP ${res.status}.` };
          const chats = (await res.json()) as Array<{
            id: string;
            title?: string;
            status?: string;
            updatedAt?: string;
          }>;
          return {
            chats: (Array.isArray(chats) ? chats : []).slice(0, MAX_LISTED_CHATS).map((c) => ({
              chatId: c.id,
              title: c.title,
              chatStatus: c.status,
              updatedAt: c.updatedAt,
            })),
          };
        } catch (e) {
          console.error("[list_strut_chats] failed", { workspace, error: e instanceof Error ? e.message : String(e) });
          return { status: "error", error: `Could not reach strut on workspace '${workspace}'.` };
        }
      },
    }),
  };
}

/**
 * The `strut` capability's prompt snippet. Lives here rather than in
 * `@/lib/constants/prompt` (as `code_change`'s does in `capabilities.ts`):
 * that module is hand-mocked export-by-export across the canvas-agent tests.
 */
export function getStrutCapabilitySnippet(): string {
  return `

## Strut (workflow builder sub-agent)

Each workspace's swarm hosts **strut**, a workflow engine with its own AI builder — an agent that authors strut workflows (YAML) and custom steps, runs them, and evaluates their runs (run logs, outputs, claims and evidence). You dispatch that builder; you do not write strut workflows yourself.

### Tools

- **\`dispatch_strut({ workspace, title, prompt, chatId? })\`** — Send a message to a workspace's strut builder. Omit \`chatId\` to start a NEW strut chat; pass one to CONTINUE it (strut keeps the whole transcript). Returns immediately with the \`chatId\`.
- **\`check_strut_chat({ workspace, chatId })\`** — Read a chat's status and latest reply. A fallback, not the normal path.
- **\`list_strut_chats({ workspace })\`** — Find a chat id again.

### How replies arrive

\`dispatch_strut\` runs in the BACKGROUND — a strut turn takes seconds or hours. Strut's replies are posted into this conversation on their own, as assistant entries headed **Strut · <workspace> · chat \`<chatId>\`**. One dispatch can produce SEVERAL replies: a long workflow run ends a reply with "I'll report back", and the verdict arrives as a later one. An entry that ends with "Strut is still working" is interim — more is coming; do not act on it as the final answer.

After dispatching, tell the user it's underway and stop. Do NOT call \`dispatch_strut\` again for the same request, do NOT poll \`check_strut_chat\` in a loop, and do NOT invent results.

### Continuing a chat

Prefer continuing an existing chat (\`chatId\` from its header line) over starting a new one when the follow-up is about the same workflow — strut already has the context, so the message can be short. \`status: "busy"\` means that chat is mid-turn: not a failure. Wait for its reply to land, then continue.

### Prompting tips

- A NEW chat's prompt must be self-contained — strut cannot see this conversation. State the goal, the input and output shapes, and how to test it.
- To evaluate a run, name the workflow and the run id (e.g. from a workflow-benchmark run) and say what you want judged.
- Strut can list the secret NAMES its swarm has but cannot add one. If it reports a missing secret, relay that to the user — adding it is theirs to do.

### Caveats

- Strut has a shell and publishes and runs real code on the swarm. Dispatch only what the user asked for; never widen the task on your own.
- \`check_strut_chat\` is for when the user asks how a dispatch is going, or a reply seems overdue (a swarm restart can drop one).
`;
}
