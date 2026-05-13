import { after } from "next/server";
import { db } from "@/lib/db";
import { config } from "@/config/env";
import { getS3Service } from "@/services/s3";
import {
  ChatRole,
  ChatStatus,
  ArtifactType,
  WorkflowStatus,
} from "@/lib/chat";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
import { EncryptionService } from "@/lib/encryption";
import { callStakworkAPI } from "@/services/task-workflow";
import { buildFeatureContext } from "@/services/task-coordinator";
import {
  pusherServer,
  getFeatureChannelName,
  PUSHER_EVENTS,
} from "@/lib/pusher";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { joinRepoUrls } from "@/lib/helpers/repository";
import { scoutOrgContext } from "@/services/roadmap/orgContextScout";

/**
 * Fetch chat history for a feature, excluding a specific message.
 */
export async function fetchFeatureChatHistory(
  featureId: string,
  excludeMessageId: string,
): Promise<Record<string, unknown>[]> {
  const chatHistory = await db.chatMessage.findMany({
    where: {
      featureId,
      id: { not: excludeMessageId },
    },
    include: {
      artifacts: {
        where: {
          type: ArtifactType.PLAN,
        },
      },
      attachments: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  return chatHistory.map((msg) => ({
    id: msg.id,
    message: msg.message,
    role: msg.role,
    status: msg.status,
    timestamp: msg.createdAt.toISOString(),
    contextTags: msg.contextTags ? JSON.parse(msg.contextTags as string) : [],
    artifacts: msg.artifacts.map((artifact) => ({
      id: artifact.id,
      type: artifact.type,
      content: artifact.content,
      icon: artifact.icon,
    })),
    attachments:
      msg.attachments?.map((attachment) => ({
        id: attachment.id,
        filename: attachment.filename,
        path: attachment.path,
        mimeType: attachment.mimeType,
        size: attachment.size,
      })) || [],
  }));
}

const FEATURE_SELECT_FOR_CHAT = {
  id: true,
  planUpdatedAt: true,
  workspaceId: true,
  phases: {
    where: { order: 0 },
    take: 1,
    select: { id: true },
  },
  workspace: {
    select: {
      slug: true,
      ownerId: true,
      swarm: {
        select: {
          swarmUrl: true,
          swarmSecretAlias: true,
          poolName: true,
          id: true,
        },
      },
      members: {
        select: {
          userId: true,
          role: true,
        },
      },
      repositories: {
        orderBy: { createdAt: "asc" as const },
        select: {
          name: true,
          repositoryUrl: true,
          branch: true,
        },
      },
    },
  },
} as const;

/**
 * Module-level registry of in-flight background plan-mode dispatches.
 * Populated when `sendFeatureChatMessage` launches `dispatchPlanModeWorkflow`
 * and pruned when each dispatch settles.
 *
 * Production code never reads this — the HTTP route returns
 * immediately after the user ChatMessage is persisted and lets
 * dispatches finish in the background. The registry exists so tests
 * (and the documented `__flushPendingPlanModeDispatches` helper
 * below) can deterministically wait for all dispatches to settle
 * before asserting on `callStakworkAPI` mock calls.
 */
const pendingPlanModeDispatches = new Set<Promise<void>>();

/**
 * Test-only helper: await every currently-in-flight plan-mode
 * dispatch. Used by route-level unit tests that POST to the chat
 * endpoint and then immediately assert on the Stakwork mock. The
 * production HTTP route never calls this — it's exported for test
 * ergonomics so we don't have to thread `dispatchPromise` through
 * the API response.
 *
 * Returns once every dispatch in the registry has settled. New
 * dispatches kicked off while we're awaiting are NOT included
 * (callers that need a settled state should call this after their
 * last fetch/POST).
 */
export async function __flushPendingPlanModeDispatches(): Promise<void> {
  await Promise.all(Array.from(pendingPlanModeDispatches));
}

/**
 * Shape of the feature record passed to `dispatchPlanModeWorkflow`.
 * Captures everything from `FEATURE_SELECT_FOR_CHAT` plus the
 * `workflowStatus` and `model` fields the dispatch flow also reads.
 * Derived from a no-op Prisma payload type so it stays in sync with
 * the actual select shape without restating every field.
 */
type FeatureForChatDispatch = NonNullable<
  Awaited<
    ReturnType<
      typeof db.feature.findUnique<{
        where: { id: string };
        select: typeof FEATURE_SELECT_FOR_CHAT & {
          workflowStatus: true;
          model: true;
        };
      }>
    >
  >
>;

/**
 * Parse @workspace-slug mentions from a message, resolve each to swarm
 * credentials, and return them as extraSwarms for the Stakwork workflow.
 * Silently skips slugs that are not accessible, have no swarm, or have no repos.
 */
interface SubAgent {
  name: string,
  url: string;
  apiKey: string;
  repoUrls: string;
  toolsConfig?: Record<string, string | boolean>;
}

export async function resolveExtraSwarms(
  message: string,
  userId: string,
): Promise<SubAgent[]> {
  const slugMatches = [...message.matchAll(/\B@([\w-]+)/g)];
  const uniqueSlugs = [...new Set(slugMatches.map((m) => m[1]))];

  const encryptionService = EncryptionService.getInstance();
  const results: SubAgent[] = [];

  for (const slug of uniqueSlugs) {
    try {
      const workspace = await db.workspace.findFirst({
        where: {
          slug,
          deleted: false,
          OR: [{ ownerId: userId }, { members: { some: { userId } } }],
        },
        include: {
          swarm: true,
          repositories: { orderBy: { createdAt: "asc" } },
        },
      });

      if (!workspace?.swarm?.swarmUrl || !workspace.repositories.length) {
        continue;
      }

      const { swarm, repositories } = workspace;
      const url = transformSwarmUrlToRepo2Graph(swarm.swarmUrl);
      const apiKey = encryptionService.decryptField(
        "swarmApiKey",
        swarm.swarmApiKey ?? "",
      );
      const repoUrls = repositories
        .map((r) => r.repositoryUrl)
        .join(",");

      results.push({ name: slug, url, apiKey, repoUrls, toolsConfig: { learn_concepts: true } });
    } catch {
      // Silently skip any workspace that fails to resolve
    }
  }

  return results;
}

/**
 * Send a message in a feature-level conversation and trigger the Stakwork
 * planning workflow. Shared by both the API route and MCP tool.
 */
export async function sendFeatureChatMessage({
  featureId,
  userId,
  message,
  contextTags = [],
  sourceWebsocketID,
  webhook,
  replyId,
  history: bodyHistory,
  isPrototype,
  attachments,
  model,
  skipOrgContextScout = false,
}: {
  featureId: string;
  userId: string;
  message: string;
  contextTags?: { type: string; id: string }[];
  sourceWebsocketID?: string;
  webhook?: string;
  replyId?: string;
  history?: Record<string, unknown>[];
  isPrototype?: boolean;
  attachments?: Array<{ path: string; filename: string; mimeType: string; size: number }>;
  model?: string;
  /**
   * When `true`, skip the org-context scout entirely. Set this when
   * the caller is itself an agent that has already explored the org
   * canvases — e.g. the canvas-chat `propose_feature` approval flow
   * in `handleApproval.ts`. In that case the canvas agent composed
   * the seed message from an org-wide view, so re-scouting from Hive
   * would be redundant work (5-60s of wasted latency on the proposal
   * approval flow) and could even re-frame the context in a way the
   * proposing agent didn't intend.
   *
   * Direct user input (the plan-mode UI and MCP equivalents) leaves
   * this `false` (default) so the scout runs.
   */
  skipOrgContextScout?: boolean;
}) {
  // Unconditional entry breadcrumb so we can confirm the
  // plan-mode dispatch was reached even when callers (canvas-
  // proposal approval, MCP tools, direct UI) take different paths
  // in. `skipOrgContextScout` is surfaced so we can tell at a
  // glance whether the scout was suppressed by the caller.
  console.log(
    `[feature-chat] sendFeatureChatMessage entered: featureId=${featureId} userId=${userId} skipOrgContextScout=${skipOrgContextScout}`,
  );

  const feature = await db.feature.findUnique({
    where: { id: featureId },
    select: {
      ...FEATURE_SELECT_FOR_CHAT,
      workflowStatus: true,
      model: true,
    },
  });

  if (!feature) {
    throw new Error("Feature not found");
  }

  // Prevent sending while the planning workflow is already running
  if (feature.workflowStatus === "IN_PROGRESS") {
    throw new Error("A planning workflow is already running for this feature");
  }

  // Create the chat message linked to feature (no task)
  const chatMessage = await db.chatMessage.create({
    data: {
      featureId,
      message,
      role: ChatRole.USER,
      userId,
      contextTags: JSON.stringify(contextTags),
      status: ChatStatus.SENT,
      sourceWebsocketID,
      replyId,
      attachments: {
        create: (attachments ?? []).map((a) => ({
          path: a.path,
          filename: a.filename,
          mimeType: a.mimeType,
          size: a.size,
        })),
      },
    },
    include: {
      artifacts: true,
      attachments: true,
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
          image: true,
        },
      },
    },
  });

  // Broadcast user message to other connected clients
  try {
    await pusherServer.trigger(
      getFeatureChannelName(featureId),
      PUSHER_EVENTS.NEW_MESSAGE,
      chatMessage.id,
      sourceWebsocketID ? { socket_id: sourceWebsocketID } : {},
    );
  } catch (error) {
    console.error(
      "Error broadcasting user message to Pusher (feature):",
      error,
    );
  }

  // Call Stakwork workflow
  const useStakwork =
    config.STAKWORK_API_KEY &&
    config.STAKWORK_BASE_URL &&
    config.STAKWORK_WORKFLOW_ID;

  // Handle to the background dispatch Promise (or undefined when
  // Stakwork is not configured). Returned from this function so
  // callers that *want* to wait for the dispatch (tests, future
  // synchronous tools) can await it; the HTTP route ignores it.
  let dispatchPromise: Promise<void> | undefined;

  if (useStakwork) {
    // Optimistically flip workflowStatus to IN_PROGRESS *before*
    // launching the background work. This preserves the
    // "already running" guard at the top of this function under
    // double-clicks / racing requests, which previously relied on
    // the awaited callStakworkAPI completing before we returned.
    //
    // We capture the prior status so the background task can revert
    // it if Stakwork never confirms a project — matching the
    // pre-existing semantics of "leave workflowStatus unchanged on
    // dispatch failure" from the caller's perspective.
    const priorWorkflowStatus = feature.workflowStatus;
    await db.feature.update({
      where: { id: featureId },
      data: { workflowStatus: WorkflowStatus.IN_PROGRESS },
    });
    try {
      await pusherServer.trigger(
        getFeatureChannelName(featureId),
        PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE,
        { taskId: featureId, workflowStatus: WorkflowStatus.IN_PROGRESS },
      );
    } catch (error) {
      console.error(
        "Error broadcasting optimistic workflow status (feature):",
        error,
      );
    }

    // Background dispatch — the scout (up to 60s) and Stakwork hop
    // are not on the user-visible critical path. The caller returns
    // as soon as the ChatMessage row is persisted; the plan chat
    // view's Pusher subscription picks up any subsequent events
    // (NEW_MESSAGE for the assistant reply, FEATURE_UPDATED so the
    // client refetches and learns the new stakworkProjectId).
    //
    // We use Next.js's `after()` so the work is scheduled to run
    // after the response is sent AND the serverless runtime is
    // kept alive (via Vercel's `waitUntil`) until it settles. A
    // raw `void promise` would be killed on Vercel when the
    // function returns; `after()` is the safe equivalent.
    //
    // We also keep a Promise reference (`dispatchPromise`) and
    // register it in `pendingPlanModeDispatches` so unit tests can
    // deterministically wait for the dispatch via
    // `__flushPendingPlanModeDispatches`. In tests there's no
    // request context for `after()` to hook into; the Promise
    // reference is the test-friendly path.
    dispatchPromise = dispatchPlanModeWorkflow({
      featureId,
      userId,
      message,
      contextTags,
      webhook,
      bodyHistory,
      isPrototype,
      attachments,
      model,
      skipOrgContextScout,
      chatMessageId: chatMessage.id,
      feature,
      priorWorkflowStatus,
    }).catch((error) => {
      // Top-level safety net — every async step inside the dispatch
      // already has its own try/catch with status reversion, so
      // landing here means something truly unexpected (e.g. a
      // programming error in the dispatch function itself).
      console.error(
        "[feature-chat] background plan-mode dispatch crashed:",
        error,
      );
    });
    // Register the dispatch so test code (and any future tooling)
    // can await all in-flight dispatches via
    // `__flushPendingPlanModeDispatches`. Self-prunes on settle.
    pendingPlanModeDispatches.add(dispatchPromise);
    dispatchPromise.finally(() => {
      pendingPlanModeDispatches.delete(dispatchPromise!);
    });
    // Tell the Next.js runtime to keep the serverless invocation
    // alive until the dispatch settles. Wrapped in try/catch
    // because `after()` throws when called outside a request
    // context (e.g. unit tests that call this service directly
    // without going through the route handler). In that case the
    // Promise reference + flush helper is the supported path.
    try {
      after(() => dispatchPromise!);
    } catch (error) {
      // Expected in non-request contexts (unit tests, scripts).
      // Production HTTP / MCP / proposal paths all go through a
      // route handler, so `after()` will be available there.
      if (process.env.NODE_ENV !== "test") {
        console.warn(
          "[feature-chat] after() unavailable; dispatch will run as plain Promise (may be killed on Vercel if caller is not in a request context):",
          error,
        );
      }
    }
  }

  return { chatMessage, stakworkData: null, dispatchPromise };
}

/**
 * Background half of plan-mode dispatch: org-context scout +
 * Stakwork workflow call + post-dispatch status reconciliation.
 *
 * Split out of `sendFeatureChatMessage` so the API response can
 * return as soon as the user's ChatMessage is persisted. The scout
 * is the main cost (up to 60s soft cap, ~20s typical) and was
 * previously blocking the user-visible "next screen" transition.
 *
 * Error handling matches the pre-split inline behaviour: any failure
 * to dispatch leaves the feature in its prior workflow status and
 * logs to console. The plan chat view's Pusher subscription is the
 * channel for any successful state changes.
 */
async function dispatchPlanModeWorkflow(args: {
  featureId: string;
  userId: string;
  message: string;
  contextTags: { type: string; id: string }[];
  webhook?: string;
  bodyHistory?: Record<string, unknown>[];
  isPrototype?: boolean;
  attachments?: Array<{ path: string; filename: string; mimeType: string; size: number }>;
  model?: string;
  skipOrgContextScout: boolean;
  chatMessageId: string;
  feature: FeatureForChatDispatch;
  priorWorkflowStatus: WorkflowStatus | null;
}): Promise<void> {
  const {
    featureId,
    userId,
    message,
    contextTags,
    webhook,
    bodyHistory,
    isPrototype,
    attachments,
    model,
    skipOrgContextScout,
    chatMessageId,
    feature,
    priorWorkflowStatus,
  } = args;

  let stakworkData: Awaited<ReturnType<typeof callStakworkAPI>> | null = null;
  try {
    const githubProfile = await getGithubUsernameAndPAT(
      userId,
      feature.workspace.slug,
    );
    const userName = githubProfile?.username || null;
    const accessToken = githubProfile?.token || null;
    const swarm = feature.workspace.swarm;
    const swarmUrl = swarm?.swarmUrl
      ? swarm.swarmUrl.replace("/api", ":8444/api")
      : "";
    const swarmSecretAlias = swarm?.swarmSecretAlias || null;
    const poolName = swarm?.id || null;
    const repo2GraphUrl = transformSwarmUrlToRepo2Graph(swarm?.swarmUrl);
    const repos = feature.workspace.repositories ?? [];
    const repoUrl = joinRepoUrls(repos);
    const baseBranch = repos[0]?.branch || null;
    const repoName = repos[0]?.name || null;

    const dbHistory = await fetchFeatureChatHistory(
      featureId,
      chatMessageId,
    );

    // Drop failed exchanges: keep USER+ASSISTANT pairs only when
    // the ASSISTANT has a PLAN artifact (i.e. Stakwork responded successfully).
    const filteredHistory = dbHistory.filter((msg, idx) => {
      if (msg.role === "ASSISTANT") {
        const artifacts = msg.artifacts as { type: string }[];
        return artifacts.length > 0;
      }
      if (msg.role === "USER") {
        const next = dbHistory[idx + 1];
        if (!next || next.role !== "ASSISTANT") return false;
        const artifacts = next.artifacts as { type: string }[];
        return artifacts.length > 0;
      }
      return true;
    });

    const isFirstMessage = filteredHistory.length === 0;
    const mergedHistory = [...filteredHistory, ...(bodyHistory ?? [])];

    // Build feature context using the auto-created Phase 1
    let featureContext = undefined;
    const phase = feature.phases?.[0];
    if (phase) {
      try {
        featureContext = await buildFeatureContext(featureId, phase.id);
      } catch (error) {
        console.error("Error building feature context:", error);
      }
    }

    // Detect if user has manually edited plan fields since last AI update
    const lastPlanArtifact = await db.artifact.findFirst({
      where: {
        type: ArtifactType.PLAN,
        message: { featureId },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const planEdited =
      lastPlanArtifact && feature.planUpdatedAt
        ? feature.planUpdatedAt > lastPlanArtifact.createdAt
        : false;

    const extraSwarms = await resolveExtraSwarms(message, userId);

    // Generate presigned download URLs for any attachments
    const attachmentUrls = await Promise.all(
      (attachments ?? []).map((a) => getS3Service().generatePresignedDownloadUrl(a.path)),
    );

    // Org-wide context scout. Best-effort: returns null on any
    // failure / opt-out / no-org / non-first-message / sentinel.
    // Gated by env PLAN_MODE_ORG_CONTEXT_ENABLED — default off so
    // this is dark-launched.
    //
    // Skipped when the caller explicitly opts out (e.g. canvas-chat
    // `propose_feature` approvals, where the canvas agent already
    // saw org-wide context when composing the seed).
    //
    // When the scout returns text, we attach it under
    // `featureContext.orgContext` rather than as a separate top-level
    // var. Reasons: (a) `featureContext` is already plumbed end-to-
    // end to the Stakwork workflow, so this is zero workflow-
    // definition change; (b) it sits semantically next to the
    // feature's own brief/requirements/architecture as "more
    // planning context, just a different slice."
    const orgContext = skipOrgContextScout
      ? null
      : await scoutOrgContext({
          workspaceId: feature.workspaceId,
          userId,
          message,
          isFirstMessage,
        });
    if (orgContext && featureContext) {
      featureContext = { ...featureContext, orgContext };
    } else if (orgContext && !featureContext) {
      // `featureContext` is the carrier for orgContext today. If
      // building it failed earlier (no Phase 0, DB error, etc.), we
      // have no place to land the scout output. Logging only — the
      // scout cost is sunk; dropping the text is the least-bad
      // option because synthesizing a partial featureContext just
      // to carry org prose would mislead the plan agent's parsing.
      console.warn(
        "[feature-chat] org context scout returned text but featureContext is undefined; dropping orgContext for this dispatch",
      );
    }

    stakworkData = await callStakworkAPI({
      taskId: featureId,
      message,
      contextTags,
      userName,
      accessToken,
      swarmUrl,
      swarmSecretAlias,
      poolName,
      repo2GraphUrl,
      mode: "plan_mode",
      workspaceId: feature.workspaceId,
      repoUrl,
      baseBranch,
      repoName,
      history: mergedHistory,
      webhook,
      featureId,
      featureContext,
      planEdited,
      isPrototype: isPrototype && isFirstMessage,
      subAgents: extraSwarms,
      attachments: attachmentUrls,
      taskModel: feature.model || model || undefined,
    });
  } catch (error) {
    console.error(
      "[feature-chat] background plan-mode dispatch failed before Stakwork confirmed:",
      error,
    );
  }

  // Reconcile workflow status with the dispatch outcome. We
  // optimistically flipped to IN_PROGRESS before this background
  // task ran (to preserve the "already running" race guard); now
  // either confirm the in-progress state with the real projectId,
  // or revert to the prior status so the feature isn't stuck
  // showing IN_PROGRESS forever after a dispatch failure.
  if (stakworkData?.projectId) {
    try {
      await db.feature.update({
        where: { id: featureId },
        data: {
          // workflowStatus already IN_PROGRESS from the optimistic
          // flip; we still write it explicitly so the field stays
          // self-documenting alongside workflowStartedAt /
          // stakworkProjectId.
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          workflowStartedAt: new Date(),
          stakworkProjectId: stakworkData.projectId,
        },
      });
    } catch (error) {
      console.error(
        "[feature-chat] failed to persist stakworkProjectId after dispatch:",
        error,
      );
    }

    // Broadcast FEATURE_UPDATED so the plan chat view refetches and
    // picks up the new stakworkProjectId. Before this function was
    // split, the project_id was returned synchronously in the chat
    // POST response and the client used it directly to subscribe to
    // project logs (see `data.workflow?.project_id` in
    // PlanChatView's sendMessage). Now that the dispatch is
    // backgrounded, the response has no project_id — the only path
    // for the client to learn about it is a refetch, which this
    // event triggers.
    //
    // Best-effort: if Pusher fails, the client will still eventually
    // refresh on tab visibility change or natural re-mount, just
    // with a longer delay.
    try {
      await pusherServer.trigger(
        getFeatureChannelName(featureId),
        PUSHER_EVENTS.FEATURE_UPDATED,
        { featureId, timestamp: new Date().toISOString() },
      );
    } catch (error) {
      console.error(
        "[feature-chat] failed to broadcast FEATURE_UPDATED after dispatch:",
        error,
      );
    }
  } else {
    // Dispatch never produced a projectId — Stakwork errored, hit
    // a network failure, or returned a body-level failure. Revert
    // the optimistic status flip so the feature is dispatchable
    // again (mirrors the pre-split behaviour of "leave
    // workflowStatus unchanged on dispatch failure" from the
    // caller's perspective: the user-visible end state matches
    // priorWorkflowStatus either way).
    try {
      await db.feature.update({
        where: { id: featureId },
        data: { workflowStatus: priorWorkflowStatus },
      });
      await pusherServer.trigger(
        getFeatureChannelName(featureId),
        PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE,
        { taskId: featureId, workflowStatus: priorWorkflowStatus },
      );
    } catch (error) {
      console.error(
        "[feature-chat] failed to revert optimistic workflow status:",
        error,
      );
    }
  }
}
