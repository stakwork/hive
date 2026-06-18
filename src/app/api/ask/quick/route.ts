import { NextRequest, NextResponse, after } from "next/server";
import { validationError, serverError, forbiddenError, isApiError } from "@/types/errors";
import { validateUserBelongsToOrg, validateWorkspaceAccess } from "@/services/workspace";
import { ModelMessage } from "ai";
import { getMiddlewareContext } from "@/lib/middleware/utils";
import { resolveWorkspaceAccess } from "@/lib/auth/workspace-access";
import {
  checkPublicChatBudget,
  deriveAnonymousId,
  recordTurnTokens,
} from "@/lib/ai/publicChatBudget";
import { db } from "@/lib/db";
import { resolveMessageImageUrls } from "@/lib/ai/resolveMessageImages";
import type { MessageLike } from "@/lib/proposals/handleApproval";
import { runProposalIntent } from "@/lib/proposals/runProposalIntent";
import {
  runCanvasAgent,
  extractConceptIdsFromStep,
} from "@/lib/ai/runCanvasAgent";
import type { DispatchedResearchIntent } from "@/lib/ai/researchTools";
import { toModelMessages } from "@/lib/ai/conversationHelpers";
import {
  messagesFromSteps,
  appendTurnMessages,
  fetchStoredConversationMessages,
  type StoredMessage,
  type StoredAttachment,
} from "@/services/canvas-turn-persistence";
import { buildDeferredCheckTools } from "@/lib/ai/deferredCheckTools";
import {
  resolveOrgConversationRowId,
  persistCanvasUserMessage,
  loadOrgCanvasPromptCache,
  hasConcepts,
  persistOrgCanvasPromptCache,
} from "@/services/org-canvas-conversation";
import {
  emitFollowUpQuestions,
  emitProvenance,
} from "@/services/canvas-turn-enrichments";

// Tier-1 backend-driven canvas turns (docs/plans/backend-driven-canvas-turns.md):
// the org-canvas turn is persisted server-side in `after()` so it survives the
// browser closing mid-stream. `after()` runs inside this invocation, so give
// the function generous headroom — a turn longer than this is the only case a
// closed-tab turn can be lost (Vercel doesn't kill in-flight functions on
// deploy, and `runCanvasAgent` passes no abort signal, so a client disconnect
// can't cancel generation).
export const maxDuration = 800;

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
      // User-uploaded file attachments for THIS turn's user message
      // (`CanvasAttachment[]` — `{ path, filename, mimeType, size }`).
      // The model sees them as image parts embedded in `messages`; this
      // top-level copy is what we persist so they survive reload.
      attachments,
    } = body;

    // Server-history mode: mobile clients send { message, conversationId, workspaceSlugs[] }
    // instead of the full messages array. Detected when `message` is a non-empty string
    // and no `messages` array is present.
    const isServerHistoryMode =
      typeof body.message === "string" &&
      body.message.trim().length > 0 &&
      (!body.messages || !Array.isArray(body.messages));

    if (!isServerHistoryMode && (!messages || !Array.isArray(messages) || messages.length === 0)) {
      throw validationError("Missing required parameter: messages (must be a non-empty array)");
    }
    if (isServerHistoryMode && (typeof conversationId !== "string" || !conversationId)) {
      throw validationError("Server-history mode requires conversationId");
    }
    // Server-history mode is authenticated-only.
    if (isServerHistoryMode && !isAuthenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

    // Build the ModelMessage[] array — two paths:
    //   Server-history mode: fetch stored conversation from DB + append new user message.
    //   Normal mode: normalize incoming messages array from client.
    let convertedMessages: ModelMessage[];

    if (isServerHistoryMode) {
      const memberAccess = await validateWorkspaceAccess(primarySlug, userId!);
      if (!memberAccess.hasAccess) {
        throw forbiddenError("Access denied for workspace");
      }
      const stored = await fetchStoredConversationMessages({
        conversationId: conversationId as string,
        userId: userId!,
        workspaceSlug: primarySlug,
      });
      if (!stored) {
        throw validationError("Conversation not found or access denied");
      }
      convertedMessages = [
        ...toModelMessages(stored),
        { role: "user", content: body.message.trim() } as ModelMessage,
      ];
    } else {
      // Normalize incoming messages to ModelMessage[] format
      convertedMessages = messages
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
        .filter((msg: ModelMessage | null): msg is ModelMessage => msg !== null);
    }

    // Rewrite relative image-attachment URLs to absolute signed S3 URLs
    // the AI SDK can actually download (see `resolveMessageImageUrls`).
    await resolveMessageImageUrls(convertedMessages);

    // Org-membership gating for any request that carries an orgId
    // (canvas chat, single- or multi-workspace). Validated here so
    // `runCanvasAgent` can stay auth-agnostic — it trusts the caller.
    // Must run before any DB write that uses orgId (persistCanvasUserMessage,
    // buildDeferredCheckTools) to prevent IDOR: an unauthenticated or
    // non-member caller could otherwise associate DB rows with an arbitrary org.
    if (orgId) {
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
    // The latest user turn's text. With an image attachment the content is
    // a multi-part array (`{type:"text"} + {type:"image"}`), so pull the
    // text part out — otherwise a string content collapses to "" and the
    // whole message (text + image) is skipped from persistence.
    const newUserContent = (() => {
      const last = convertedMessages[convertedMessages.length - 1];
      if (!last || last.role !== "user") return "";
      if (typeof last.content === "string") return last.content;
      if (Array.isArray(last.content)) {
        return last.content
          .filter(
            (p): p is { type: "text"; text: string } =>
              !!p && typeof p === "object" && (p as { type?: unknown }).type === "text",
          )
          .map((p) => p.text)
          .join("\n");
      }
      return "";
    })();
    // Normalize the top-level attachments the client forwarded into the
    // stored shape so the image survives reload. Defensive: drop anything
    // missing the required fields.
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
    let canvasConversationRowId: string | null = null;
    // Persist when there's text OR an attachment — an image-only turn has
    // no text but still must be saved.
    if (
      orgId &&
      userId &&
      turnIdStr &&
      (newUserContent.trim() || userAttachments.length > 0)
    ) {
      canvasConversationRowId = await persistCanvasUserMessage({
        orgId,
        userId,
        // `promptCache?.rowId` is the validated *existing* org-canvas
        // row (or null on the first turn / an IDOR-mismatched id, in
        // which case we create a fresh row owned by this caller).
        existingRowId: promptCache?.rowId ?? null,
        turnId: turnIdStr,
        content: newUserContent,
        attachments: userAttachments,
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
          // Inject the schedule_check tool when we have a fully-resolved
          // canvas conversation (org + user + server-owned row). All three
          // context values are server-side only — the LLM cannot override them.
          ...(orgId && userId && (canvasConversationRowId ?? tokenAttributionRowId)
            ? {
                additionalTools: buildDeferredCheckTools({
                  conversationId:
                    (canvasConversationRowId ?? tokenAttributionRowId)!,
                  orgId,
                  userId,
                }),
              }
            : {}),
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
        await emitFollowUpQuestions({
          messages,
          primarySlug,
          primaryWorkspaceId,
          primaryUserId,
          agentName:
            orgId && isMultiWorkspace ? "canvas-agent" : "chat-agent",
        });
        await emitProvenance({
          conceptIds: Array.from(learnedConceptIds),
          primarySlug,
          primarySwarmUrl,
          primarySwarmApiKey,
        });
      });

      // Schedule research sub-agent workers for each dispatched intent.
      // Each worker runs off the stream's critical path via after() so
      // the HTTP response is already returned before any web searches run.
      //
      // CRITICAL: `dispatchedResearch` is populated by the
      // `dispatch_research` tool, which only executes while the stream is
      // CONSUMED — i.e. AFTER this synchronous handler returns. So we must
      // NOT read the collector here (it's still empty at this point);
      // instead, register a single `after()` that first drives the stream
      // to completion (`consumeStream()` is idempotent and shared with the
      // turn-persist block above), THEN iterates the now-populated array.
      // Reading it synchronously here scheduled zero workers and left every
      // dispatched research row stuck in the "researching" state forever.
      after(async () => {
        try {
          await result.consumeStream();
          await result.steps;
        } catch {
          // Stream errors are surfaced/logged elsewhere; we still want to
          // schedule whatever intents were collected before the failure.
        }
        if (dispatchedResearch.length === 0) return;
        const { runResearchSubAgent } = await import(
          "@/services/canvas-research-worker"
        );
        for (const intent of dispatchedResearch) {
          await runResearchSubAgent({
            ...intent,
            workspaceSlugs: slugs,
          });
        }
      });

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


