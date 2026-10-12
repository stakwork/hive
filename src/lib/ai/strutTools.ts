/**
 * Strut sub-agent tools — the canvas agent dispatching a workspace swarm's
 * strut AI builder (the workflow-authoring assistant mounted at the swarm's
 * `/lab`, see strut `AGENTS.md`).
 *
 *   - `dispatch_strut`   — start a strut chat, or continue one by `chatId`.
 *   - `check_strut_chat` — read a chat's status + latest reply (fallback).
 *   - `list_strut_chats` — find a chat id again.
 *   - `start_job` / `continue_job` — a JOB on the org's strut (below).
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
 *
 * ## Jobs (strut `plans/jobs.md`, V1)
 *
 * The builder chat is the wrong shape for work the person will ITERATE on
 * — a plan, a document, a page. That is a *job*: `start_job` mints an id
 * and launches the seeded `job` workflow as a `StrutRun` (`kind:
 * "job_turn"`, `services/strut-runs.ts`) with the id on the launch; strut
 * keeps one directory and one agent thread per job, the agent writes its
 * deliverables as files there, and the run's callback carries them as
 * links. `continue_job` is the same launch with the same id — the next
 * turn of the same job, revising the same files behind the same links.
 * The reply is ONE assistant row per turn in this conversation
 * (`services/strut-runs/job-turn.ts`): a header the model reads the job id
 * back from, the agent's text, and `artifacts` on the row (the cards).
 *
 * Hive's side is a CLOSED contract — start / continue, one handler, one
 * artifact reader — on purpose: what a job can do grows on the swarm, as
 * new versions of the `job` workflow (its `params.tools` / `system`),
 * never as capability-specific fields here. The prompt is the user's
 * request as they said it: HOW each kind of work is done (a plan, a page, a
 * code change) is the swarm's business — the job's agent has its own pages
 * for it — so hive adds no format, outline or rules of its own; a spec
 * written here would override those pages, and the agent cannot tell the
 * assistant's words from the user's. The one thing hive hands over
 * besides the prompt is the USER's standing credential: every turn pushes
 * their GitHub token to strut as that actor's `GITHUB_TOKEN` before the
 * launch (`ensureStrutActorSecrets`), so a
 * turn that runs the swarm's code-change workflow checks out, pushes and
 * opens the pull request as them — strut binds every nested run's secrets
 * to the job's principal. Which turns need it is the job's business.
 */

import { tool, type ToolSet } from "ai";
import { z } from "zod";
import crypto from "crypto";
import { StrutRunStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { JOB_TURN_KIND, jobTitleOf } from "@/lib/strut-jobs";
import { resolveOrgConversationRowId } from "@/services/org-canvas-conversation";
import { STRUT_ACTOR_HEADER, ensureStrutDelegation } from "@/services/bifrost/strut-delegation";
import { BUSY_NOTE, launchJobTurn } from "@/services/strut-jobs";
import { resolveStrutTarget, type StrutPurpose, type StrutTarget } from "@/services/strut-target";
import type { CapabilityContext } from "./capabilities";

export const DISPATCH_STRUT_TOOL = "dispatch_strut";
export const START_JOB_TOOL = "start_job";
export const CONTINUE_JOB_TOOL = "continue_job";
export const STRUT_AGENT_KIND = "strut_chat";

const STRUT_TIMEOUT_MS = 15_000;
/** Cap on the reply text `check_strut_chat` hands the model. */
const MAX_REPLY_CHARS = 20_000;
const MAX_LISTED_CHATS = 30;

/**
 * Resolve the strut for a workspace (`resolveStrutTarget`, purpose "chat" —
 * today the ORG's default swarm, whichever workspace is named; the policy
 * lives in `strut-target.ts`), validating that the acting user can reach
 * that swarm's workspace AND that it belongs to the active org — before any
 * swarm credential is touched. `target.actor` is who strut bills: the
 * acting user's actor string — the macaroon `user_id` (`buildBifrostName`),
 * NOT the raw `User.id` — sent as `x-strut-actor`; mcp trusts it because
 * the swarm key proves it is hive.
 */
async function resolveStrut(
  ctx: CapabilityContext,
  workspaceSlug: string,
  purpose: StrutPurpose = "chat",
): Promise<StrutTarget | { error: string }> {
  const resolved = await resolveStrutTarget({ purpose, workspaceSlug, userId: ctx.userId });
  if (!resolved.ok) {
    const { type } = resolved.error;
    return {
      error:
        type === "WORKSPACE_NOT_FOUND" || type === "ACCESS_DENIED"
          ? `Workspace '${workspaceSlug}' not found, or you do not have access to it.`
          : type === "NO_ORG_SWARM"
            ? `No workspace in the org of '${workspaceSlug}' has an active swarm you can reach, so it has no strut.`
            : `Workspace '${workspaceSlug}' has no active swarm, so it has no strut.`,
    };
  }
  if (resolved.target.orgId !== ctx.orgId) {
    return { error: `Workspace '${workspaceSlug}' does not belong to the active org.` };
  }
  return resolved.target;
}

async function strutFetch(target: StrutTarget, path: string, init?: { body: unknown }): Promise<Response> {
  return fetch(`${target.labBase}${path}`, {
    method: init ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      "x-api-token": target.swarmApiKey,
      [STRUT_ACTOR_HEADER]: target.actor,
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

/** Where a job's replies land: the canvas conversation this turn is in, owned by the caller, and a public Hive URL for strut to post to. */
async function jobDelivery(ctx: CapabilityContext): Promise<{ conversationId: string; publicBaseUrl: string } | { status: "error"; error: string }> {
  if (!ctx.publicBaseUrl) {
    return { status: "error", error: "Jobs need a public Hive URL for strut to post replies to; none is configured here." };
  }
  if (!ctx.currentCanvasConversationId) {
    return { status: "error", error: "A job replies into a canvas conversation, and this turn is not in one." };
  }
  const conversationId = await resolveOrgConversationRowId({
    conversationId: ctx.currentCanvasConversationId,
    userId: ctx.userId,
    orgId: ctx.orgId,
  });
  if (!conversationId) return { status: "error", error: "This conversation is not one a job can reply into." };
  return { conversationId, publicBaseUrl: ctx.publicBaseUrl };
}

export function buildStrutTools(ctx: CapabilityContext): ToolSet {
  return {
    [DISPATCH_STRUT_TOOL]: tool({
      description:
        "Dispatch the org's strut AI builder — the workflow-authoring agent on the org's default swarm (one strut per org). " +
        "It builds and revises strut workflows and custom steps, runs them, and evaluates their runs (run logs, outputs, claims/evidence). " +
        "This is where a 'workflow' request goes by default: unless the user explicitly names Stakwork, a workflow to build, change, run, or evaluate is a strut workflow — not a Stakwork one. " +
        "Omit `chatId` to start a NEW strut conversation; pass a `chatId` to CONTINUE one — strut keeps the whole transcript, so a follow-up can be short. " +
        "Runs in the BACKGROUND: this returns at once with the `chatId`, and strut's replies are posted into this conversation as they land — seconds to hours later, and possibly several (a long workflow run ends one reply with 'I'll report back' and the verdict arrives as a later one). " +
        "Tell the user it's underway; do NOT re-dispatch to fetch results and do NOT invent findings. " +
        "`status: 'busy'` means that chat is mid-turn — not a failure; wait for its reply, then continue. " +
        "Strut has a shell and can publish and run code on the swarm: dispatch only what the user asked for.",
      inputSchema: z.object({
        workspace: z.string().describe("Slug of the workspace the work is for — any workspace in the active org; it selects that org's strut."),
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

        // The chat's LLM spend is billed to the acting user through the
        // Mothership once strut holds their standing delegation. Behind the
        // Bifrost gates; never throws, never blocks the dispatch. Also runs
        // with no live session (automations, the strut auto-turn) — the
        // user is attributed, not present; the custodial key signs.
        await ensureStrutDelegation(
          { workspaceId: target.workspaceId, workspaceSlug: target.workspaceSlug, userId: ctx.userId },
          { swarmUrl: target.swarmUrl, swarmApiKey: target.swarmApiKey },
          { actor: target.actor },
        );

        const callback = await setupCallback(ctx, {
          title,
          prompt,
          // The RESOLVED workspace — the swarm the chat lives on, which the
          // reply header shows and `check_strut_chat` resolves again — not
          // necessarily the slug Jamie named (strut-target.ts).
          workspaceId: target.workspaceId,
          workspaceSlug: target.workspaceSlug,
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
        workspace: z.string().describe("The workspace slug from the chat's header line (any workspace in the active org reaches the same strut)."),
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
      description: "List the org's strut chats (newest first) — to find a chat id to continue or check.",
      inputSchema: z.object({
        workspace: z.string().describe("Slug of a workspace in the active org (it selects that org's strut)."),
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

    [START_JOB_TOOL]: tool({
      description:
        "Start a JOB on the org's strut: an agent that works on something the user will ITERATE on — a plan, a document, a page, or a CODE CHANGE delivered as a pull request — over many turns, " +
        "in one directory it keeps for the job, with a thread that remembers every earlier turn. It writes its deliverables as files and they land in this conversation as artifact cards. " +
        "Name the workspaces the work is about as `@<slug>` in the prompt: the job runs on the org's strut, which reads the org's default workspace itself and every other workspace through that workspace's own strut, by slug. " +
        "A question heading toward a change is a job too: start it with the question, and the job explores, keeps what it found as a note (a card here), and builds from that note on the next turn. " +
        "For a code change, name the workspace and, when you know it, the repository URL (https://github.com/owner/repo): the job's agent runs the swarm's code-change workflow as the user and the pull request lands here as a card; a follow-up revises that same pull request. " +
        "A code-change job is for a focused change in ONE repository; work across several repositories, or a schema change or data migration, goes through `propose_feature` instead. Name the workspace the code actually lives in; if you would be guessing between workspaces, ask the user or use `propose_feature` — never pick a repository just because it is the workspace's first one. " +
        "Runs in the BACKGROUND: this returns at once with the `jobId`; the reply is posted into this conversation as a **Job** entry — seconds to minutes later. " +
        "Tell the user it's underway and stop; do NOT call this again for the same request and do NOT invent results. " +
        "To revise what a job produced, use `continue_job` with its `jobId` (in the reply's header line) — not a new job. " +
        "For building strut WORKFLOWS, use `dispatch_strut` instead.",
      inputSchema: z.object({
        workspace: z.string().describe("Slug of the workspace the work is for — any workspace in the active org; it selects that org's strut."),
        title: z.string().min(1).max(120).describe("Short label for the job, shown on every reply of it."),
        prompt: z
          .string()
          .min(1)
          .describe(
            "The user's request, in their own words — forward it as they said it. " +
              "Add only what the job's agent cannot see (this conversation, and how the org's workspaces fit together): the workspaces the work is about as `@<slug>`; for a code change, the repository URL when you know it; a thing the user pointed at. " +
              "Never paste what you found with repo_agent: the job explores for itself and keeps its findings as a note. " +
              "Never add a format, a file type, an outline, sections or rules of your own: how each kind of work is done — a plan, a page, a code change — is the swarm's business, and the job's agent has its own pages for it. A spec from you overrides them.",
          ),
      }),
      execute: async ({ workspace, title, prompt }) => {
        const target = await resolveStrut(ctx, workspace, "job");
        if ("error" in target) return { status: "error", error: target.error };
        const delivery = await jobDelivery(ctx);
        if ("error" in delivery) return delivery;
        const jobId = crypto.randomUUID();
        return launchJobTurn({ userId: ctx.userId, workspaceId: target.workspaceId, ...delivery }, { jobId, title, prompt, started: true });
      },
    }),

    [CONTINUE_JOB_TOOL]: tool({
      description:
        "The next turn of a JOB started with `start_job`: the same agent, in the same directory, with the whole thread in memory — so 'revise step 2' or 'also rename the helper' is enough (a code-change job revises its pull request). " +
        "The reply (and the revised artifacts, under the same ids) lands in this conversation as a **Job** entry; tell the user it's underway and stop. " +
        "`status: 'busy'` means the job's previous turn is still running — not a failure; wait for its reply, then continue. " +
        "Only the person who started a job can continue it.",
      inputSchema: z.object({
        workspace: z.string().describe("Slug of a workspace in the active org (it selects the org's strut)."),
        jobId: z.string().min(1).max(120).describe("The job id from the reply's header line (**Job · <jobId> · …**)."),
        prompt: z.string().min(1).describe("This turn's message, in the user's own words. The agent remembers the earlier turns, so it can be short."),
      }),
      execute: async ({ workspace, jobId, prompt }) => {
        const target = await resolveStrut(ctx, workspace, "job");
        if ("error" in target) return { status: "error", error: target.error };
        const delivery = await jobDelivery(ctx);
        if ("error" in delivery) return delivery;

        // The job must be THIS user's, in the active org: its first turn's
        // row says who started it and for which workspace.
        const first = await db.strutRun.findFirst({
          where: { jobId, kind: JOB_TURN_KIND, userId: ctx.userId },
          orderBy: { createdAt: "asc" },
          select: { id: true, workspaceId: true, swarmId: true, input: true },
        });
        const notYours = { status: "error", error: `No job '${jobId}' of yours in this org.` };
        if (!first) return notYours;
        const workspaceRow = await db.workspace.findFirst({
          where: { id: first.workspaceId, sourceControlOrgId: ctx.orgId, deleted: false },
          select: { id: true },
        });
        if (!workspaceRow) return notYours;
        // The job's directory and thread live on the strut that ran its
        // first turn; a turn elsewhere would start cold.
        if (first.swarmId !== target.swarmId) {
          return { status: "error", error: "That job lives on another swarm's strut, so it cannot be continued from here." };
        }
        const live = await db.strutRun.findFirst({
          where: { jobId, kind: JOB_TURN_KIND, status: StrutRunStatus.PENDING },
          select: { id: true },
        });
        if (live) return { status: "busy", jobId, note: BUSY_NOTE };

        return launchJobTurn({ userId: ctx.userId, workspaceId: target.workspaceId, ...delivery }, { jobId, title: jobTitleOf(first), prompt, started: false });
      },
    }),
  };
}

/**
 * The `strut` capability's prompt snippet. Lives here rather than in
 * `@/lib/constants/prompt`: that module is hand-mocked export-by-export
 * across the canvas-agent tests.
 */
export function getStrutCapabilitySnippet(): string {
  return `

## Strut (workflow builder sub-agent)

Each org's default swarm hosts **strut**, a workflow engine with its own AI builder — an agent that authors strut workflows (YAML) and custom steps, runs them, and evaluates their runs (run logs, outputs, claims and evidence). You dispatch that builder; you do not write strut workflows yourself.

**"Workflow" means strut by default.** Unless the user explicitly names Stakwork, a workflow to build, revise, run, or evaluate — and a workflow run to check on — is a strut workflow and goes through these tools: not the Stakwork workflow library (\`workflow_explorer_agent\`), not the stakwork workspace's \`stakwork__*\` tools, and not a feature in the stakwork workspace.

### Tools

- **\`dispatch_strut({ workspace, title, prompt, chatId? })\`** — Send a message to the org's strut builder (\`workspace\` is the workspace the work is for; every workspace in the org reaches the same strut). Omit \`chatId\` to start a NEW strut chat; pass one to CONTINUE it (strut keeps the whole transcript). Returns immediately with the \`chatId\`.
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

### Jobs

For something the user will ITERATE on — a plan, a document, a page, a code change the user wants as a pull request — start a **job** instead of a builder chat: **\`start_job({ workspace, title, prompt })\`**. A job is one agent with one directory and one memory for as long as the job lives: it writes its deliverables as files there and they land in this conversation as artifact cards on a **Job · \`<jobId>\` · <title>** entry. To revise them — "split step 2 in two", "make the page darker" — call **\`continue_job({ workspace, jobId, prompt })\`** with the id from that header line: the same files come back under the same ids, a version newer. Never start a second job for a revision.

- **The prompt is the user's words.** Forward their request as they said it. Add only what the job's agent cannot see: the workspaces it is about as \`@<slug>\`, the repository URL for a code change, the thing they pointed at. Do not add a format, a file type, an outline or rules of your own — how each kind of work is done (a plan, a page, a code change) is the swarm's business, the job's agent has its own pages for it, and a spec from you overrides them; it cannot tell your words from the user's.
- Replies land in this conversation on their own, seconds to minutes later: tell the user it's underway and stop. Do not poll, do not re-dispatch, do not invent results.
- **A Job entry is the record; your words are the reply.** The entry is written in detail (a code change lists files, functions and line numbers) and the chat shows it collapsed — the user expands it only to check. When one lands (you may be woken for it) or the user asks about it, answer with ONE short paragraph in your own words: what the job produced, the question it asked if any, and the next step. Never restate the entry, never list files, functions or line numbers, never describe the cards — the user sees them.
- A Job entry that carries a **Question for you** is the agent stopping for a decision; the user's answer goes back as the next \`continue_job\` prompt.
- \`status: "busy"\` means the job's previous turn is still running — wait for its reply, then continue.
- **Name workspaces as \`@<slug>\`.** The job runs on the org's strut, which sits on the org's default workspace and reaches every other workspace's graph and repositories through that workspace's own strut, by slug. You know how the org's workspaces fit together; the job does not. When the request is about code in a workspace, write \`@<slug>\` in the prompt so the job looks there.
- **Let the job explore.** When a question is heading toward a change ("how does billing retry? we want to change it"), start the job with the question instead of answering it with \`repo_agent\` first. The job explores, keeps what it found as a note in the job (a card here), and the change starts from that note on the next turn. Never paste your own findings into a job prompt: the note is the record. \`repo_agent\` stays for a quick answer the user will not build on.
- **A code change is a job.** Name the workspace the code lives in as \`@<slug>\`, and the repository URL when you know it (the user named it, or you found it). If you are guessing between workspaces, ask the user first. The job's agent runs the swarm's code-change workflow with the user's own GitHub token; the pull request lands here as a card, and "also rename the helper" is a \`continue_job\` that revises the same pull request. Work across several repositories, or a schema migration, goes through \`propose_feature\` instead.
- \`dispatch_strut\` stays for building and running strut WORKFLOWS; \`start_job\` is for producing something.

### Caveats

- Strut has a shell and publishes and runs real code on the swarm. Dispatch only what the user asked for; never widen the task on your own.
- \`check_strut_chat\` is for when the user asks how a dispatch is going, or a reply seems overdue (a swarm restart can drop one).
`;
}
