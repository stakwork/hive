import { db } from "@/lib/db";
import { config } from "@/config/env";
import { getS3Service } from "@/services/s3";
import {
  ChatRole,
  ChatStatus,
  ArtifactType,
  WorkflowStatus,
} from "@/lib/chat";
import { StakworkRunType } from "@prisma/client";
import { getBaseUrl } from "@/lib/utils";
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
import { mintOrgToken } from "@/lib/mcp/orgTokenMint";
import { mintWorkspaceToken } from "@/lib/mcp/workspaceTokenMint";
import { isDevelopmentMode } from "@/lib/runtime";
import type { McpServerConfig } from "@/services/mcpServers";

/**
 * Task tools exposed to the plan agent via the workspace-scope MCP
 * callback. The plan agent uses these to look up tasks in its
 * feature, create new ones (coding or workflow), edit existing ones,
 * and send messages to the task agents so plan-level decisions can
 * propagate downstream.
 *
 * Note we expose the feature-aware `create_feature_task` and
 * `create_workflow_task` instead of the generic `create_task` —
 * those variants carry the task-quality guardrails (granularity,
 * coding-vs-workflow classification, IDOR reminders) in their tool
 * descriptions, which the generic `create_task` doesn't. Voice and
 * other agents still get `create_task` via the default surface;
 * only the plan agent is locked to the feature-aware variants.
 *
 * Intentionally narrow: feature-level reads/writes flow through the
 * plan agent's normal chat surface (it IS the feature's planner), not
 * back through MCP. This filter is enforced in two layers:
 *   1. URL `?tools=` query param → server-side gate in `handler.ts`.
 *   2. `McpServerConfig.toolFilter` → client-side allow-list in
 *      repo/agent.
 * Belt-and-suspenders so a future expansion of `AVAILABLE_TOOLS`
 * cannot accidentally widen the plan agent's surface without an
 * explicit code change here.
 */
const PLAN_MODE_WORKSPACE_TOOLS = [
  "list_tasks",
  "read_task",
  "create_feature_task",
  "create_workflow_task",
  "update_task",
  "send_to_task_agent",
] as const;

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
  selectedRepositoryIds: true,
  phases: {
    where: { order: 0 },
    take: 1,
    select: { id: true },
  },
  workspace: {
    select: {
      slug: true,
      ownerId: true,
      // Required so plan-mode dispatch can mint an org-scope MCP
      // token for the swarm callback. Null when the workspace isn't
      // linked to a SourceControlOrg yet — in that case we skip
      // org-callback wiring and the swarm runs without it.
      sourceControlOrgId: true,
      // Eager-load the linked org's identity so the org-MCP server
      // entry sent to the swarm can use the org's actual name as the
      // server prefix (e.g. `stakwork_org_agent` instead of the
      // opaque `hive-org_org_agent`). `githubLogin` is the slug-safe
      // identifier (lowercased, no spaces); `name` is the display
      // form for surfacing in the tool description.
      sourceControlOrg: {
        select: { githubLogin: true, name: true },
      },
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
          id: true,
          name: true,
          repositoryUrl: true,
          branch: true,
        },
      },
    },
  },
} as const;

/**
 * Parse @workspace-slug mentions from one or more messages, resolve each to
 * swarm credentials, and return them as extraSwarms for the Stakwork workflow.
 * Silently skips slugs that are not accessible, have no swarm, or have no repos.
 *
 * Accepts either a single message string or an array of messages (e.g. the
 * whole planning conversation). Mentions are accumulated across all messages
 * and de-duplicated by slug, so a swarm mentioned on any turn stays attached
 * on every subsequent turn.
 */
interface SubAgent {
  name: string,
  description?: string;
  url: string;
  apiKey: string;
  repoUrls: string;
  toolsConfig?: Record<string, string | boolean>;
}

type WorkspaceForSubAgent = {
  slug: string;
  description?: string | null;
  swarm: {
    swarmUrl: string | null;
    swarmApiKey?: string | null;
  } | null;
  repositories: { repositoryUrl: string }[];
};

/**
 * Map a workspace record to a SubAgent payload.
 * Returns null when the workspace has no swarm URL or no repositories
 * (callers should silently skip nulls).
 */
export function workspaceToSubAgent(
  workspace: WorkspaceForSubAgent,
): SubAgent | null {
  if (!workspace.swarm?.swarmUrl || !workspace.repositories.length) {
    return null;
  }
  const encryptionService = EncryptionService.getInstance();
  const url = transformSwarmUrlToRepo2Graph(workspace.swarm.swarmUrl);
  const apiKey = encryptionService.decryptField(
    "swarmApiKey",
    workspace.swarm.swarmApiKey ?? "",
  );
  const repoUrls = workspace.repositories.map((r) => r.repositoryUrl).join(",");
  return {
    name: workspace.slug,
    description: workspace.description ?? undefined,
    url,
    apiKey,
    repoUrls,
    toolsConfig: { learn_concepts: true },
  };
}

export async function resolveExtraSwarms(
  messages: string | string[],
  userId: string,
): Promise<SubAgent[]> {
  const texts = Array.isArray(messages) ? messages : [messages];
  const uniqueSlugs = [
    ...new Set(
      texts.flatMap((text) =>
        [...(text ?? "").matchAll(/\B@([\w-]+)/g)].map((m) => m[1]),
      ),
    ),
  ];

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

      const agent = workspace ? workspaceToSubAgent(workspace) : null;
      if (agent) results.push(agent);
    } catch {
      // Silently skip any workspace that fails to resolve
    }
  }

  return results;
}

/**
 * Batch-fetch all workspaces under the same org that the user owns or is
 * an active member of, and resolve each to a SubAgent. A single DB query
 * replaces the per-slug loop in resolveExtraSwarms.
 *
 * Authorization: only workspaces the user owns or is an ACTIVE member of
 * (leftAt: null) are returned — membership is enforced in-query before any
 * swarmApiKey decrypt.
 */
export async function resolveOrgMemberSwarms(
  userId: string,
  sourceControlOrgId: string,
): Promise<SubAgent[]> {
  const workspaces = await db.workspace.findMany({
    where: {
      sourceControlOrgId,
      deleted: false,
      OR: [
        { ownerId: userId },
        { members: { some: { userId, leftAt: null } } },
      ],
    },
    include: {
      swarm: true,
      repositories: { orderBy: { createdAt: "asc" } },
    },
  });

  const results: SubAgent[] = [];
  for (const ws of workspaces) {
    const agent = workspaceToSubAgent(ws);
    if (agent) results.push(agent);
  }
  return results;
}

/**
 * Union of resolveExtraSwarms (manual @-mentions) and resolveOrgMemberSwarms
 * (all org workspaces the user belongs to), deduped by slug/name.
 * Manual @-mentions win on conflict (their entry is kept as-is).
 */
export async function resolveSubAgents({
  message,
  userId,
  sourceControlOrgId,
}: {
  message: string | string[];
  userId: string;
  sourceControlOrgId: string;
}): Promise<SubAgent[]> {
  const [mentionAgents, orgAgents] = await Promise.all([
    resolveExtraSwarms(message, userId),
    resolveOrgMemberSwarms(userId, sourceControlOrgId),
  ]);

  // Mentions take precedence; org agents fill in slugs not already present
  const seen = new Set(mentionAgents.map((a) => a.name));
  const merged = [...mentionAgents];
  for (const agent of orgAgents) {
    if (!seen.has(agent.name)) {
      seen.add(agent.name);
      merged.push(agent);
    }
  }
  return merged;
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
  selectedRepositoryIds,
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
  selectedRepositoryIds?: string[];
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

  // Authorization: caller must be workspace owner or member before any write
  const isOwner = feature.workspace.ownerId === userId;
  const isMember = feature.workspace.members?.some((m) => m.userId === userId) ?? false;
  if (!isOwner && !isMember) {
    throw new Error("Access denied");
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
  let stakworkData = null;

  if (useStakwork) {
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
    const allRepos = feature.workspace.repositories ?? [];

    let resolvedRepos = allRepos;
    if (selectedRepositoryIds && selectedRepositoryIds.length > 0) {
      // First message with explicit selection: persist to Feature and filter
      await db.feature.update({ where: { id: featureId }, data: { selectedRepositoryIds } });
      const filtered = allRepos.filter((r) => selectedRepositoryIds.includes(r.id));
      resolvedRepos = filtered.length > 0 ? filtered : allRepos;
    } else if (feature.selectedRepositoryIds && feature.selectedRepositoryIds.length > 0) {
      // Follow-up messages: use stored selection from Feature
      const filtered = allRepos.filter((r) => feature.selectedRepositoryIds.includes(r.id));
      resolvedRepos = filtered.length > 0 ? filtered : allRepos;
    }

    const repoUrl = joinRepoUrls(resolvedRepos);
    const baseBranch = resolvedRepos[0]?.branch || null;
    const repoName = resolvedRepos[0]?.name || null;

    const dbHistory = await fetchFeatureChatHistory(
      featureId,
      chatMessage.id,
    );

    // Drop failed exchanges: keep USER+ASSISTANT pairs only when
    // the ASSISTANT has a PLAN artifact (i.e. Stakwork responded successfully).
    const filteredHistory = dbHistory.filter((msg, idx) => {
      if (msg.role === "ASSISTANT") {
        const artifacts = msg.artifacts as { type: string }[];
        return artifacts.length > 0;
      }
      if (msg.role === "USER") {
        const nextAssistant = dbHistory
          .slice(idx + 1)
          .find((m) => m.role === "ASSISTANT");
        if (!nextAssistant) return false;
        const artifacts = nextAssistant.artifacts as { type: string }[];
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

    // Accumulate @mentions across the WHOLE conversation, not just the
    // current message. A swarm mentioned on any earlier turn must remain
    // attached on every subsequent turn, and a newly-mentioned swarm is
    // added to (not replacing) the previously-mentioned ones.
    const priorMessageTexts = [...dbHistory, ...(bodyHistory ?? [])]
      .filter(
        (m) => String((m as { role?: string }).role).toUpperCase() === "USER",
      )
      .map((m) => (m as { message?: string }).message)
      .filter((t): t is string => typeof t === "string");
    const allMessages = [...priorMessageTexts, message];

    const workspaceSlug = feature.workspace.slug;
    const sourceControlOrgId = feature.workspace.sourceControlOrgId;
    let extraSwarms: SubAgent[];
    if ((workspaceSlug === "stakwork" || isDevelopmentMode()) && sourceControlOrgId) {
      extraSwarms = await resolveSubAgents({
        message: allMessages,
        userId,
        sourceControlOrgId,
      });
      console.log(
        `[feature-chat] subAgents: ${extraSwarms.filter((a) => allMessages.some((m) => m?.includes(`@${a.name}`))).length} from @-mentions, ${extraSwarms.length} total (org auto-attach)`,
      );
    } else {
      extraSwarms = await resolveExtraSwarms(allMessages, userId);
    }

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

    // Org-scope MCP server entry for the swarm-side repo/agent.
    //
    // Where the legacy scout pushes a one-shot org brief into
    // `featureContext.orgContext`, this entry lets the plan agent on
    // the swarm call BACK into Hive's `org_agent` tool as many times
    // as it wants during its run — iterative, on-demand org context
    // instead of a pre-emptive blob. The two live side by side for
    // now; the scout is still gated by PLAN_MODE_ORG_CONTEXT_ENABLED
    // and can be turned off independently.
    //
    // Shape matches repo/agent's `McpServer` interface verbatim so the
    // stakwork workflow can forward `vars.mcpServers` straight through
    // without reshaping. `toolFilter` is set explicitly to `["org_agent"]`
    // even though the org-scope handler already exposes only that tool;
    // belt-and-suspenders against any future surface expansion sneaking
    // into the plan-mode tool list without an explicit code change here.
    //
    // Best-effort: any failure (no org link, JWT_SECRET missing,
    // membership lost, etc.) leaves `orgMcpServers` undefined and the
    // swarm runs without the callback — equivalent to the
    // pre-callback behavior.
    let orgMcpServers: McpServerConfig[] | undefined;
    const orgIdForCallback = feature.workspace.sourceControlOrgId;
    const orgForCallback = feature.workspace.sourceControlOrg;
    if (orgIdForCallback) {
      // Mint is best-effort: a transient DB error inside the mint
      // helper would otherwise abort the entire plan-mode dispatch,
      // which is too aggressive. The callback is a nice-to-have; if
      // we can't issue a token, the swarm just runs without it.
      try {
        const mintOutcome = await mintOrgToken({
          orgId: orgIdForCallback,
          userId,
          // Plan-mode dispatches a read-only token. The plan agent on
          // the swarm can ask `org_agent` questions but cannot trigger
          // canvas writes or propose_* cards via this surface. Voice
          // and other writers will mint their own tokens with their
          // own permissions when those flows land.
          requestedPermissions: ["read"],
          purpose: `plan-mode:${featureId}`,
        });
        if (mintOutcome.ok) {
          // Use the org's GitHub login as the MCP server name so the
          // agent sees a tool id like `stakwork_org_agent` rather than
          // a generic `hive-org_org_agent`. `githubLogin` is already
          // slug-safe (lowercase, no spaces); fall back to "hive-org"
          // if the eager-loaded join somehow came back null (shouldn't
          // happen given `orgIdForCallback` is non-null here, but the
          // mint path is best-effort and we don't want a server-name
          // edge case to break dispatch).
          const orgMcpServerName =
            orgForCallback?.githubLogin ?? "hive-org";
          orgMcpServers = [
            {
              name: orgMcpServerName,
              url: process.env.HIVE_MCP_URL || "https://hive.sphinx.chat/mcp",
              token: mintOutcome.token,
              toolFilter: ["org_agent"],
            },
          ];
          console.log(
            `[feature-chat] minted org-MCP token for ${featureId}: ` +
              `org=${orgIdForCallback} perms=${mintOutcome.granted.join(",")} jti=${mintOutcome.jti}`,
          );
        } else {
          console.warn(
            `[feature-chat] mintOrgToken failed for ${featureId}: ${mintOutcome.error} ` +
              `— swarm will run without org callback`,
          );
        }
      } catch (error) {
        console.error(
          `[feature-chat] mintOrgToken threw for ${featureId} ` +
            `— swarm will run without org callback:`,
          error,
        );
      }
    }

    // Workspace-scope MCP server entry for the swarm-side plan agent.
    //
    // Where `orgMcpServers` lets the agent reach back into the org-level
    // canvas surface, this entry lets it reach back into THIS workspace
    // to operate on the feature's own tasks — list / read / create /
    // update tasks, and send messages to task agents when a plan-level
    // decision needs to land in a task chat. Mirrors the
    // manager-of-planners loop the canvas agent uses on features,
    // applied one layer down (planner → tasks).
    //
    // Best-effort, same as the org callback: any failure (JWT_SECRET
    // missing, membership lost, etc.) leaves `workspaceMcpServers`
    // undefined and the plan agent runs without the task callback.
    let workspaceMcpServers: McpServerConfig[] | undefined;
    try {
      const mintOutcome = await mintWorkspaceToken({
        workspaceId: feature.workspaceId,
        userId,
        purpose: `plan-mode:${featureId}`,
      });
      if (mintOutcome.ok) {
        // Server-side filter via `?tools=` — defense in depth alongside
        // the client-side `toolFilter` below. Both layers gate the same
        // allow-list; either alone would suffice, both together make
        // accidental surface expansion harder.
        const baseUrl =
          process.env.HIVE_MCP_URL || "https://hive.sphinx.chat/mcp";
        const toolsParam = PLAN_MODE_WORKSPACE_TOOLS.join(",");
        const separator = baseUrl.includes("?") ? "&" : "?";
        const urlWithFilter = `${baseUrl}${separator}tools=${toolsParam}`;

        workspaceMcpServers = [
          {
            name: "hive",
            url: urlWithFilter,
            token: mintOutcome.token,
            toolFilter: [...PLAN_MODE_WORKSPACE_TOOLS],
          },
        ];
        console.log(
          `[feature-chat] minted workspace-MCP token for ${featureId}: ` +
            `slug=${mintOutcome.slug} tools=${toolsParam}`,
        );
      } else {
        console.warn(
          `[feature-chat] mintWorkspaceToken failed for ${featureId}: ${mintOutcome.error} ` +
            `— plan agent will run without task callback`,
        );
      }
    } catch (error) {
      console.error(
        `[feature-chat] mintWorkspaceToken threw for ${featureId} ` +
          `— plan agent will run without task callback:`,
        error,
      );
    }

    // Concatenate org + workspace MCP server entries. Both are
    // best-effort; either or both may be undefined. The result is
    // `undefined` only when neither was successfully minted (so
    // `callStakworkAPI` still gets an undefined `mcpServers` rather
    // than an empty array — keeps the wire payload identical to the
    // pre-workspace-MCP era when nothing is minted).
    const combinedMcpServers: McpServerConfig[] | undefined =
      orgMcpServers || workspaceMcpServers
        ? [...(orgMcpServers ?? []), ...(workspaceMcpServers ?? [])]
        : undefined;

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
      workspaceSlug: feature.workspace.slug,
      userId,
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
      mcpServers: combinedMcpServers,
    });

    // Only update workflow status when Stakwork confirms a project was created
    if (stakworkData?.projectId) {
      await db.feature.update({
        where: { id: featureId },
        data: {
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          workflowStartedAt: new Date(),
          stakworkProjectId: stakworkData.projectId,
        },
      });

      await db.stakworkRun.create({
        data: {
          type: StakworkRunType.PLAN_CHAT,
          featureId,
          workspaceId: feature.workspaceId,
          projectId: stakworkData.projectId,
          status: WorkflowStatus.IN_PROGRESS,
          webhookUrl: `${getBaseUrl()}/api/stakwork/webhook?task_id=${featureId}`,
        },
      });

      await pusherServer.trigger(
        getFeatureChannelName(featureId),
        PUSHER_EVENTS.WORKFLOW_STATUS_UPDATE,
        { taskId: featureId, workflowStatus: WorkflowStatus.IN_PROGRESS },
      );
    }
    // All other cases (network error, non-2xx, body-level failure, missing project_id):
    // no-op — leave workflowStatus unchanged
  }

  return { chatMessage, stakworkData };
}
