import { NextRequest, NextResponse, after } from "next/server";
import { validationError, serverError, forbiddenError, isApiError } from "@/types/errors";
import { validateUserBelongsToOrg } from "@/services/workspace";
import { ModelMessage, generateObject } from "ai";
import { getModel, getApiKeyForProvider } from "@/lib/ai/provider";
// Deep import — see comment in services/task-workflow.ts.
import { getBifrostForLLM } from "@/services/bifrost/orchestrator";
import { z } from "zod";
import { getWorkspaceChannelName, PUSHER_EVENTS, pusherServer } from "@/lib/pusher";
import { getMiddlewareContext } from "@/lib/middleware/utils";
import { resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import {
  checkPublicChatBudget,
  deriveAnonymousId,
  recordTurnTokens,
} from "@/lib/ai/publicChatBudget";
import { db } from "@/lib/db";
import {
  handleApproval,
  handleRejection,
  type MessageLike,
} from "@/lib/proposals/handleApproval";
import type {
  ApprovalIntent,
  RejectionIntent,
} from "@/lib/proposals/types";
import {
  runCanvasAgent,
  extractConceptIdsFromStep,
  type CachedConcepts,
} from "@/lib/ai/runCanvasAgent";
import type { DispatchedResearchIntent } from "@/lib/ai/researchTools";
import { swarmFetch } from "@/lib/ai/concepts";
import { generateTitle } from "@/lib/ai/conversationHelpers";
import {
  messagesFromSteps,
  appendTurnMessages,
  type StoredMessage,
} from "@/services/canvas-turn-persistence";

// Tier-1 backend-driven canvas turns (docs/plans/backend-driven-canvas-turns.md):
// the org-canvas turn is persisted server-side in `after()` so it survives the
// browser closing mid-stream. `after()` runs inside this invocation, so give
// the function generous headroom — a turn longer than this is the only case a
// closed-tab turn can be lost (Vercel doesn't kill in-flight functions on
// deploy, and `runCanvasAgent` passes no abort signal, so a client disconnect
// can't cancel generation).
export const maxDuration = 300;

/**
 * Provenance data types
 */
interface ProvenanceData {
  concepts: Array<{
    refId: string;
    name: string;
    description?: string;
    files: Array<{
      refId: string;
      name: string;
      path: string;
      codeEntities: Array<{
        refId: string;
        name: string;
        nodeType: string;
        file: string;
        start: number;
        end: number;
      }>;
    }>;
  }>;
}

/**
 * Fetch provenance data from stakgraph
 */
async function fetchProvenance(swarmUrl: string, apiKey: string, conceptIds: string[]): Promise<ProvenanceData> {
  const response = await swarmFetch(`${swarmUrl}/gitree/provenance`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-token": apiKey,
    },
    body: JSON.stringify({ conceptIds }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch provenance: ${response.status}`);
  }

  return response.json();
}

export async function POST(request: NextRequest) {
  try {
    const context = getMiddlewareContext(request);
    const isAuthenticated =
      context.authStatus === "authenticated" && !!context.user;
    const userId = isAuthenticated ? context.user!.id : null;

    const body = await request.json();
    const {
      messages,
      workspaceSlug,
      workspaceSlugs,
      orgId,
      // Canvas page hints — only meaningful with `orgId`. All
      // optional; the prompt builder injects them as a small "current
      // scope" section when present. The breadcrumb is a precomputed
      // human-readable trail (e.g. "Acme › Auth Refactor") so the
      // agent can refer to the scope by name in replies.
      currentCanvasRef,
      currentCanvasBreadcrumb,
      selectedNodeId,
      selectedNodeIds,
      // When true, skip the post-stream `after()` enrichment block
      // (follow-up questions + provenance). Surfaces that don't render
      // either (e.g. the org-canvas SidebarChat) opt in to save tokens
      // and avoid an unnecessary stakgraph round-trip.
      skipEnrichments,
      // Agent-proposal flow (see `src/lib/proposals/`). Set on the
      // user's send when they click Approve / Reject in a
      // `<ProposalCard>`. The route runs the side effect synchronously
      // BEFORE the LLM call (and skips the LLM entirely when the intent
      // is fully self-contained). The `canvasChatMessages` field carries
      // the chat-side raw transcript so the handler can scan for the
      // matching propose tool call and run its idempotency check —
      // `messages` (AI SDK ModelMessage[]) doesn't preserve the
      // structured intent fields.
      approvalIntent,
      rejectionIntent,
      canvasChatMessages,
      // Optional. When the dashboard chat already created a
      // SharedConversation row (autosave, on the first send of a
      // session), it passes the id back so we can attribute the
      // turn's `usage.{input,output}Tokens` to that row in
      // `onFinish`. For public viewers the row is also where the
      // rate-limit gate sums recent spend, so passing it through is
      // important from message 2+.
      conversationId,
      // Backend-driven canvas turns (org-canvas only). A client-
      // generated id stamped on every send; the server persists the
      // user row as `${turnId}-u` and the assistant rows as
      // `${turnId}-a*`, and the client filters its own turn out of the
      // live-sync merge by this prefix. Absent → legacy client-driven
      // persistence (dashboard chat, public viewers, older clients).
      turnId,
    } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      throw validationError("Missing required parameter: messages (must be a non-empty array)");
    }

    // Normalize to array (supports both single slug and array)
    const slugs: string[] = workspaceSlugs || (workspaceSlug ? [workspaceSlug] : []);

    if (slugs.length === 0) {
      throw validationError("Missing required parameter: workspaceSlug or workspaceSlugs");
    }
    if (slugs.length > 20) {
      throw validationError("Maximum 20 workspaces allowed per session");
    }

    // ============================================================
    // Auth — three modes:
    //   1. Authenticated member of every requested workspace (most
    //      common). buildWorkspaceConfigs handles per-slug membership.
    //   2. Authenticated non-member: rejected by buildWorkspaceConfigs.
    //   3. Anonymous public viewer of a single `isPublicViewable`
    //      workspace. Allowed only when:
    //        - exactly one slug
    //        - no orgId (orgs are always auth-only today)
    //        - no approvalIntent / rejectionIntent (write surfaces)
    //      Subject to a token-budget rate limit gate below.
    // ============================================================
    const isPublicCandidate =
      !isAuthenticated &&
      !orgId &&
      !approvalIntent &&
      !rejectionIntent &&
      slugs.length === 1;

    let publicViewerWorkspaceId: string | null = null;
    let publicAnonymousId: string | null = null;
    if (isPublicCandidate) {
      const access = await resolveWorkspaceAccess(request, { slug: slugs[0] });
      if (access.kind === "public-viewer") {
        publicViewerWorkspaceId = access.workspaceId;
        publicAnonymousId = deriveAnonymousId(request);
        const budget = await checkPublicChatBudget({
          workspaceId: access.workspaceId,
          anonymousId: publicAnonymousId,
        });
        if (!budget.allowed) {
          const message =
            budget.reason === "workspace"
              ? "This public workspace has reached its daily chat usage limit. Please try again tomorrow or sign in."
              : "Daily chat usage limit reached for anonymous visitors. Sign in to continue.";
          return NextResponse.json(
            { error: message, kind: "rate_limit_exceeded", reason: budget.reason },
            {
              status: 429,
              headers: {
                "Retry-After": String(budget.retryAfterSecs ?? 3600),
              },
            },
          );
        }
      }
    }

    if (!isAuthenticated && publicViewerWorkspaceId === null) {
      // Either the workspace isn't public, or this is a request shape
      // (orgId, multi-workspace, approval/rejection) that requires a
      // session. Reject uniformly — distinguishing the two here would
      // leak workspace existence to anonymous probers.
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ============================================================
    // Agent-proposal Approve / Reject flow.
    //
    // When the user clicks ✓ or ✗ on a `<ProposalCard>`, the chat
    // sends a normal message that carries `approvalIntent` (or
    // `rejectionIntent`) alongside `canvasChatMessages` (the raw
    // chat transcript). We run the side effect synchronously here
    // and return a small synthetic SSE stream — no LLM call.
    //
    // Done before tool / prefix construction because we don't need
    // any of that for these requests, and skipping the work saves a
    // stakgraph round-trip + token spend per click.
    //
    // Always auth-required (the public-viewer branch above never sets
    // approvalIntent — userId is guaranteed non-null here).
    // ============================================================
    if (approvalIntent || rejectionIntent) {
      if (!userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      if (!orgId) {
        throw validationError(
          "approvalIntent / rejectionIntent require orgId (org canvas chat only).",
        );
      }
      const orgBelongsToCaller = await validateUserBelongsToOrg(
        orgId,
        userId,
        "id",
      );
      if (!orgBelongsToCaller) {
        throw forbiddenError("Access denied for the specified organization");
      }
      const transcript: MessageLike[] = Array.isArray(canvasChatMessages)
        ? canvasChatMessages
        : [];
      // Validate the `conversationId` against this caller before
      // forwarding it to `handleApproval` — otherwise a malicious
      // body could stamp `parentCanvasConversationId` onto a feature
      // pointing at someone else's conversation. Org-canvas
      // conversations are org-scoped (no workspace), so we use the
      // org-aware validator rather than the workspace-keyed
      // token-attribution one (which would never match and silently
      // drop the id, leaving the new feature un-fanned-out).
      const approvalConversationId = await resolveOrgConversationRowId({
        conversationId,
        userId,
        orgId,
      });
      return await runProposalIntent({
        orgId,
        userId,
        transcript,
        approvalIntent,
        rejectionIntent,
        ...(approvalConversationId ? { conversationId: approvalConversationId } : {}),
        ...(typeof turnId === "string" && turnId ? { turnId } : {}),
      });
    }

    const isMultiWorkspace = slugs.length > 1;
    const primarySlug = slugs[0];
    const isPublicViewerRequest = publicViewerWorkspaceId !== null;

    // Normalize incoming messages to ModelMessage[] format
    const convertedMessages: ModelMessage[] = messages
      .map((m: any): ModelMessage | null => {
        let role = m.role;
        if (!role || !["user", "assistant", "system", "tool"].includes(role)) {
          role = "user";
        }
        let content = m.content;
        if (content === undefined || content === null) {
          if (role === "tool") return null;
          content = "";
        }
        return { role, content } as ModelMessage;
      })
      .filter((m): m is ModelMessage => m !== null);

    // Org-membership gating for the multi-workspace + orgId branch
    // (canvas chat). Validated here in the route so `runCanvasAgent`
    // can stay auth-agnostic — it trusts the caller. Matches the
    // pre-refactor behavior: org tools are only merged in multi-WS
    // mode, and only after this check.
    if (orgId && isMultiWorkspace) {
      const orgBelongsToCaller = await validateUserBelongsToOrg(
        orgId,
        userId!,
        "id",
      );
      if (!orgBelongsToCaller) {
        throw forbiddenError("Access denied for the specified organization");
      }
    }

    // Resolve the SharedConversation row this turn should attribute
    // tokens to. Validation rules:
    //   - Member: the row must belong to this user AND this workspace.
    //   - Public viewer: the row must belong to this anonymousId AND
    //     this workspace.
    // If the id doesn't match (or wasn't supplied), we fall through —
    // the turn streams normally but its tokens go un-recorded for this
    // row. For public viewers that means the next request's budget
    // gate sees one turn's worth less of recorded usage; acceptable
    // softness for the very first send of a session.
    const tokenAttributionRowId = await resolveTokenAttributionRowId({
      conversationId,
      userId,
      workspaceSlug: primarySlug,
      anonymousId: publicAnonymousId,
    });

    // Org-canvas prompt-prefix cache. The prefix (system prompt + the
    // pre-seeded `list_concepts` results) is identical turn-to-turn for a
    // conversation, but rebuilding it re-hits the swarm (`listConcepts`)
    // on every message — slow, and a hard failure when the swarm is
    // offline. So on the first turn we persist the assembled prefix to
    // `SharedConversation.settings.promptPrefix` and on later turns reuse
    // it, skipping the swarm round-trip entirely. Org-canvas rows are
    // org-scoped (workspaceId null), so the workspace-keyed
    // `resolveTokenAttributionRowId` above never matches them — we resolve
    // + load via the org-aware path here. Only the canvas chat (orgId set)
    // participates; the dashboard chat keeps rebuilding fresh.
    const promptCache =
      orgId && userId
        ? await loadOrgCanvasPromptCache({ conversationId, userId, orgId })
        : null;

    // ============================================================
    // Backend-driven canvas turn — server-side persistence (Tier 1).
    //
    // For the org-canvas chat, the SERVER owns the conversation row:
    // it persists the user message synchronously here (before the
    // stream), and the assistant turn in `after()` below. This makes a
    // turn survive the browser closing mid-stream — the client no
    // longer POSTs/PUTs messages (it just live-syncs server rows by
    // Pusher nudge). Gated on a `turnId` from the client; absent it,
    // we leave the legacy client-driven path untouched (dashboard chat,
    // public viewers, older clients).
    //
    // `${turnId}-u` = the user row id (idempotency key for this write);
    // `${turnId}-a*` = the assistant rows (written in `after()`). The
    // client filters server rows by the `${turnId}-` prefix in its
    // live-sync merge so the authoring tab never double-renders.
    // ============================================================
    const turnIdStr: string | null =
      typeof turnId === "string" && turnId.length > 0 ? turnId : null;
    const newUserContent = (() => {
      const last = convertedMessages[convertedMessages.length - 1];
      return last && last.role === "user" && typeof last.content === "string"
        ? last.content
        : "";
    })();
    let canvasConversationRowId: string | null = null;
    if (orgId && userId && turnIdStr && newUserContent.trim()) {
      canvasConversationRowId = await persistCanvasUserMessage({
        orgId,
        userId,
        // `promptCache?.rowId` is the validated *existing* org-canvas
        // row (or null on the first turn / an IDOR-mismatched id, in
        // which case we create a fresh row owned by this caller).
        existingRowId: promptCache?.rowId ?? null,
        turnId: turnIdStr,
        content: newUserContent,
        workspaceSlugs: slugs,
      });
    }

    try {
      // Tracks concept ids learned in this turn so the `after()` block
      // can fetch their provenance from stakgraph after the stream
      // finishes. Populated via the onStepFinish hook below.
      const learnedConceptIds = new Set<string>();
      // Collector for dispatch_research intents. Populated by the
      // internally-wired dispatch_research tool; consumed in after() to
      // schedule one research sub-agent worker per dispatched intent.
      const dispatchedResearch: DispatchedResearchIntent[] = [];

      const {
        result,
        primarySwarmUrl,
        primarySwarmApiKey,
        primaryWorkspaceId,
        primaryUserId,
        assembledPrefix,
        cacheableConcepts,
        cacheHit,
      } = await runCanvasAgent({
          userId,
          orgId: orgId && isMultiWorkspace ? orgId : undefined,
          workspaceSlugs: slugs,
          // Reuse cached concepts (skips the swarm `listConcepts` call)
          // when we have them for this org-canvas conversation. The prefix
          // is still rebuilt fresh each turn for an accurate scope hint.
          cachedConcepts: promptCache?.cachedConcepts ?? null,
          publicViewer: isPublicViewerRequest
            ? { workspaceId: publicViewerWorkspaceId!, primarySlug }
            : undefined,
          scope: {
            currentCanvasRef:
              typeof currentCanvasRef === "string" ? currentCanvasRef : undefined,
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
          // The validated SharedConversation.id (or null when the
          // body's `conversationId` failed validation). Forwarded to
          // `buildInitiativeTools` so `send_to_feature_planner` can
          // lazy-claim `Feature.parentCanvasConversationId` for
          // fan-out. Using the validated id (not the raw body field)
          // prevents a malicious caller from laundering ownership
          // claims into someone else's conversation.
          // Org-canvas rows are workspace-null, so `tokenAttributionRowId`
          // never matches them — `canvasConversationRowId` (the
          // server-owned org-canvas row) is the one fan-out needs.
          ...((canvasConversationRowId ?? tokenAttributionRowId)
            ? {
                currentCanvasConversationId:
                  canvasConversationRowId ?? tokenAttributionRowId ?? undefined,
              }
            : {}),
          // The HTTP chat is a live UI surface; emit HIGHLIGHT_NODES so
          // open clients animate the researched node.
          silentPusher: false,
          dispatchedResearch,
          hooks: {
            onStepFinish: (sf) => {
              const conceptIds = extractConceptIdsFromStep(sf.content);
              conceptIds.forEach((id) => learnedConceptIds.add(id));
            },
            onFinish: async ({ usage }) => {
              // Persist the turn's token usage to the conversation row so
              // the public-chat rate-limit gate can sum recent spend on
              // the next request. Best-effort; failures are logged but
              // do not surface to the user — the stream already finished.
              if (!tokenAttributionRowId) return;
              const u = usage as
                | { inputTokens?: number; outputTokens?: number }
                | undefined;
              const inputTokens = Number(u?.inputTokens ?? 0);
              const outputTokens = Number(u?.outputTokens ?? 0);
              await recordTurnTokens({
                conversationId: tokenAttributionRowId,
                inputTokens,
                outputTokens,
              });
            },
          },
        });

      // Persist the freshly-fetched concepts so the next turn of this
      // conversation can reuse them and skip the swarm `listConcepts`
      // call. Also snapshot the rendered prefix for the Agent Logs detail
      // view. Only on a cache MISS, with a validated org-canvas row id,
      // and only when the concepts are NON-EMPTY — a swarm outage on the
      // first turn yields an empty list, and caching that would poison
      // the cache into permanently serving nothing (we retry next turn).
      // Best-effort + off the response path via `after()`.
      // `canvasConversationRowId` covers the first turn (the row was just
      // created in this request, so `promptCache.rowId` was null at load).
      const cacheRowId = promptCache?.rowId ?? canvasConversationRowId;
      if (cacheRowId && !cacheHit && hasConcepts(cacheableConcepts)) {
        after(async () => {
          try {
            await persistOrgCanvasPromptCache(
              cacheRowId,
              cacheableConcepts,
              assembledPrefix,
            );
          } catch (err) {
            console.error(
              "❌ [quick-ask] Failed to persist prompt cache:",
              err,
            );
          }
        });
      }

      // ── Backend-driven turn: persist the assistant turn server-side ──
      // Drive the stream to completion off the client socket and write
      // the assistant rows under the `${turnId}-a` prefix. This is what
      // survives the browser closing mid-stream. Idempotent on the
      // prefix; the client filters these rows out of its own live-sync
      // merge (it's already showing them optimistically).
      if (canvasConversationRowId && turnIdStr) {
        const rowId = canvasConversationRowId;
        const assistantPrefix = `${turnIdStr}-a`;
        after(async () => {
          try {
            // `consumeStream()` drives generation to completion even if
            // the client disconnected (no abort signal is wired, so the
            // run isn't cancelled by a closed socket). Then `steps`
            // resolves with the full tool-call trace.
            await result.consumeStream();
            const steps = await result.steps;
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
          } catch (err) {
            console.error("❌ [quick-ask] Turn persist failed:", err);
            // Persist a trailing error row so a reopened tab sees the
            // failure instead of a silently-missing answer (mirrors the
            // client's inline error message).
            const errorRow: StoredMessage = {
              id: `${assistantPrefix}error`,
              role: "assistant",
              content:
                "I'm sorry, but I encountered an error while processing your question. Please try again.",
              timestamp: new Date().toISOString(),
            };
            await appendTurnMessages({
              conversationId: rowId,
              rows: [errorRow],
              idPrefix: assistantPrefix,
              reason: "user-turn",
            }).catch(() => {});
          }
        });
      }

      after(async () => {
        // Surfaces that don't render follow-ups or provenance opt out
        // of computing them. Saves a `generateObject` round-trip and
        // a `${swarmUrl}/gitree/provenance` POST per turn.
        if (skipEnrichments) return;
        // Generate follow-up questions
        try {
          const followUpSchema = z.object({
            questions: z
              .array(z.string())
              .describe("Exactly 3 short, specific follow-up questions (max 10 words each)"),
          });

          const conversationSummary = messages
            .filter((m: ModelMessage) => m.role === "user" || m.role === "assistant")
            .map((m: ModelMessage) => {
              const role = m.role === "user" ? "User" : "Assistant";
              let text = "";
              if (typeof m.content === "string") {
                text = m.content;
              } else if (Array.isArray(m.content)) {
                text = m.content
                  .filter((part: any) => part.type === "text")
                  .map((part: any) => part.text)
                  .join("\n");
              }
              return text ? `${role}: ${text}` : null;
            })
            .filter(Boolean)
            .join("\n\n");

          const followUpApiKey = getApiKeyForProvider("anthropic");
          // Route the follow-up `generateObject` through Bifrost under
          // the SAME `agentName` as the main stream. Follow-ups are
          // part of the same user-facing turn — splitting them into a
          // separate dim would fragment the per-surface rollups
          // operators actually want. So: orgId present → "canvas-agent",
          // absent → "chat-agent", matching `runCanvasAgent`. Returns
          // `undefined` and falls back to the default key when
          // BIFROST_ENABLED doesn't cover the primary slug, or for
          // public-viewer requests.
          const followUpBifrost = await getBifrostForLLM(
            {
              workspaceId: primaryWorkspaceId,
              workspaceSlug: primarySlug,
              userId: primaryUserId,
            },
            {
              agentName:
                orgId && isMultiWorkspace ? "canvas-agent" : "chat-agent",
            },
          );
          const followUpModel = getModel(
            "anthropic",
            followUpBifrost?.apiKey ?? followUpApiKey,
            primarySlug,
            undefined,
            followUpBifrost
              ? {
                  baseUrl: followUpBifrost.baseUrl,
                  headers: followUpBifrost.headers,
                }
              : undefined,
          );

          const followUpResult = await generateObject({
            model: followUpModel,
            schema: followUpSchema,
            prompt: `Based on this conversation, generate 3 short follow-up questions:\n\n${conversationSummary}`,
            system:
              "Generate 3 questions that the USER would naturally ask next as a follow-up in this conversation. Write them from the user's perspective, as if the user is typing them. They should be specific to the codebase and conversation context. NEVER generate clarifying questions directed at the user (like 'What kind of X are you interested in?'). Instead predict the user's next question (like 'How does the auth middleware work?' or 'Where are the API routes defined?'). Keep each under 10 words. Don't repeat questions already asked.",
            temperature: 0.3,
          });

          const channelName = getWorkspaceChannelName(primarySlug);
          await pusherServer.trigger(channelName, PUSHER_EVENTS.FOLLOW_UP_QUESTIONS, {
            questions: followUpResult.object.questions,
            timestamp: Date.now(),
          });

          console.log("✅ Follow-up questions sent:", followUpResult.object.questions);
        } catch (error) {
          console.error("❌ Error generating follow-up questions:", error);
        }

        // Generate provenance
        try {
          const conceptIds = Array.from(learnedConceptIds);
          if (conceptIds.length > 0) {
            const provenance = await fetchProvenance(primarySwarmUrl, primarySwarmApiKey, conceptIds);
            const channelName = getWorkspaceChannelName(primarySlug);
            await pusherServer.trigger(channelName, PUSHER_EVENTS.PROVENANCE_DATA, {
              provenance,
              timestamp: Date.now(),
            });
            console.log("✅ Provenance data sent:", provenance.concepts.length, "concepts");
          }
        } catch (error) {
          console.error("❌ Error generating provenance:", error);
        }
      });

      // Schedule research sub-agent workers for each dispatched intent.
      // Each worker runs off the stream's critical path via after() so
      // the HTTP response is already returned before any web searches run.
      for (const intent of dispatchedResearch) {
        after(async () => {
          const { runResearchSubAgent } = await import(
            "@/services/canvas-research-worker"
          );
          await runResearchSubAgent({
            ...intent,
            workspaceSlugs: slugs,
          });
        });
      }

      return result.toUIMessageStreamResponse({
        // Hand the server-created/validated org-canvas row id back to the
        // client (same pattern as `X-Approval-Result`) so it can stamp
        // `serverConversationId` on the first turn without a separate POST.
        ...(canvasConversationRowId
          ? {
              headers: {
                "X-Conversation-Id": canvasConversationRowId,
                "Access-Control-Expose-Headers": "X-Conversation-Id",
              },
            }
          : {}),
        // By default the AI SDK masks mid-stream errors as the literal
        // string "An error occurred." — useless for diagnosis and
        // indistinguishable from a clean finish on the client. Forward
        // the real message instead. `runCanvasAgent`'s `onError` logs the
        // full error + stack server-side; this surfaces a readable
        // message to the chat so the user sees *why* it failed rather
        // than a generic fallback.
        onError: (error) => {
          const message =
            error instanceof Error ? error.message : String(error);
          console.error("❌ [quick-ask] Mid-stream error:", {
            workspaces: slugs,
            message,
          });
          return message;
        },
      });
    } catch (streamError) {
      // Preserve typed ApiError statuses (forbidden, notFound,
      // validation, etc.) from the inner pipeline. The original code
      // had `buildWorkspaceConfigs` and friends outside this inner
      // try; the extraction moved them inside `runCanvasAgent`, so
      // we must explicitly re-throw their typed errors here to
      // preserve the original status-code semantics. Only unknown /
      // synchronous `streamText` setup failures get wrapped as 500.
      if (isApiError(streamError)) {
        throw streamError;
      }
      console.error("❌ [quick-ask] Stream creation failed:", {
        error: streamError,
        errorMessage: streamError instanceof Error ? streamError.message : String(streamError),
        workspaces: slugs,
      });
      throw serverError("Failed to create stream");
    }
  } catch (error) {
    if (isApiError(error)) {
      return NextResponse.json(
        { error: error.message, kind: error.kind, details: error.details },
        { status: error.statusCode },
      );
    }
    console.error("❌ [quick-ask] Unhandled error:", error);
    return NextResponse.json({ error: "Failed to process quick ask" }, { status: 500 });
  }
}

/**
 * Verify the supplied `conversationId` actually belongs to this caller
 * (member by userId, public viewer by anonymousId) and to this
 * workspace, returning the row id when it's safe to attribute token
 * usage to it. Returns null when no id was provided or the id doesn't
 * match — callers treat that as "skip persistence for this turn."
 *
 * This guards against an attacker passing someone else's
 * conversationId to launder their token spend onto another row, or
 * onto a member's row to obscure abuse.
 */
async function resolveTokenAttributionRowId(args: {
  conversationId: unknown;
  userId: string | null;
  workspaceSlug: string;
  anonymousId: string | null;
}): Promise<string | null> {
  const { conversationId, userId, workspaceSlug, anonymousId } = args;
  if (typeof conversationId !== "string" || conversationId.length === 0) {
    return null;
  }

  const row = await db.sharedConversation.findFirst({
    where: {
      id: conversationId,
      workspace: { slug: workspaceSlug, deleted: false },
      ...(userId
        ? { userId }
        : anonymousId
          ? { anonymousId, userId: null }
          : { id: "__never__" }),
    },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * Org-canvas sibling of `resolveTokenAttributionRowId`. Org-canvas
 * conversations are NOT workspace-scoped (`workspaceId: null`,
 * `sourceControlOrgId` set), so the workspace-keyed validator above
 * never matches them and would silently drop the id. The approval flow
 * needs a validated id to stamp `Feature.parentCanvasConversationId`,
 * which is what lets `fanOutPlannerMessageToCanvas` post the planner's
 * `source.kind === "planner"` message back into this conversation (and
 * render the `<SubAgentRunCard>`).
 *
 * Validates the row belongs to this org and either to this caller or
 * is an explicitly shared room (mirrors the GET/PUT ownership rule in
 * the org-canvas conversations route). Returns the id when safe, else
 * null. IDOR-safe: a mismatched id is indistinguishable from missing.
 */
async function resolveOrgConversationRowId(args: {
  conversationId: unknown;
  userId: string;
  orgId: string;
}): Promise<string | null> {
  const { conversationId, userId, orgId } = args;
  if (typeof conversationId !== "string" || conversationId.length === 0) {
    return null;
  }

  const row = await db.sharedConversation.findFirst({
    where: {
      id: conversationId,
      sourceControlOrgId: orgId,
      OR: [{ userId }, { isShared: true }],
    },
    select: { id: true },
  });
  return row?.id ?? null;
}

/**
 * Persist the user's message for a backend-driven org-canvas turn,
 * creating the conversation row on the first turn. Returns the row id
 * the rest of the request (fan-out, the `after()` assistant-turn write,
 * the `X-Conversation-Id` header) keys off.
 *
 * - **Existing row** (validated org-canvas id from the prompt cache):
 *   append the user row under the shared row lock, idempotent on
 *   `${turnId}-u` so a retry / double-send doesn't duplicate it.
 * - **No / mismatched id:** create a fresh `SharedConversation` owned by
 *   this caller (workspace-null, org-scoped), titled from the message,
 *   seeded with the user row, and carrying the full workspace-slug set
 *   in `settings.extraWorkspaceSlugs` (what the auto-turn reconstruction
 *   and later turns read — org rows have no `workspaceId` to recover the
 *   slugs from). Creating a new row on an IDOR-mismatched id is safe:
 *   the caller can only ever write to their own conversation.
 */
async function persistCanvasUserMessage(args: {
  orgId: string;
  userId: string;
  existingRowId: string | null;
  turnId: string;
  content: string;
  workspaceSlugs: string[];
}): Promise<string> {
  const { orgId, userId, existingRowId, turnId, content, workspaceSlugs } =
    args;

  const userRow: StoredMessage = {
    id: `${turnId}-u`,
    role: "user",
    content,
    timestamp: new Date().toISOString(),
  };

  if (existingRowId) {
    await appendTurnMessages({
      conversationId: existingRowId,
      rows: [userRow],
      idPrefix: `${turnId}-u`,
      reason: "user-message",
    });
    return existingRowId;
  }

  const created = await db.sharedConversation.create({
    data: {
      sourceControlOrgId: orgId,
      userId,
      workspaceId: null,
      messages: [userRow] as unknown as never,
      title: generateTitle([userRow]),
      lastMessageAt: new Date(),
      source: "org-canvas",
      settings: { extraWorkspaceSlugs: workspaceSlugs } as unknown as never,
      followUpQuestions: [],
      isShared: false,
    },
    select: { id: true },
  });
  return created.id;
}

/**
 * Load the cached concepts for an org-canvas conversation, while
 * validating that the row belongs to this org and either to this caller
 * or is an explicitly shared room (same ownership rule as
 * `resolveOrgConversationRowId`). Returns the validated row id plus the
 * cached concepts (or null when there's no usable cache yet). IDOR-safe:
 * a mismatched/missing id yields `null` indistinguishably.
 *
 * The concepts live at `settings.promptConcepts` (`CachedConcepts`).
 * They're the expensive swarm `listConcepts` result; reusing them lets
 * later turns skip that round-trip. The rendered prefix is rebuilt fresh
 * each turn (for an accurate scope hint), so it is NOT what we cache for
 * reuse — `settings.promptPrefix` is only a display snapshot.
 */
async function loadOrgCanvasPromptCache(args: {
  conversationId: unknown;
  userId: string;
  orgId: string;
}): Promise<{ rowId: string; cachedConcepts: CachedConcepts | null } | null> {
  const { conversationId, userId, orgId } = args;
  if (typeof conversationId !== "string" || conversationId.length === 0) {
    return null;
  }
  const row = await db.sharedConversation.findFirst({
    where: {
      id: conversationId,
      sourceControlOrgId: orgId,
      OR: [{ userId }, { isShared: true }],
    },
    select: { id: true, settings: true },
  });
  if (!row) return null;
  const settings = (row.settings ?? {}) as Record<string, unknown>;
  const pc = settings.promptConcepts;
  const cachedConcepts =
    pc && typeof pc === "object" ? (pc as CachedConcepts) : null;
  return { rowId: row.id, cachedConcepts };
}

/** True when a cache holds at least one concept (defensive: never cache
 *  an empty result from a swarm outage). */
function hasConcepts(c: CachedConcepts): boolean {
  if (Array.isArray(c.features)) return c.features.length > 0;
  if (c.conceptsByWorkspace) {
    return Object.values(c.conceptsByWorkspace).some(
      (list) => Array.isArray(list) && list.length > 0,
    );
  }
  return false;
}

/**
 * Atomically merge the cached concepts (for reuse) + the rendered prefix
 * snapshot (for the Agent Logs detail view) into
 * `SharedConversation.settings` via a jsonb `||` merge. Using a single
 * UPDATE (rather than read-modify-write) keeps it race-free against the
 * client autosave's concurrent `settings` writes — both sides merge into
 * the same blob instead of overwriting it. Caller has validated `rowId`.
 */
async function persistOrgCanvasPromptCache(
  rowId: string,
  concepts: CachedConcepts,
  prefixSnapshot: ModelMessage[],
): Promise<void> {
  const patch = JSON.stringify({
    promptConcepts: concepts,
    promptPrefix: prefixSnapshot,
  });
  await db.$executeRaw`
    UPDATE shared_conversations
    SET settings = COALESCE(settings, '{}'::jsonb) || ${patch}::jsonb
    WHERE id = ${rowId}
  `;
}

// ─── Agent-proposal: synthetic SSE stream for Approve / Reject ─────
//
// We don't call the LLM for these clicks — the side effect is fully
// determined by the conversation transcript + intent. We synthesize a
// tiny UI-message-stream-shaped response (text-start / text-delta /
// text-end) carrying the human-readable summary, plus a custom
// `X-Approval-Result` header carrying the structured outcome JSON.
// The chat send hook reads that header before processing the stream
// and stamps `approvalResult` onto the assistant message before
// autosave persists. Forks then see the resolved state in transcript
// because the message JSON includes the field.
async function runProposalIntent(args: {
  orgId: string;
  userId: string;
  transcript: MessageLike[];
  approvalIntent?: ApprovalIntent;
  rejectionIntent?: RejectionIntent;
  /**
   * Pre-validated `SharedConversation.id` (validated via
   * `resolveTokenAttributionRowId` in the caller). Forwarded into
   * `handleApproval` so feature approvals can stamp
   * `Feature.parentCanvasConversationId` for fan-out. Never
   * un-validated — the caller is the trust boundary.
   */
  conversationId?: string;
  /**
   * Backend-driven persistence id (org-canvas). When present alongside
   * `conversationId`, the click row + synthetic assistant row (carrying
   * `approvalResult`) are written server-side under `${turnId}-`, so the
   * proposal-card "approved" state survives a refresh without the client
   * autosave. Mirrors the LLM turn's persistence.
   */
  turnId?: string;
}): Promise<Response> {
  const {
    orgId,
    userId,
    transcript,
    approvalIntent,
    rejectionIntent,
    conversationId,
    turnId,
  } = args;

  let summaryText: string;
  let approvalResultHeader: string | null = null;
  let approvalResultObj: unknown = null;
  let alreadyApproved = false;

  if (approvalIntent) {
    const outcome = await handleApproval({
      orgId,
      userId,
      messages: transcript,
      intent: approvalIntent,
      ...(conversationId ? { conversationId } : {}),
    });
    if (!outcome.ok) {
      // Surface validation errors as the assistant text. The card UI
      // distinguishes "approval failed" from "approved" by checking
      // for `approvalResult` on the message; without it, the card
      // stays in pending-in-flight + shows the assistant text as the
      // failure reason. The HTTP status stays 200 so the SSE stream
      // still flushes cleanly.
      summaryText = `I couldn't create that: ${outcome.error}`;
    } else {
      const r = outcome.result;
      alreadyApproved = outcome.alreadyApproved;
      approvalResultHeader = JSON.stringify(r);
      approvalResultObj = r;
      // Prefer the resolved entity name ("Auth Refactor") over the
      // generic kind label ("an initiative canvas") so the user knows
      // exactly which workspace / initiative the new row landed
      // under. Falls back to the kind label when the lookup didn't
      // resolve (root canvas, deleted entity, older transcript). The
      // `milestone:` branch is a defensive fallback for pre-cutover
      // proposal trails — milestones aren't drillable scopes today,
      // so new approvals never produce that ref.
      const kindLabel =
        r.landedOn === ""
          ? "the org root canvas"
          : r.landedOn.startsWith("ws:")
            ? "a workspace canvas"
            : r.landedOn.startsWith("initiative:")
              ? "an initiative canvas"
              : r.landedOn.startsWith("milestone:")
                ? "an initiative canvas"
                : "the canvas";
      const where = r.landedOnName
        ? `**${r.landedOnName}**`
        : kindLabel;
      summaryText = alreadyApproved
        ? `Already created — opening the existing ${r.kind} on ${where}.`
        : r.kind === "initiative"
          ? `Created the initiative on ${where}.`
          : r.kind === "milestone"
            ? `Created the milestone on ${where}.`
            : `Created the feature on ${where}.`;
    }
  } else if (rejectionIntent) {
    const outcome = handleRejection({
      messages: transcript,
      intent: rejectionIntent,
    });
    summaryText = outcome.ok
      ? "Got it — I won't create that."
      : `Couldn't reject: ${outcome.error}`;
  } else {
    // Defensive — shouldn't happen given the caller guard.
    summaryText = "No proposal intent provided.";
  }

  // Persist the click + synthetic assistant row server-side (org-canvas
  // backend-driven turns). Single locked write under the `${turnId}-`
  // prefix (idempotent) so a re-click never double-appends. The client
  // filters its own `${turnId}-*` rows out of the live-sync merge.
  if (conversationId && turnId) {
    const lastUser = [...transcript]
      .reverse()
      .find((m) => m.role === "user") as
      | { content?: unknown; approval?: unknown; rejection?: unknown }
      | undefined;
    const clickRow: StoredMessage = {
      id: `${turnId}-u`,
      role: "user",
      content:
        typeof lastUser?.content === "string" ? lastUser.content : "",
      timestamp: new Date().toISOString(),
      ...(approvalIntent ? { approval: approvalIntent } : {}),
      ...(rejectionIntent ? { rejection: rejectionIntent } : {}),
    };
    const resultRow: StoredMessage = {
      id: `${turnId}-a0`,
      role: "assistant",
      content: summaryText,
      timestamp: new Date().toISOString(),
      ...(approvalResultObj ? { approvalResult: approvalResultObj } : {}),
    };
    await appendTurnMessages({
      conversationId,
      rows: [clickRow, resultRow],
      idPrefix: `${turnId}-`,
      reason: "user-turn",
    }).catch((err) =>
      console.error("❌ [quick-ask] Proposal persist failed:", err),
    );
  }

  // Build a minimal SSE stream of UIMessageChunk parts.
  const encoder = new TextEncoder();
  const partsTextId = `proposal-result-${Date.now().toString(36)}`;
  const parts: Array<Record<string, unknown>> = [
    { type: "start" },
    { type: "start-step" },
    { type: "text-start", id: partsTextId },
    { type: "text-delta", id: partsTextId, delta: summaryText },
    { type: "text-end", id: partsTextId },
    { type: "finish-step" },
    { type: "finish" },
  ];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(part)}\n\n`));
      }
      controller.enqueue(encoder.encode(`data: [DONE]\n\n`));
      controller.close();
    },
  });

  const headers: Record<string, string> = {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "x-vercel-ai-ui-message-stream": "v1",
  };
  if (approvalResultHeader) {
    headers["X-Approval-Result"] = approvalResultHeader;
    // Browsers expose only safelisted response headers to fetch
    // unless the server opts in via Access-Control-Expose-Headers.
    // The chat is same-origin so this isn't strictly required, but
    // setting it makes the contract explicit and safe under any
    // future origin-split.
    headers["Access-Control-Expose-Headers"] = "X-Approval-Result";
  }

  return new Response(stream, { headers });
}


