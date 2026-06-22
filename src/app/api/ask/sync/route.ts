import { NextRequest, NextResponse, after } from "next/server";
import { randomUUID } from "crypto";
import { ModelMessage } from "ai";
import {
  validationError,
  serverError,
  forbiddenError,
  notFoundError,
  isApiError,
} from "@/types/errors";
import {
  validateUserBelongsToOrg,
  validateWorkspaceAccess,
} from "@/services/workspace";
import { getMiddlewareContext } from "@/lib/middleware/utils";
import { validateApiToken } from "@/lib/auth/api-token";
import { db } from "@/lib/db";
import { resolveMessageImageUrls } from "@/lib/ai/resolveMessageImages";
import {
  runCanvasAgent,
  extractConceptIdsFromStep,
} from "@/lib/ai/runCanvasAgent";
import type { OrgCapability } from "@/lib/ai/capabilities";
import type { DispatchedResearchIntent } from "@/lib/ai/researchTools";
import { toModelMessages } from "@/lib/ai/conversationHelpers";
import {
  messagesFromSteps,
  appendTurnMessages,
  normalizeStoredAttachments,
  type StoredAttachment,
} from "@/services/canvas-turn-persistence";
import { buildDeferredCheckTools } from "@/lib/ai/deferredCheckTools";
import {
  persistCanvasUserMessage,
  loadOrgCanvasPromptCache,
  fetchOrgCanvasConversationMessages,
  hasConcepts,
  persistOrgCanvasPromptCache,
} from "@/services/org-canvas-conversation";
import {
  PROPOSE_INITIATIVE_TOOL,
  PROPOSE_FEATURE_TOOL,
  PROPOSE_MILESTONE_TOOL,
} from "@/lib/proposals/types";

/**
 * Synchronous (non-streaming) canvas-agent turn. See
 * `docs/plans/ask-sync-endpoint.md`.
 *
 * Same engine, same persistence, different transport: this is the
 * `/api/ask/quick` org-canvas turn with the streaming response swapped
 * for an awaited JSON one. We `await result.steps` in-request (rather
 * than deferring the persist to `after()`), serialize the finished turn
 * to `StoredMessage[]`, and return it. Built for native-mobile /
 * agent-as-tool callers that want the canvas agent as a plain function,
 * and for external eval workflows (authenticated via `x-api-token`).
 *
 * ## Input modes
 *
 * - **Server-history** (`{ message, conversationId? }`): the server
 *   reconstructs prior turns from `conversationId` and appends the new
 *   `message`. Persists the turn (unless `dryRun`). The mobile path.
 * - **Replay** (`{ messages: ModelMessage[] }`): the caller supplies the
 *   FULL transcript verbatim (same shape as `/api/ask/quick`'s normal
 *   mode). Stateless: no conversation is read or written. Requires
 *   `dryRun: true` — a replayed transcript must never mutate state. The
 *   eval-harness path.
 *
 * ## dryRun (side-effect-free)
 *
 * `dryRun: true` runs the agent as a pure function and writes NOTHING:
 *   - no conversation row create / append, no prompt-cache write;
 *   - the agent runs `readonly` with the `propose_*` tools KEPT (those
 *     emit proposal cards without DB writes — the row is only created
 *     later at approval time — so an eval can inspect exactly what
 *     `propose_feature` produced), while every genuinely-mutating tool
 *     (canvas/feature/research/connection writes) is stripped;
 *   - the `planner` capability is dropped, so `send_to_feature_planner`
 *     (a real Stakwork dispatch) is absent;
 *   - no `schedule_check` tool, no research-worker dispatch, no Pusher.
 * The proposed content lands in the returned rows' `toolCalls[].output`.
 *
 * Because the whole generation runs in-request, give the function the
 * same generous headroom as quick — a turn longer than this is the only
 * failure mode.
 */
export const maxDuration = 800;

/** Pure-output proposal tools — kept even under the dryRun readonly strip. */
const PROPOSAL_TOOL_NAMES = [
  PROPOSE_INITIATIVE_TOOL,
  PROPOSE_FEATURE_TOOL,
  PROPOSE_MILESTONE_TOOL,
];

/** Normalize a client-supplied messages[] array into ModelMessage[]. */
function normalizeReplayMessages(messages: unknown[]): ModelMessage[] {
  return messages
    .map((m: any): ModelMessage | null => {
      let role = m?.role;
      if (!role || !["user", "assistant", "system", "tool"].includes(role)) {
        role = "user";
      }
      let content = m?.content;
      if (content === undefined || content === null) {
        if (role === "tool") return null;
        content = "";
      }
      return { role, content } as ModelMessage;
    })
    .filter((m: ModelMessage | null): m is ModelMessage => m !== null);
}

export async function POST(request: NextRequest) {
  try {
    // ── Auth: session member OR API_TOKEN (trusted service) ──────────
    // The route is `protected` by middleware default (no ROUTE_POLICIES
    // entry), so an unauthenticated request never reaches here UNLESS it
    // carries an `x-api-token` header (middleware lets those through with
    // `authStatus: "api-token"` for us to validate). We validate the
    // token value ourselves below; a present-but-wrong token falls
    // through to the 401.
    const context = getMiddlewareContext(request);
    const sessionUserId =
      context.authStatus === "authenticated" && context.user
        ? context.user.id
        : null;
    const isApiToken = validateApiToken(request);

    if (!sessionUserId && !isApiToken) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      message,
      messages: bodyMessages,
      conversationId,
      workspaceSlug,
      workspaceSlugs,
      orgId: bodyOrgId,
      currentCanvasRef,
      currentCanvasBreadcrumb,
      selectedNodeId,
      selectedNodeIds,
      attachments,
      dryRun: bodyDryRun,
    } = body;

    const dryRun = bodyDryRun === true;

    // Replay (eval) mode: a full verbatim transcript instead of a single
    // `message` + server-side history.
    const replayMessages =
      Array.isArray(bodyMessages) && bodyMessages.length > 0
        ? (bodyMessages as unknown[])
        : null;
    const isReplayMode = replayMessages !== null;

    if (isReplayMode) {
      // A replayed transcript is stateless (no conversation to persist to)
      // and must never mutate org state or dispatch external runs.
      if (!dryRun) {
        throw validationError(
          "messages[] replay mode requires dryRun: true (it is stateless and side-effect-free).",
        );
      }
    } else if (typeof message !== "string" || message.trim().length === 0) {
      throw validationError("Missing required parameter: message");
    }

    const slugs: string[] = Array.isArray(workspaceSlugs)
      ? workspaceSlugs.filter((s): s is string => typeof s === "string")
      : workspaceSlug
        ? [workspaceSlug]
        : [];

    if (slugs.length === 0) {
      throw validationError(
        "Missing required parameter: workspaceSlug or workspaceSlugs",
      );
    }
    if (slugs.length > 20) {
      throw validationError("Maximum 20 workspaces allowed per session");
    }

    const primarySlug = slugs[0];

    // Load the primary workspace once: its owner is the acting user under
    // API_TOKEN auth, and its `sourceControlOrgId` is the default org for
    // the canvas toolset / conversation row.
    const primaryWorkspace = await db.workspace.findFirst({
      where: { slug: primarySlug, deleted: false },
      select: { id: true, ownerId: true, sourceControlOrgId: true },
    });
    if (!primaryWorkspace) {
      throw notFoundError("Workspace not found");
    }

    // ── Resolve acting user ──────────────────────────────────────────
    let userId: string;
    if (sessionUserId) {
      userId = sessionUserId;
      // A member must have access to EVERY requested workspace.
      for (const slug of slugs) {
        const access = await validateWorkspaceAccess(slug, userId);
        if (!access.hasAccess) {
          throw forbiddenError(`Access denied for workspace: ${slug}`);
        }
      }
    } else {
      // API_TOKEN: act as the primary workspace owner. No per-slug
      // membership check — the token is the authority (mirrors
      // `requireAuthOrApiToken`'s workspace-owner pattern). External eval
      // workflows use this to score canvas-agent replies.
      userId = primaryWorkspace.ownerId;
    }

    // Org for the canvas toolset + conversation row. Prefer an explicit
    // body value, else derive from the primary workspace. Required: the
    // entire persistence path (conversation continuity) is org-scoped.
    const orgId: string | null =
      typeof bodyOrgId === "string" && bodyOrgId
        ? bodyOrgId
        : (primaryWorkspace.sourceControlOrgId ?? null);

    if (!orgId) {
      throw validationError(
        "Could not resolve an organization for this workspace. " +
          "The synchronous canvas endpoint requires a GitHub-org-linked workspace.",
      );
    }

    // Session callers must belong to the org (IDOR guard). API_TOKEN is
    // a trusted service credential and skips the membership check.
    if (sessionUserId) {
      const belongs = await validateUserBelongsToOrg(orgId, userId, "id");
      if (!belongs) {
        throw forbiddenError("Access denied for the specified organization");
      }
    }

    const isMultiWorkspace = slugs.length > 1;
    const turnId = randomUUID();

    // ── Build the ModelMessage[] for this turn ───────────────────────
    let convertedMessages: ModelMessage[];
    let userText = "";
    let userAttachments: StoredAttachment[] = [];

    if (isReplayMode) {
      // Replay: use the supplied transcript verbatim.
      convertedMessages = normalizeReplayMessages(replayMessages);
    } else {
      // Server-history: reconstruct prior turns + append the new message.
      const history = conversationId
        ? ((await fetchOrgCanvasConversationMessages({
            conversationId,
            userId,
            orgId,
          })) ?? [])
        : [];

      userText = message.trim();
      userAttachments = normalizeStoredAttachments(attachments);

      // Build the new user ModelMessage. With image attachments the content
      // is a multi-part array (`{type:"text"} + {type:"image"}`) mirroring
      // the web client's `toModelMessages`; `resolveMessageImageUrls`
      // rewrites the relative presigned-url paths into absolute signed URLs.
      const imageAttachments = userAttachments.filter((a) =>
        a.mimeType.startsWith("image/"),
      );
      const newUserMessage: ModelMessage =
        imageAttachments.length > 0
          ? ({
              role: "user",
              content: [
                ...(userText ? [{ type: "text", text: userText }] : []),
                ...imageAttachments.map((a) => ({
                  type: "image",
                  image: `/api/upload/presigned-url?s3Key=${encodeURIComponent(a.path)}`,
                })),
              ],
            } as ModelMessage)
          : ({ role: "user", content: userText } as ModelMessage);

      convertedMessages = [...toModelMessages(history), newUserMessage];
    }

    await resolveMessageImageUrls(convertedMessages);

    // Org-canvas prompt cache (read-only; speeds up by skipping the swarm
    // `listConcepts` call). No-ops without a conversationId (replay mode).
    const promptCache = await loadOrgCanvasPromptCache({
      conversationId,
      userId,
      orgId,
    });

    // ── Persist the user message (creates the row on the first turn) ──
    // Skipped entirely in dryRun — a dry run writes nothing.
    let rowId: string | null = null;
    if (!dryRun) {
      rowId = await persistCanvasUserMessage({
        orgId,
        userId,
        existingRowId: promptCache?.rowId ?? null,
        turnId,
        content: userText,
        attachments: userAttachments,
        workspaceSlugs: slugs,
      });
    }

    // Per-user canvas-chat model preference (set from the Agent settings
    // gear). Null/absent → aieo default.
    const chatAgentModel =
      (
        await db.user.findUnique({
          where: { id: userId },
          select: { chatAgentModel: true },
        })
      )?.chatAgentModel ?? undefined;

    try {
      const learnedConceptIds = new Set<string>();
      const dispatchedResearch: DispatchedResearchIntent[] = [];

      // dryRun composes a side-effect-free toolset: the org canvas agent
      // with write tools stripped, EXCEPT the pure-output `propose_*` tools
      // (kept so evals can read the proposed feature/initiative), and with
      // the `planner` capability dropped so `send_to_feature_planner` (a
      // real Stakwork dispatch) is absent. A live turn runs the full agent.
      const agentOptions = dryRun
        ? {
            // Always enable the org toolset in dryRun so `propose_*` exists,
            // regardless of single- vs multi-workspace.
            orgId,
            capabilities: ["canvas"] as readonly OrgCapability[],
            readonly: true,
            keepWriteToolNames: PROPOSAL_TOOL_NAMES,
            silentPusher: true,
          }
        : {
            // Org tools merge only for the multi-workspace org canvas —
            // matches `/api/ask/quick`. A single-workspace live turn runs
            // the plain per-workspace agent.
            orgId: isMultiWorkspace ? orgId : undefined,
            silentPusher: false,
          };

      const { result, assembledPrefix, cacheableConcepts, cacheHit } =
        await runCanvasAgent({
          userId,
          ...agentOptions,
          workspaceSlugs: slugs,
          modelName: chatAgentModel,
          cachedConcepts: promptCache?.cachedConcepts ?? null,
          scope: {
            currentCanvasRef:
              typeof currentCanvasRef === "string"
                ? currentCanvasRef
                : undefined,
            currentCanvasBreadcrumb:
              typeof currentCanvasBreadcrumb === "string"
                ? currentCanvasBreadcrumb
                : undefined,
            selectedNodeId:
              typeof selectedNodeId === "string" ? selectedNodeId : undefined,
            selectedNodeIds: Array.isArray(selectedNodeIds)
              ? (selectedNodeIds as unknown[]).filter(
                  (x): x is string => typeof x === "string",
                )
              : undefined,
          },
          messages: convertedMessages,
          // The server-owned org-canvas row (live turns only) — what
          // `send_to_feature_planner` lazy-claims for fan-out and what
          // `schedule_check` keys off. Undefined in dryRun (no row).
          ...(rowId ? { currentCanvasConversationId: rowId } : {}),
          dispatchedResearch,
          // schedule_check creates a DeferredAction row — a write. Inject it
          // only on a live turn with a resolved conversation row.
          ...(!dryRun && rowId
            ? {
                additionalTools: buildDeferredCheckTools({
                  conversationId: rowId,
                  orgId,
                  userId,
                }),
              }
            : {}),
          hooks: {
            onStepFinish: (sf) => {
              extractConceptIdsFromStep(sf.content).forEach((id) =>
                learnedConceptIds.add(id),
              );
            },
          },
        });

      // ── The one difference vs. quick: await the generation in-request
      // rather than streaming it back. `consumeStream()` drives the run to
      // completion (no abort signal is wired, so a client disconnect can't
      // cancel it); `steps` then resolves with the full tool-call trace.
      await result.consumeStream();
      const steps = await result.steps;

      const assistantPrefix = `${turnId}-a`;
      const rows = messagesFromSteps(
        steps as Parameters<typeof messagesFromSteps>[0],
        assistantPrefix,
      );

      // ── Persistence + async tail — live turns only ───────────────────
      let title: string | undefined;
      if (!dryRun && rowId) {
        await appendTurnMessages({
          conversationId: rowId,
          rows,
          idPrefix: assistantPrefix,
          reason: "user-turn",
        });

        // Persist the freshly-fetched concepts so the next turn can reuse
        // them and skip the swarm `listConcepts` call. Only on a cache MISS
        // with non-empty concepts (a swarm outage yields an empty list;
        // caching that would poison the cache). Best-effort, off-response.
        if (!cacheHit && hasConcepts(cacheableConcepts)) {
          const cacheRowId = rowId;
          after(async () => {
            try {
              await persistOrgCanvasPromptCache(
                cacheRowId,
                cacheableConcepts,
                assembledPrefix,
              );
            } catch (err) {
              console.error(
                "❌ [sync-ask] Failed to persist prompt cache:",
                err,
              );
            }
          });
        }

        // Schedule research sub-agent workers for each dispatched intent.
        // Their replies land on the conversation later (the "async tail" —
        // see the plan); the sync response only carries what finished now.
        if (dispatchedResearch.length > 0) {
          after(async () => {
            const { runResearchSubAgent } = await import(
              "@/services/canvas-research-worker"
            );
            for (const intent of dispatchedResearch) {
              await runResearchSubAgent({ ...intent, workspaceSlugs: slugs });
            }
          });
        }

        title =
          (
            await db.sharedConversation.findUnique({
              where: { id: rowId },
              select: { title: true },
            })
          )?.title ?? undefined;
      }

      return NextResponse.json({
        conversationId: rowId,
        messages: rows,
        ...(title ? { title } : {}),
        ...(dryRun ? { dryRun: true } : {}),
      });
    } catch (agentError) {
      // Preserve typed ApiError statuses from the inner pipeline; only
      // unknown / generation setup failures get wrapped as 500.
      if (isApiError(agentError)) {
        throw agentError;
      }
      console.error("❌ [sync-ask] Agent run failed:", {
        error: agentError,
        message:
          agentError instanceof Error
            ? agentError.message
            : String(agentError),
        workspaces: slugs,
      });
      throw serverError("Failed to run canvas agent");
    }
  } catch (error) {
    if (isApiError(error)) {
      return NextResponse.json(
        { error: error.message, kind: error.kind, details: error.details },
        { status: error.statusCode },
      );
    }
    console.error("❌ [sync-ask] Unhandled error:", error);
    return NextResponse.json(
      { error: "Failed to process sync ask" },
      { status: 500 },
    );
  }
}
