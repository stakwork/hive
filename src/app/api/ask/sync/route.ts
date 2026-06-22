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
import type { DispatchedResearchIntent } from "@/lib/ai/researchTools";
import { toModelMessages } from "@/lib/ai/conversationHelpers";
import {
  messagesFromSteps,
  appendTurnMessages,
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
 * Because the whole generation runs in-request, give the function the
 * same generous headroom as quick — a turn longer than this is the only
 * failure mode.
 */
export const maxDuration = 800;

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
      conversationId,
      workspaceSlug,
      workspaceSlugs,
      orgId: bodyOrgId,
      currentCanvasRef,
      currentCanvasBreadcrumb,
      selectedNodeId,
      selectedNodeIds,
      attachments,
    } = body;

    if (typeof message !== "string" || message.trim().length === 0) {
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

    // ── Build messages: server-history + the new user turn ───────────
    const promptCache = await loadOrgCanvasPromptCache({
      conversationId,
      userId,
      orgId,
    });

    const history = conversationId
      ? ((await fetchOrgCanvasConversationMessages({
          conversationId,
          userId,
          orgId,
        })) ?? [])
      : [];

    const userText = message.trim();

    // Normalize forwarded attachments into the stored shape (drop anything
    // missing required fields). Persisted with the user row so they survive
    // reload, and embedded as image parts so the model sees them this turn.
    const userAttachments: StoredAttachment[] = Array.isArray(attachments)
      ? (attachments as unknown[]).flatMap((a) => {
          if (!a || typeof a !== "object") return [];
          const r = a as Record<string, unknown>;
          if (
            typeof r.path !== "string" ||
            typeof r.filename !== "string" ||
            typeof r.mimeType !== "string" ||
            typeof r.size !== "number"
          ) {
            return [];
          }
          return [
            {
              path: r.path,
              filename: r.filename,
              mimeType: r.mimeType,
              size: r.size,
            },
          ];
        })
      : [];

    // Build the new user ModelMessage. With image attachments the content
    // is a multi-part array (`{type:"text"} + {type:"image"}`) mirroring the
    // web client's `toModelMessages`; `resolveMessageImageUrls` rewrites the
    // relative presigned-url paths into absolute signed S3 URLs.
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

    const convertedMessages: ModelMessage[] = [
      ...toModelMessages(history),
      newUserMessage,
    ];

    await resolveMessageImageUrls(convertedMessages);

    // ── Persist the user message (creates the row on the first turn) ──
    const rowId = await persistCanvasUserMessage({
      orgId,
      userId,
      existingRowId: promptCache?.rowId ?? null,
      turnId,
      content: userText,
      attachments: userAttachments,
      workspaceSlugs: slugs,
    });

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

      const { result, assembledPrefix, cacheableConcepts, cacheHit } =
        await runCanvasAgent({
          userId,
          // Org tools (canvas/initiative/connections) merge only for the
          // multi-workspace org canvas — matches `/api/ask/quick`. A
          // single-workspace turn runs the plain per-workspace agent.
          orgId: isMultiWorkspace ? orgId : undefined,
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
          // The server-owned org-canvas row — what `send_to_feature_planner`
          // lazy-claims for fan-out and what `schedule_check` keys off.
          currentCanvasConversationId: rowId,
          // A sync turn should still animate any open web canvas tab
          // (HIGHLIGHT_NODES etc.) — it's the same conversation.
          silentPusher: false,
          dispatchedResearch,
          additionalTools: buildDeferredCheckTools({
            conversationId: rowId,
            orgId,
            userId,
          }),
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

      await appendTurnMessages({
        conversationId: rowId,
        rows,
        idPrefix: assistantPrefix,
        reason: "user-turn",
      });

      // Persist the freshly-fetched concepts so the next turn can reuse them
      // and skip the swarm `listConcepts` call. Only on a cache MISS with
      // non-empty concepts (a swarm outage yields an empty list; caching
      // that would poison the cache). Best-effort, off the response path.
      if (!cacheHit && hasConcepts(cacheableConcepts)) {
        after(async () => {
          try {
            await persistOrgCanvasPromptCache(
              rowId,
              cacheableConcepts,
              assembledPrefix,
            );
          } catch (err) {
            console.error("❌ [sync-ask] Failed to persist prompt cache:", err);
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

      const title =
        (
          await db.sharedConversation.findUnique({
            where: { id: rowId },
            select: { title: true },
          })
        )?.title ?? undefined;

      return NextResponse.json({
        conversationId: rowId,
        messages: rows,
        ...(title ? { title } : {}),
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
