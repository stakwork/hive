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
import { mintOrgToken } from "@/lib/mcp/orgTokenMint";
import type { McpServerConfig } from "@/services/mcpServers";

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
          name: true,
          repositoryUrl: true,
          branch: true,
        },
      },
    },
  },
} as const;

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
    const repos = feature.workspace.repositories ?? [];
    const repoUrl = joinRepoUrls(repos);
    const baseBranch = repos[0]?.branch || null;
    const repoName = repos[0]?.name || null;

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
      mcpServers: orgMcpServers,
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
