import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { z } from "zod";
import jwt from "jsonwebtoken";
import { validateApiKey } from "@/lib/api-keys";
import { db } from "@/lib/db";
import { getSwarmAccessByWorkspaceId } from "@/lib/helpers/swarm-access";
import {
  mcpListConcepts,
  mcpLearnConcept,
  mcpListFeatures,
  mcpReadFeature,
  mcpCreateFeature,
  mcpListTasks,
  mcpReadTask,
  mcpCreateTask,
  mcpCreateFeatureTask,
  mcpCreatePrompt,
  mcpUpdatePrompt,
  mcpCreateWorkflowTask,
  isWorkflowTasksEnabled,
  mcpUpdateTask,
  mcpSendToTaskAgent,
  mcpSendMessage,
  mcpCheckStatus,
  findWorkspaceUser,
  resolveWorkspaceUser,
  type SwarmCredentials,
  type WorkspaceAuth,
  type McpToolResult,
} from "@/lib/mcp/mcpTools";
import {
  registerOrgTools,
  type OrgMcpAuthExtra,
} from "@/lib/mcp/orgMcpTools";
import {
  isOrgPermission,
  type OrgPermission,
} from "@/lib/mcp/orgPermissions";

// Available tools registry
const AVAILABLE_TOOLS = [
  "list_concepts",
  "learn_concept",
  "list_features",
  "read_feature",
  "create_feature",
  "list_tasks",
  "read_task",
  "create_task",
  "create_feature_task",
  "create_workflow_task",
  "update_task",
  "create_prompt",
  "update_prompt",
  "send_to_task_agent",
  "check_status",
  "send_message",
] as const;
type ToolName = (typeof AVAILABLE_TOOLS)[number];

interface McpAuthExtra {
  [key: string]: unknown;
  workspaceId: string;
  workspaceSlug: string;
  apiKeyId: string;
  swarmUrl?: string;
  swarmApiKey?: string;
  toolsFilter?: string[];
}

// Parse tools filter from URL
function parseToolsFilter(url: URL): string[] | null {
  const toolsParam = url.searchParams.get("tools");
  if (!toolsParam) return null; // null means all tools

  const requested = toolsParam.split(",").map((t) => t.trim().toLowerCase());
  return requested.filter((tool) =>
    AVAILABLE_TOOLS.includes(tool as ToolName),
  );
}

function getCredentialsFromAuth(
  extra: McpAuthExtra | undefined,
  toolName: ToolName,
) {
  if (!extra) {
    return {
      error: {
        content: [{ type: "text" as const, text: "Error: Not authenticated" }],
        isError: true,
      },
    };
  }

  if (!extra.swarmUrl) {
    return {
      error: {
        content: [
          {
            type: "text" as const,
            text: "Error: Swarm not configured for this workspace",
          },
        ],
        isError: true,
      },
    };
  }

  // Check if this tool should be available
  if (extra.toolsFilter && !extra.toolsFilter.includes(toolName)) {
    return {
      error: {
        content: [{ type: "text" as const, text: "Error: Tool not available" }],
        isError: true,
      },
    };
  }

  return {
    credentials: {
      swarmUrl: extra.swarmUrl,
      swarmApiKey: extra.swarmApiKey || "",
    } as SwarmCredentials,
  };
}

/**
 * Extract workspace auth for DB-direct tools (no swarm required).
 * Resolves the acting user via fuzzy name match, falling back to workspace owner.
 */
async function getWorkspaceAuth(
  extra: McpAuthExtra | undefined,
  toolName: ToolName,
  userHint?: string,
): Promise<{ error?: McpToolResult; auth?: WorkspaceAuth }> {
  if (!extra) {
    return {
      error: {
        content: [{ type: "text" as const, text: "Error: Not authenticated" }],
        isError: true,
      },
    };
  }

  if (extra.toolsFilter && !extra.toolsFilter.includes(toolName)) {
    return {
      error: {
        content: [{ type: "text" as const, text: "Error: Tool not available" }],
        isError: true,
      },
    };
  }

  const userId = await resolveWorkspaceUser(extra.workspaceId, userHint);

  return {
    auth: {
      workspaceId: extra.workspaceId,
      workspaceSlug: extra.workspaceSlug,
      userId,
    },
  };
}

// Create a fresh McpServer with tools registered.
//
// `scope` selects which tool family is exposed:
//   - "workspace" (default): all the existing workspace-scoped tools
//     keyed off a single workspace + swarm. Used by long-lived
//     hive_* API keys and the legacy workspace JWTs minted by
//     /api/livekit-token.
//   - "org": exposes only `org_agent`, the single callback tool that
//     wraps `runCanvasAgent`. Used by org-JWTs minted from
//     /api/mcp/org-token for plan-mode swarm callbacks and (future)
//     voice agents.
//
// `options.orgName` is consumed only on the org branch; it's the
// display label interpolated into `org_agent`'s title and description
// so the calling agent sees something like "Ask the Stakwork org
// agent…" instead of the generic "Ask the Hive org agent…". Resolved
// upstream in `handleMcpRequest` from the org JWT's `orgId`.
//
// Mutually exclusive on purpose — an org-scope token does not get
// the workspace tool surface, and a workspace-scope token does not
// get `org_agent`. Crossing the scopes would silently widen the
// authorization granted at mint time.
function createServer(
  scope: "workspace" | "org" = "workspace",
  options: { orgName?: string } = {},
): McpServer {
  const server = new McpServer(
    { name: "hive", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );

  if (scope === "org") {
    registerOrgTools(server, { orgName: options.orgName });
    return server;
  }

  server.registerTool(
    "list_concepts",
    {
      title: "List Concepts",
      description:
        "Fetch a list of features/concepts from the codebase knowledge base. Returns features with metadata including name, description, PR/commit counts, last updated time, and whether documentation exists.",
      inputSchema: {},
    },
    async (_args, extra) => {
      const authExtra = extra.authInfo?.extra as McpAuthExtra | undefined;
      const result = getCredentialsFromAuth(authExtra, "list_concepts");
      if (result.error) return result.error;
      return mcpListConcepts(result.credentials);
    },
  );

  server.registerTool(
    "learn_concept",
    {
      title: "Learn Concept",
      description:
        "Fetch documentation for a specific concept by ID. Returns the documentation content for the concept.",
      inputSchema: {
        conceptId: z
          .string()
          .describe("The ID of the concept to retrieve documentation for"),
      },
    },
    async ({ conceptId }: { conceptId: string }, extra) => {
      const authExtra = extra.authInfo?.extra as McpAuthExtra | undefined;
      const result = getCredentialsFromAuth(authExtra, "learn_concept");
      if (result.error) return result.error;
      return mcpLearnConcept(result.credentials, conceptId);
    },
  );

  // ----- Feature tools (DB-direct) -----

  server.registerTool(
    "list_features",
    {
      title: "List Features",
      description:
        "List features in the workspace, ordered by last updated. Returns feature names, IDs, statuses, last-updated timestamps, and a `link` to the feature's plan page. Maximum 40 results. When sharing a feature with the user, use the `link` field verbatim — never construct a URL yourself.",
      inputSchema: {},
    },
    async (_args, extra) => {
      const authExtra = extra.authInfo?.extra as McpAuthExtra | undefined;
      const result = await getWorkspaceAuth(authExtra, "list_features");
      if (result.error) return result.error;
      return mcpListFeatures(result.auth!);
    },
  );

  server.registerTool(
    "read_feature",
    {
      title: "Read Feature",
      description:
        "Read a feature's plan details and full chat message history. Also indicates whether the planning workflow is currently running, and returns a `link` to the feature's plan page. When sharing the feature with the user, use the `link` field verbatim — never construct a URL yourself.",
      inputSchema: {
        featureId: z
          .string()
          .describe("The ID of the feature to read"),
      },
    },
    async ({ featureId }: { featureId: string }, extra) => {
      const authExtra = extra.authInfo?.extra as McpAuthExtra | undefined;
      const result = await getWorkspaceAuth(authExtra, "read_feature");
      if (result.error) return result.error;
      return mcpReadFeature(result.auth!, featureId);
    },
  );

  server.registerTool(
    "create_feature",
    {
      title: "Create Feature",
      description:
        "Create a new feature in the workspace with a brief description and optional requirements.",
      inputSchema: {
        title: z.string().describe("The title of the feature"),
        brief: z.string().describe("A brief description of the feature"),
        requirements: z
          .string()
          .optional()
          .describe("Optional detailed requirements for the feature"),
        creator: z
          .string()
          .optional()
          .describe(
            "Name of the creator (matched against name or alias). Falls back to workspace owner if not found.",
          ),
      },
    },
    async (
      {
        title,
        brief,
        requirements,
        creator,
      }: { title: string; brief: string; requirements?: string; creator?: string },
      extra,
    ) => {
      const authExtra = extra.authInfo?.extra as McpAuthExtra | undefined;
      const result = await getWorkspaceAuth(authExtra, "create_feature", creator);
      if (result.error) return result.error;
      return mcpCreateFeature(result.auth!, title, brief, requirements);
    },
  );

  // ----- Task tools (DB-direct) -----

  server.registerTool(
    "list_tasks",
    {
      title: "List Tasks",
      description:
        "List tasks in the workspace, ordered by last updated. Returns task titles, IDs, statuses, priorities, featureIds, last-updated timestamps, and a `link` to each task page. Maximum 40 results. When `featureId` is provided, scopes results to tasks belonging to that feature. When sharing a task with the user, use the `link` field verbatim — never construct a URL yourself.",
      inputSchema: {
        featureId: z
          .string()
          .optional()
          .describe(
            "Optional feature ID. When provided, lists only tasks belonging to this feature.",
          ),
      },
    },
    async ({ featureId }: { featureId?: string }, extra) => {
      const authExtra = extra.authInfo?.extra as McpAuthExtra | undefined;
      const result = await getWorkspaceAuth(authExtra, "list_tasks");
      if (result.error) return result.error;
      return mcpListTasks(result.auth!, featureId);
    },
  );

  server.registerTool(
    "read_task",
    {
      title: "Read Task",
      description:
        "Read a task's details and full chat message history. Also indicates whether the task workflow is currently running, and returns a `link` to the task page. When sharing the task with the user, use the `link` field verbatim — never construct a URL yourself.",
      inputSchema: {
        taskId: z
          .string()
          .describe("The ID of the task to read"),
      },
    },
    async ({ taskId }: { taskId: string }, extra) => {
      const authExtra = extra.authInfo?.extra as McpAuthExtra | undefined;
      const result = await getWorkspaceAuth(authExtra, "read_task");
      if (result.error) return result.error;
      return mcpReadTask(result.auth!, taskId);
    },
  );

  server.registerTool(
    "create_task",
    {
      title: "Create Task",
      description:
        "Create a new task in the workspace with a title and optional description, priority, and feature.",
      inputSchema: {
        title: z.string().describe("The title of the task"),
        description: z
          .string()
          .optional()
          .describe("A description of the task"),
        priority: z
          .enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"])
          .optional()
          .describe("Priority level (LOW, MEDIUM, HIGH, CRITICAL). Defaults to MEDIUM."),
        featureId: z
          .string()
          .optional()
          .describe(
            "Optional feature ID to attach this task to. The feature must belong to this workspace.",
          ),
        creator: z
          .string()
          .optional()
          .describe(
            "Name of the creator (matched against name or alias). Falls back to workspace owner if not found.",
          ),
      },
    },
    async (
      {
        title,
        description,
        priority,
        featureId,
        creator,
      }: {
        title: string;
        description?: string;
        priority?: string;
        featureId?: string;
        creator?: string;
      },
      extra,
    ) => {
      const authExtra = extra.authInfo?.extra as McpAuthExtra | undefined;
      const result = await getWorkspaceAuth(authExtra, "create_task", creator);
      if (result.error) return result.error;
      return mcpCreateTask(result.auth!, title, description, priority, featureId);
    },
  );

  server.registerTool(
    "create_feature_task",
    {
      title: "Create Feature Coding Task",
      description: [
        "Create a CODING task anchored to a feature in this workspace. Use this when the work requires changes to a code repository (bug fix, new feature, refactor, mock/seed data) — anything a developer or coding agent executes against a repo.",
        "",
        "Do NOT use this for workflow editor / Stakwork workflow work — use `create_workflow_task` for those.",
        "",
        "**When to call.** Don't batch-create a full task list on the first message of a plan; let the plan firm up first. Call this tool when the user explicitly asks for a new coding task, or when a plan revision introduces coding work no existing task covers. Before creating, call `list_tasks` with the same `featureId` to check for duplicates.",
        "",
        "**Granularity (CRITICAL — match the bar of the standalone task-generator).** Default to ONE task. Prefer a single task whenever the work can reasonably be done as one — a bug fix is ONE task, a small or medium feature is usually ONE task. Only split into multiple tasks when there's a concrete reason the work CAN'T sensibly be one, e.g.: the work spans more than one repository (one task per repo); a shared library/package must be changed and published in one repo before it can be consumed in another; or a migration / data backfill must land and settle as its own step before dependent work can build on it. Absent a reason like those, keep it as one task — a large single-repo feature is at most ~3 tasks, and reaching for more than one should feel like the exception, not the default. Do NOT split groundwork from its use within the same repo: building helpers/utilities/types/scaffolding and then implementing the feature on top of them is ONE task, not 'create the helpers' followed by 'use the helpers'. The agent writing the code creates whatever support code it needs as part of doing the work.",
        "",
        "**Title** — actionable verb + what to build (e.g. 'Add JWT auth middleware', 'Fix nodes loading in test workspace'). NOT 'investigate X', NOT 'write tests for Y'.",
        "",
        "**Description** — markdown. Include what to implement, acceptance criteria, and how to verify. Include unit/integration tests (NO E2E). When the work touches authorization, add an IDOR reminder: confirm the authenticated caller is authorized to that specific resource BEFORE any DB write, secret access, or third-party call.",
        "",
        "**Mock data / seed.** If the architecture introduces new mock data or mock endpoints, instruct the agent to check existing seed scripts / DB before generating new ones.",
        "",
        "**Priority** — CRITICAL (blockers), HIGH (core), MEDIUM (standard, default), LOW (nice-to-have).",
        "",
        "**Repository.** Required: pass either `repositoryId` (cuid from `featureContext.workspaceRepositories`) or `repositoryUrl` (string match against the workspace's repos). The workspace's repos are exposed on `featureContext.workspaceRepositories` — pick the one that owns the change. Work spanning multiple repos = multiple tasks (one per repo).",
      ].join("\n"),
      inputSchema: {
        featureId: z
          .string()
          .describe(
            "Feature ID to attach this task to. Get this from `featureContext.feature.id`. The feature must belong to this workspace.",
          ),
        title: z
          .string()
          .describe(
            "Actionable title: verb + what to build. Examples: 'Add JWT auth middleware', 'Fix nodes loading in test workspace'.",
          ),
        description: z
          .string()
          .optional()
          .describe(
            "Markdown description with what to implement, acceptance criteria, and how to verify. Include unit/integration tests (NO E2E). Add an IDOR reminder when handling auth/resource access.",
          ),
        priority: z
          .enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"])
          .optional()
          .describe("CRITICAL | HIGH | MEDIUM (default) | LOW."),
        repositoryId: z
          .string()
          .optional()
          .describe(
            "Repository cuid. Prefer this over repositoryUrl when you have it. Available on each entry of `featureContext.workspaceRepositories`.",
          ),
        repositoryUrl: z
          .string()
          .optional()
          .describe(
            "Repository URL (matched against the workspace's repos). Use when you only have the URL, not the cuid. Exactly one of repositoryId/repositoryUrl must be provided.",
          ),
        dependsOnTaskIds: z
          .array(z.string())
          .optional()
          .describe(
            "IDs of tasks this task depends on. The dependency chart on the Feature page is only shown when at least one task has dependencies.",
          ),
        creator: z
          .string()
          .optional()
          .describe(
            "Name of the creator (matched against name or alias). If omitted or unmatched, defaults to the feature's creator, then the workspace owner.",
          ),
      },
    },
    async (
      {
        featureId,
        title,
        description,
        priority,
        repositoryId,
        repositoryUrl,
        dependsOnTaskIds,
        creator,
      }: {
        featureId: string;
        title: string;
        description?: string;
        priority?: string;
        repositoryId?: string;
        repositoryUrl?: string;
        dependsOnTaskIds?: string[];
        creator?: string;
      },
      extra,
    ) => {
      const authExtra = extra.authInfo?.extra as McpAuthExtra | undefined;
      // Don't resolve `creator` here — mcpCreateFeatureTask owns
      // attribution so it can default to the feature's creator (not the
      // workspace owner) when no hint matches.
      const result = await getWorkspaceAuth(authExtra, "create_feature_task");
      if (result.error) return result.error;
      return mcpCreateFeatureTask(
        result.auth!,
        featureId,
        { title, description, priority, dependsOnTaskIds },
        { repositoryId, repositoryUrl },
        creator,
      );
    },
  );

  server.registerTool(
    "create_workflow_task",
    {
      title: "Create Feature Workflow Task",
      description: [
        "Create a WORKFLOW task anchored to a feature in this workspace. Use this when the work is executed by running, building, or configuring a Stakwork **workflow** — a Lambda-based, DAG-style automation pipeline. Do NOT use this for code changes; use `create_feature_task` for those.",
        "",
        "**Availability.** Workflow tasks are ONLY supported on the `stakwork` workspace. On any other workspace this tool will reject the call — treat the work as a coding task via `create_feature_task` instead.",
        "",
        "Workflow tasks split into two kinds, both handled by this tool:",
        "- **Existing workflow** — running, triggering, or reconfiguring a workflow that already exists. Pass `workflowId` (integer).",
        "- **New workflow** — building a brand-new workflow in the editor. Omit `workflowId` entirely (never set it to null).",
        "",
        "**Decide which type a task is.** Ask: does completing this ticket require changing source code in a repository? → `create_feature_task`. Does it mean triggering, running, or building/editing a Stakwork workflow? → `create_workflow_task`. Mixed work = split into separate tasks linked by `dependsOnTaskIds` (set those via subsequent `update_task` calls or a future tool).",
        "",
        "If the feature context does not reference any workflow execution or workflow editor work, you probably do not need this tool at all — most features are code-only.",
        "",
        "**One task per workflowId.** Only generate different workflow tasks if they target a different workflow. For new workflows (no `workflowId`), generate only one task per distinct new workflow being built.",
        "",
        "**workflowId rules (CRITICAL).** Do NOT invent workflow IDs. Only set `workflowId` when the feature context (architecture, requirements, brief) explicitly references a Stakwork workflow by ID or unambiguously names one. For new workflows, OMIT `workflowId` — never set it to null, never pass 0, never guess. The system records the new-workflow intent internally.",
        "",
        "**Title** — actionable verb + what to run/build (e.g. 'Run nightly transcription workflow to backfill missing media', 'Build new data-ingestion pipeline in workflow editor').",
        "",
        "**Description** — markdown. Include the input parameters the workflow expects (the `set_var` keys), the expected outputs / success criteria, and how to verify it ran correctly. Same combine-don't-fragment philosophy as coding tasks: testing is part of the task, not a separate ticket.",
        "",
        "**Priority** — CRITICAL (blockers), HIGH (core), MEDIUM (standard, default), LOW (nice-to-have).",
      ].join("\n"),
      inputSchema: {
        featureId: z
          .string()
          .describe(
            "Feature ID to attach this task to. Get this from `featureContext.feature.id`. The feature must belong to this workspace.",
          ),
        title: z
          .string()
          .describe(
            "Actionable title: verb + what to run/build. Examples: 'Run nightly transcription workflow', 'Build new data-ingestion pipeline in workflow editor'.",
          ),
        description: z
          .string()
          .optional()
          .describe(
            "Markdown description with input parameters (set_var keys), expected outputs, success criteria, and how to verify.",
          ),
        priority: z
          .enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"])
          .optional()
          .describe("CRITICAL | HIGH | MEDIUM (default) | LOW."),
        workflowId: z
          .number()
          .int()
          .optional()
          .describe(
            "Integer ID of an EXISTING Stakwork workflow. Omit entirely (NOT null) when the task targets a brand-new workflow to be built in the editor. Never invent a value — only set when the feature context explicitly references a workflow by ID.",
          ),
        workflowName: z
          .string()
          .optional()
          .describe(
            "Human-readable workflow name (only meaningful when `workflowId` is also set). Helps display the task in the UI before the workflow is opened.",
          ),
        workflowRefId: z
          .string()
          .optional()
          .describe(
            "Stakwork workflow ref id (only meaningful when `workflowId` is also set).",
          ),
        workflowTaskType: z
          .enum(["SKILL", "WORKFLOW", "SCRIPT", "PROMPT"])
          .optional()
          .describe(
            "The Stakwork execution type for this workflow task: SKILL (routed work unit), WORKFLOW (sub-workflow runner), SCRIPT (Python Lambda), or PROMPT (reusable text template). Omit if unknown.",
          ),
        dependsOnTaskIds: z
          .array(z.string())
          .optional()
          .describe(
            "IDs of tasks this task depends on. The dependency chart on the Feature page is only shown when at least one task has dependencies.",
          ),
        creator: z
          .string()
          .optional()
          .describe(
            "Name of the creator (matched against name or alias). If omitted or unmatched, defaults to the feature's creator, then the workspace owner.",
          ),
      },
    },
    async (
      {
        featureId,
        title,
        description,
        priority,
        workflowId,
        workflowName,
        workflowRefId,
        workflowTaskType,
        dependsOnTaskIds,
        creator,
      }: {
        featureId: string;
        title: string;
        description?: string;
        priority?: string;
        workflowId?: number;
        workflowName?: string;
        workflowRefId?: string;
        workflowTaskType?: "SKILL" | "WORKFLOW" | "SCRIPT" | "PROMPT";
        dependsOnTaskIds?: string[];
        creator?: string;
      },
      extra,
    ) => {
      const authExtra = extra.authInfo?.extra as McpAuthExtra | undefined;
      // Don't resolve `creator` here — mcpCreateWorkflowTask owns
      // attribution so it can default to the feature's creator (not the
      // workspace owner) when no hint matches.
      const result = await getWorkspaceAuth(authExtra, "create_workflow_task");
      if (result.error) return result.error;
      // Gate: workflow tasks are stakwork-only (belt-and-suspenders with
      // the same check inside mcpCreateWorkflowTask).
      if (!isWorkflowTasksEnabled(result.auth!)) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: workflow tasks are only supported on the stakwork workspace",
            },
          ],
          isError: true,
        };
      }
      return mcpCreateWorkflowTask(
        result.auth!,
        featureId,
        { title, description, priority, dependsOnTaskIds },
        { workflowId, workflowName, workflowRefId, workflowTaskType },
        creator,
      );
    },
  );

  server.registerTool(
    "update_task",
    {
      title: "Update Task",
      description:
        "Update an existing task's title, description, priority, and/or dependsOnTaskIds. Only these four fields are updatable — status, workflow status, and feature attachment are intentionally excluded. Pass only the fields you want to change.",
      inputSchema: {
        taskId: z.string().describe("The ID of the task to update"),
        title: z
          .string()
          .optional()
          .describe("New title for the task"),
        description: z
          .string()
          .optional()
          .describe(
            "New description for the task. Pass an empty string to clear the description.",
          ),
        priority: z
          .enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"])
          .optional()
          .describe("New priority (LOW, MEDIUM, HIGH, CRITICAL)."),
        dependsOnTaskIds: z
          .array(z.string())
          .optional()
          .describe(
            "Replace the full list of task IDs this task depends on. Pass an empty array [] to clear all dependencies.",
          ),
        editor: z
          .string()
          .optional()
          .describe(
            "Name of the user making the edit (matched against name or alias). Falls back to workspace owner if not found.",
          ),
      },
    },
    async (
      {
        taskId,
        title,
        description,
        priority,
        dependsOnTaskIds,
        editor,
      }: {
        taskId: string;
        title?: string;
        description?: string;
        priority?: string;
        dependsOnTaskIds?: string[];
        editor?: string;
      },
      extra,
    ) => {
      const authExtra = extra.authInfo?.extra as McpAuthExtra | undefined;
      const result = await getWorkspaceAuth(authExtra, "update_task", editor);
      if (result.error) return result.error;
      return mcpUpdateTask(result.auth!, taskId, { title, description, priority, dependsOnTaskIds });
    },
  );

  server.registerTool(
    "create_prompt",
    {
      title: "Create Prompt",
      description: [
        "Create a new versioned prompt template in the stakwork prompt library.",
        "",
        "**Availability.** Only supported on the `stakwork` workspace.",
        "",
        "**Name format.** Must be UPPERCASE letters, digits, and underscores only (e.g. `MY_PROMPT_V2`). Duplicate names are rejected.",
        "",
        "Returns the new prompt id, name, and initial version info.",
      ].join("\n"),
      inputSchema: {
        name: z
          .string()
          .describe(
            "Prompt name — UPPERCASE_UNDERSCORE format only (e.g. MY_PROMPT). Must be unique.",
          ),
        value: z.string().describe("The prompt text/template content."),
        description: z
          .string()
          .optional()
          .describe("Optional human-readable description of what this prompt does."),
      },
    },
    async (
      { name, value, description }: { name: string; value: string; description?: string },
      extra,
    ) => {
      const authExtra = extra.authInfo?.extra as McpAuthExtra | undefined;
      const result = await getWorkspaceAuth(authExtra, "create_prompt");
      if (result.error) return result.error;
      if (!isWorkflowTasksEnabled(result.auth!)) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: prompt tools are only supported on the stakwork workspace",
            },
          ],
          isError: true,
        };
      }
      return mcpCreatePrompt(result.auth!, name, value, description);
    },
  );

  server.registerTool(
    "update_prompt",
    {
      title: "Update Prompt",
      description: [
        "Push a new version of an existing prompt. The prior versions are preserved — this does NOT overwrite history.",
        "",
        "**Availability.** Only supported on the `stakwork` workspace.",
        "",
        "Pass the prompt `id` (not name) and the new `value`. Optionally update `description`. The prompt name cannot be changed via this tool.",
      ].join("\n"),
      inputSchema: {
        promptId: z.string().describe("ID of the prompt to update."),
        value: z
          .string()
          .describe("New prompt content — creates a new PromptVersion."),
        description: z
          .string()
          .optional()
          .describe("Updated description. Omit to keep the existing description."),
      },
    },
    async (
      { promptId, value, description }: { promptId: string; value: string; description?: string },
      extra,
    ) => {
      const authExtra = extra.authInfo?.extra as McpAuthExtra | undefined;
      const result = await getWorkspaceAuth(authExtra, "update_prompt");
      if (result.error) return result.error;
      if (!isWorkflowTasksEnabled(result.auth!)) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: prompt tools are only supported on the stakwork workspace",
            },
          ],
          isError: true,
        };
      }
      return mcpUpdatePrompt(result.auth!, promptId, value, description);
    },
  );

  server.registerTool(
    "send_to_task_agent",
    {
      title: "Send Message to Task Agent",
      description:
        "Send a message to a task's agent chat. Use this from the plan agent (or other orchestrating agent) to coordinate with a task — push context, ask a question, or propagate a decision made at the plan level. This is delegation, not editing: the task agent owns its own work; you're sending a chat message and it replies asynchronously. Fire-and-forget — returns once the message is delivered, NOT once the agent replies. Fails if the task agent is currently running (workflowStatus === 'IN_PROGRESS'); use read_task to check and wait until it leaves IN_PROGRESS before sending. The message is automatically prefixed with `[via plan agent]` so the task agent can recognize cross-context coordination signals; lead your message with a one-line reason for context.",
      inputSchema: {
        taskId: z
          .string()
          .describe("The ID of the task whose agent to message"),
        message: z
          .string()
          .describe(
            "The message to send. Lead with a short framing of WHY you're reaching out so the task agent has context.",
          ),
        sender: z
          .string()
          .optional()
          .describe(
            "Name of the sender (matched against name or alias). Falls back to workspace owner if not found.",
          ),
      },
    },
    async (
      {
        taskId,
        message,
        sender,
      }: { taskId: string; message: string; sender?: string },
      extra,
    ) => {
      const authExtra = extra.authInfo?.extra as McpAuthExtra | undefined;
      const result = await getWorkspaceAuth(
        authExtra,
        "send_to_task_agent",
        sender,
      );
      if (result.error) return result.error;
      return mcpSendToTaskAgent(result.auth!, taskId, message);
    },
  );

  // ----- Cross-cutting tools -----

  server.registerTool(
    "check_status",
    {
      title: "Check Status",
      description:
        "Get a unified status overview of the workspace. Returns up to 12 active features and tasks updated in the last 7 days, sorted by items needing attention first (workflowStatus COMPLETED), then by most recent. Excludes completed and cancelled items. When a creator is provided, only shows items created by or assigned to that user.",
      inputSchema: {
        creator: z
          .string()
          .optional()
          .describe(
            "Name of the user (matched against name or alias). When provided, filters to items created by or assigned to this user. Falls back to workspace owner if not found.",
          ),
      },
    },
    async ({ creator }: { creator?: string }, extra) => {
      const authExtra = extra.authInfo?.extra as McpAuthExtra | undefined;
      const result = await getWorkspaceAuth(authExtra, "check_status");
      if (result.error) return result.error;
      // Resolve the creator separately — only filter when explicitly provided.
      // If the name doesn't match anyone, return all (no filter).
      const filterUserId = creator
        ? await findWorkspaceUser(result.auth!.workspaceId, creator)
        : undefined;
      return mcpCheckStatus(result.auth!, filterUserId);
    },
  );

  // ----- Shared tools -----

  server.registerTool(
    "send_message",
    {
      title: "Send Message",
      description:
        "Send a message to a feature's planning chat or a task's agent chat. Provide exactly one of featureId or taskId. For features this triggers the AI planning workflow; for tasks it triggers the agent workflow.",
      inputSchema: {
        featureId: z
          .string()
          .optional()
          .describe("The ID of the feature to send a message to"),
        taskId: z
          .string()
          .optional()
          .describe("The ID of the task to send a message to"),
        message: z
          .string()
          .describe("The message text to send"),
        creator: z
          .string()
          .optional()
          .describe(
            "Name of the sender (matched against name or alias). Falls back to workspace owner if not found.",
          ),
      },
    },
    async ({ featureId, taskId, message, creator }: { featureId?: string; taskId?: string; message: string; creator?: string }, extra) => {
      const authExtra = extra.authInfo?.extra as McpAuthExtra | undefined;
      const result = await getWorkspaceAuth(authExtra, "send_message", creator);
      if (result.error) return result.error;
      return mcpSendMessage(result.auth!, message, featureId, taskId);
    },
  );

  return server;
}

// Verify a short-lived JWT and resolve into an AuthInfo. Dispatches
// on the `scope` claim:
//   - "org"        → org-scope tokens minted by /api/mcp/org-token,
//                    verified by `verifyOrgJwt`. Carries org-wide
//                    permissions + org membership re-check.
//   - "workspace"  → legacy workspace tokens minted by /api/livekit-
//     or absent       token. Carries a workspace slug + per-tool
//                    swarm credentials. Default for any token without
//                    a `scope` claim (back-compat).
async function verifyJwt(
  token: string,
  url: URL,
): Promise<AuthInfo | undefined> {
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) return undefined;

  let payload: Record<string, unknown>;
  try {
    payload = jwt.verify(token, jwtSecret) as Record<string, unknown>;
  } catch {
    return undefined;
  }

  // Org-scope branch — no workspace lookup, no swarm resolution.
  if (payload.scope === "org") {
    return verifyOrgJwt(token, payload);
  }

  // Workspace-scope branch (default). The legacy token shape carries
  // `slug` + `userId`; tokens without `slug` are rejected.
  const wsPayload = payload as { slug?: string; userId?: string };
  if (!wsPayload.slug) return undefined;

  try {
    const workspace = await db.workspace.findFirst({
      where: { slug: wsPayload.slug, deleted: false },
      select: { id: true, slug: true, name: true, ownerId: true },
    });
    if (!workspace) {
      console.log("[MCP] JWT workspace not found:", wsPayload.slug);
      return undefined;
    }

    // IDOR hardening: if the JWT carries a userId (minted by
    // /api/livekit-token), re-validate that the user is still a member of
    // the workspace at use time. Legacy JWTs without userId are rejected.
    if (!wsPayload.userId) {
      console.log("[MCP] JWT missing userId claim — rejecting legacy token");
      return undefined;
    }

    const isOwner = workspace.ownerId === wsPayload.userId;
    if (!isOwner) {
      const membership = await db.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: workspace.id,
            userId: wsPayload.userId,
          },
        },
        select: { role: true },
      });
      if (!membership) {
        console.log(
          "[MCP] JWT user is no longer a member of workspace:",
          workspace.slug,
        );
        return undefined;
      }
    }

    console.log("[MCP] JWT verified for workspace:", workspace.slug);

    const swarmAccess = await getSwarmAccessByWorkspaceId(workspace.id);
    if (!swarmAccess.success) {
      console.log(
        "[MCP] Swarm access failed:",
        swarmAccess.error,
        "- tools will be unavailable",
      );
    } else {
      console.log("[MCP] Swarm access obtained");
    }

    const toolsFilter = parseToolsFilter(url);

    return {
      token,
      clientId: workspace.id,
      scopes: [],
      extra: {
        workspaceId: workspace.id,
        workspaceSlug: workspace.slug,
        apiKeyId: "jwt",
        swarmUrl: swarmAccess.success ? swarmAccess.data.swarmUrl : undefined,
        swarmApiKey: swarmAccess.success
          ? swarmAccess.data.swarmApiKey
          : undefined,
        toolsFilter: toolsFilter ?? undefined,
      } as McpAuthExtra,
    };
  } catch {
    // Preserves the original function's behavior: any DB error here
    // falls through to a 401. Refactoring to surface a 500 would be a
    // policy change worth its own discussion.
    return undefined;
  }
}

// Verify a short-lived org-scope JWT (signed by /api/mcp/org-token).
//
// Shape (see also `orgMcpTools.ts`):
//   {
//     scope: "org",
//     orgId: string,
//     userId: string,
//     permissions: ("read" | "write")[],
//     purpose: string,
//     iat, exp, jti
//   }
//
// Re-validates org membership at use time (mirrors workspace-JWT IDOR
// hardening): a user removed from every workspace in the org after
// the token was minted should not be able to drive the org agent.
async function verifyOrgJwt(
  token: string,
  payload: Record<string, unknown>,
): Promise<AuthInfo | undefined> {
  const orgId = typeof payload.orgId === "string" ? payload.orgId : undefined;
  const userId =
    typeof payload.userId === "string" ? payload.userId : undefined;
  const purpose =
    typeof payload.purpose === "string" ? payload.purpose : "unknown";
  const jti = typeof payload.jti === "string" ? payload.jti : undefined;
  const rawPermissions = Array.isArray(payload.permissions)
    ? payload.permissions
    : [];

  if (!orgId || !userId) {
    console.log("[MCP] Org JWT missing orgId or userId");
    return undefined;
  }

  // Normalize + filter to known permissions. Unknown values are
  // silently dropped rather than failing the token outright, so
  // additive future permissions don't break older verifiers in
  // mixed-version deployments.
  const permissions: OrgPermission[] = rawPermissions.filter(isOrgPermission);
  if (!permissions.includes("read")) {
    console.log("[MCP] Org JWT missing required 'read' permission");
    return undefined;
  }

  // Re-validate org membership: user must own or be an active member
  // of at least one workspace under this org. Same predicate as
  // `resolveAuthorizedOrgId` but inlined to keep the org-id known
  // (we don't need to re-resolve it from a githubLogin).
  //
  // DB errors fall through to 401 (return undefined) to match the
  // workspace-JWT branch's behavior — verification is best-effort and
  // a transient DB blip should not get distinguished from "not a
  // member" to the client.
  let membership: { id: string } | null;
  try {
    membership = await db.workspace.findFirst({
      where: {
        sourceControlOrgId: orgId,
        deleted: false,
        OR: [
          { ownerId: userId },
          { members: { some: { userId, leftAt: null } } },
        ],
      },
      select: { id: true },
    });
  } catch (err) {
    console.error("[MCP] Org JWT membership check failed:", err);
    return undefined;
  }
  if (!membership) {
    console.log(
      `[MCP] Org JWT user ${userId} no longer has membership in org ${orgId}`,
    );
    return undefined;
  }

  console.log(
    `[MCP] Org JWT verified: org=${orgId} user=${userId} perms=${permissions.join(",")} purpose=${purpose}`,
  );

  return {
    token,
    clientId: orgId,
    scopes: [],
    extra: {
      scope: "org" as const,
      orgId,
      userId,
      permissions,
      purpose,
      jti,
    } satisfies OrgMcpAuthExtra,
  };
}

async function verifyToken(req: Request): Promise<AuthInfo | undefined> {
  const url = new URL(req.url);

  // Extract bearer token from Authorization header
  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : undefined;

  const token =
    url.searchParams.get("apiKey") ||
    url.searchParams.get("hiveToken") ||
    bearerToken;

  if (!token) {
    console.log("[MCP] No token provided");
    return undefined;
  }

  // Try long-lived workspace API key first
  if (token.startsWith("hive_")) {
    const result = await validateApiKey(token);
    if (!result) {
      console.log("[MCP] API key validation failed");
      return undefined;
    }
    console.log("[MCP] API key validated for workspace:", result.workspace.slug);

    const swarmAccess = await getSwarmAccessByWorkspaceId(result.workspace.id);
    if (!swarmAccess.success) {
      console.log(
        "[MCP] Swarm access failed:",
        swarmAccess.error,
        "- tools will be unavailable",
      );
    } else {
      console.log("[MCP] Swarm access obtained");
    }

    const toolsFilter = parseToolsFilter(url);

    return {
      token,
      clientId: result.workspace.id,
      scopes: [],
      extra: {
        workspaceId: result.workspace.id,
        workspaceSlug: result.workspace.slug,
        apiKeyId: result.apiKey.id,
        swarmUrl: swarmAccess.success ? swarmAccess.data.swarmUrl : undefined,
        swarmApiKey: swarmAccess.success
          ? swarmAccess.data.swarmApiKey
          : undefined,
        toolsFilter: toolsFilter ?? undefined,
      } as McpAuthExtra,
    };
  }

  // Fall back to short-lived JWT
  return verifyJwt(token, url);
}

const UNAUTHORIZED = () =>
  new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });

/**
 * Handle an MCP request using the SDK's web-standard transport directly.
 * Each invocation gets a fresh stateless transport — no leaked state, no
 * monkey-patched globals, no fake Node.js HTTP objects.
 */
export async function handleMcpRequest(req: Request): Promise<Response> {
  // Authenticate
  const authInfo = await verifyToken(req);
  if (!authInfo) return UNAUTHORIZED();

  // Pick the tool family based on the token's scope. Org-scope tokens
  // get a server with just `org_agent`; workspace-scope tokens get the
  // full existing tool surface. The auth context is mutually
  // exclusive — see `createServer` for the rationale.
  const scope =
    (authInfo.extra as { scope?: string } | undefined)?.scope === "org"
      ? "org"
      : "workspace";

  // For org-scope, resolve the org's display name once per request so
  // the `org_agent` tool description can name the org concretely
  // (e.g. "Stakwork") instead of the generic "this organization".
  // Best-effort: a DB hiccup or a row with neither `name` nor
  // `githubLogin` falls back to the generic description rather than
  // failing the request — the tool still works, the agent just sees
  // less context.
  let orgName: string | undefined;
  if (scope === "org") {
    const orgId = (authInfo.extra as OrgMcpAuthExtra).orgId;
    try {
      const org = await db.sourceControlOrg.findUnique({
        where: { id: orgId },
        select: { name: true, githubLogin: true },
      });
      orgName = org?.name ?? org?.githubLogin ?? undefined;
    } catch (err) {
      console.warn("[MCP] org name lookup failed:", err);
    }
  }

  // Fresh server + stateless transport per request
  const server = createServer(scope, { orgName });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });

  await server.connect(transport);

  try {
    return await transport.handleRequest(req, { authInfo });
  } catch (error) {
    console.error("[MCP] Transport error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
