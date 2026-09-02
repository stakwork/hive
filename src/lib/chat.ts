// Import Prisma-generated types for enums that are duplicated
import { ChatRole, ChatStatus, ContextTagType, ArtifactType, WorkflowStatus } from "@prisma/client";
import type {
  ChatMessage as PrismaChatMessage,
  Artifact as PrismaArtifact,
  Attachment as PrismaAttachment,
} from "@prisma/client";

// Re-export Prisma enums
export { ChatRole, ChatStatus, ContextTagType, ArtifactType, WorkflowStatus };

export interface ContextTag {
  type: ContextTagType;
  id: string;
}

export interface CodeContent {
  content: string; // the code
  language?: string;
  file?: string;
  change?: string;
  action?: string;
}

export interface BrowserContent {
  url: string;
  podId?: string;
  agentPassword?: string;
}

export interface IDEContent {
  url: string;
  podId?: string;
  agentPassword?: string;
}

export interface GraphContent {
  ref_id: string;
  depth?: number;
  cluster_title?: string;
}

export interface Option {
  actionType: "button" | "chat";
  optionLabel: string;
  optionResponse: string;
}

export interface FormContent {
  actionText: string;
  webhook: string;
  options: Option[];
}
// Artifact icon system - modular and reusable across all artifact types
export type ArtifactIcon = "Code" | "Agent" | "Call" | "Message";

export interface LongformContent {
  text: string;
  title?: string;
}

export type VerifyOutcome = "works" | "broken" | "unknown";

export interface VerifyEvidence {
  id: string;
  kind: "screenshot" | "http" | "log" | "timing" | "dom" | "note";
  summary: string;
  data: string;
}

export interface VerifyClaim {
  claim: string;
  verdict: VerifyOutcome;
  proof: string[];
  reasoning: string;
}

export interface VerifyContent {
  overall: VerifyOutcome;
  claims: VerifyClaim[];
  observations: string[];
  summary: string;
  evidence: VerifyEvidence[];
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

export interface BugReportContent {
  bugDescription: string;
  iframeUrl: string;
  method: "click" | "selection";
  sourceFiles: Array<{
    file: string;
    lines: number[];
    context?: string;
    message?: string;
    componentNames?: Array<{
      name: string;
      level: number;
      type: string;
      element: string;
    }>;
  }>;
  coordinates?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

/**
 * A workflow spec captured from Stakwork's version API
 * (`GET /workflows/:id?workflow_version_id=:vid`) at artifact-ingestion time.
 *
 * `value` is always the canonicalised spec string (stable key order) so two
 * snapshots can be diffed directly. Never mix these with graph-sourced
 * `workflowJson` — the graph returns a structurally different shape.
 */
export interface WorkflowVersionSnapshot {
  workflowVersionId: string;
  value: string;
}

export interface WorkflowContent {
  projectId?: string; // For polling mode (Stakwork project)
  workflowJson?: string | object | null; // For direct rendering from graph (current/updated version)
  originalWorkflowJson?: string | object | null; // Original workflow JSON before changes
  publishedWorkflowJson?: string | object | null; // Durable snapshot of the just-published workflow JSON (set on publish artifacts)
  workflowId?: number | string; // Workflow ID from graph, or "new" for new workflows
  workflowName?: string; // Optional workflow name
  workflowRefId?: string; // Graph node ref_id
  workflowVersionId?: string | number; // Workflow version ID (UUID or numeric) from graph
  /**
   * The version this change was based on, stated by whoever created the version.
   *
   * Authoritative: it is the only source that cannot be wrong about what this
   * specific change forked from. `null` means a brand-new workflow with nothing
   * before it; absent means an older producer that predates the field.
   */
  previousWorkflowVersionId?: string | number | null;
  projectInfo?: any; // Project data for project debugger mode
  debuggerProjectId?: string; // Project ID for debugger context
  /** This artifact's own workflow version spec, pulled at ingestion. Absent = legacy/unenriched artifact. */
  versionSnapshot?: WorkflowVersionSnapshot;
  /** The version this artifact's change is measured against: the previous WORKFLOW artifact's version, or the task's starting version. null = no prior version (brand-new). */
  baselineSnapshot?: WorkflowVersionSnapshot | null;
}

export interface PublishWorkflowContent {
  workflowId: number; // Workflow ID to publish
  workflowName?: string; // Workflow name for display
  workflowRefId?: string; // Graph node ref_id
  published?: boolean; // Whether the workflow has been published
  publishedAt?: string; // ISO timestamp of when it was published
  workflowVersionId?: number; // Version ID returned from publish API
  /** The version this publish's change is measured against, stated by the producer. null = brand-new workflow with nothing before it. */
  previousWorkflowVersionId?: number | null;
  /** Baseline captured at ingestion (previousWorkflowVersionId's spec). null = nothing to compare against. Absent = legacy/unenriched artifact. */
  baselineSnapshot?: WorkflowVersionSnapshot | null;
  /** This artifact's own workflow version spec (workflowVersionId's spec), pulled at ingestion. */
  versionSnapshot?: WorkflowVersionSnapshot;
}

/**
 * Where a captured baseline came from — the "before" side of a change.
 *
 *  • "published" — what was live when the change was made. Only the task's first
 *    change to an item can use this.
 *  • "chain"     — the previous artifact for the same item in this task. Every
 *    change after the first is measured against the one before it.
 *  • "prior"     — the version immediately below the task's first change, used
 *    when nothing is published yet. Positional, so it never moves.
 *
 * Absent on artifacts captured before this field existed.
 */
export type ChangeBaselineSource = "published" | "chain" | "prior";

/** A script version's source captured at artifact-ingestion time. */
export interface ScriptVersionSnapshot {
  value: string;
  versionNumber: number;
}

/** The version a PUBLISH_SCRIPT artifact's change is measured against. */
export interface ScriptBaselineSnapshot {
  value: string;
  versionId: number;
  versionNumber: number;
  source?: ChangeBaselineSource;
}

export interface PublishScriptContent {
  scriptId: number; // Script ID
  scriptVersionId: number; // Script version ID to publish
  scriptName?: string; // Script name for display
  published?: boolean; // Whether the script has been published
  /** Baseline captured at ingestion. null = nothing to compare against. Absent = legacy artifact (rebuilt live). */
  baselineSnapshot?: ScriptBaselineSnapshot | null;
  /** This artifact's own version source + number, captured at ingestion. */
  versionSnapshot?: ScriptVersionSnapshot;
}

/** A prompt version's text captured at artifact-ingestion time, so a diff never drifts when newer versions land later. */
export interface PromptVersionSnapshot {
  value: string;
  versionNumber: number;
}

/**
 * The version a PUBLISH_PROMPT artifact's change is measured against.
 *
 * `source` says where it came from:
 *  • "published" — the prompt's published version at ingestion. This is the
 *    task's *first* change to the prompt, so the published text is the baseline.
 *  • "chain" — the previous PUBLISH_PROMPT artifact for the same prompt in this
 *    task. Every change after the first is measured against the one before it.
 * Absent on artifacts captured before `source` existed (treated as "published").
 */
export interface PromptBaselineSnapshot {
  value: string;
  versionId: string;
  versionNumber: number;
  source?: ChangeBaselineSource;
}

export interface PublishPromptContent {
  promptId: string; // Prompt ID to publish (Hive cuid)
  promptVersionId: string; // Prompt version ID to publish (Hive cuid)
  promptName?: string; // Prompt name for display
  published?: boolean; // Whether the prompt has been published
  /** Baseline captured at ingestion time. null = nothing to compare against (brand-new prompt). Absent = legacy artifact (use live lookup fallback). */
  baselineSnapshot?: PromptBaselineSnapshot | null;
  /** This artifact's own version value + number captured at ingestion, needed for consecutive step diffs. */
  versionSnapshot?: PromptVersionSnapshot;
}

export interface PublishSkillContent {
  skillName?: string; // Skill name for display
  published?: boolean; // Whether the skill has been published
}

// PR monitoring resolution tracking
export interface PullRequestResolution {
  status: "notified" | "in_progress" | "resolved" | "gave_up";
  attempts: number;
  lastAttemptAt?: string;
  lastError?: string;
}

// PR monitoring progress tracking
export interface PullRequestProgress {
  // Current state (what the cron updates)
  // "out_of_date" = behind base branch but no conflicts (can auto-merge)
  state: "healthy" | "conflict" | "ci_failure" | "checking" | "out_of_date";
  lastCheckedAt: string;

  // GitHub data
  mergeable?: boolean | null;
  ciStatus?: "pending" | "success" | "failure";
  ciSummary?: string; // "5/5 passed" or "build: failed"

  // Problem details (when state !== "healthy")
  problemDetails?: string;
  conflictFiles?: string[]; // If conflict
  failedChecks?: string[]; // If CI failure
  failedCheckLogs?: Record<string, string>; // If CI failure

  // Agent resolution tracking
  resolution?: PullRequestResolution;
}

export interface PullRequestContent {
  repo: string;
  url: string;
  status: string;
  progress?: PullRequestProgress;
}

export type Action = "create" | "rewrite" | "modify" | "delete";

export interface ActionResult {
  file: string;
  action: Action;
  content: string;
  repoName: string;
}

export interface DiffContent {
  diffs: ActionResult[];
}

export interface MediaContent {
  url?: string; // Presigned download URL
  s3Key: string; // S3 storage key
  mediaType: "video" | "audio";
  filename: string; // Original filename
  size: number; // File size in bytes
  contentType: string; // MIME type (e.g., "video/webm")
  duration?: number | null; // Duration in seconds (optional)
  uploadedAt: string; // ISO timestamp
}

export interface StreamContent {
  agent?: string; // e.g. "plan-agent-abced" — optional for backwards compat
  requestId: string;
  eventsToken: string;
  baseUrl: string;
}

export interface BountyContent {
  status: "PENDING" | "READY";
  bountyTitle: string;
  bountyDescription: string;
  estimatedHours?: number;
  dueDate?: string;
  priceUsd?: number;
  priceSats?: number;
  staking?: boolean;
  bountyCode: string;
  sourceTaskId: string;
  sourceWorkspaceId: string;
  sourceWorkspaceSlug: string;
  sourceUserId: string;
  workspaceId?: string;
  workspaceSlug?: string;
  repoUrl?: string;
  targetWorkspaceId?: string;
}

// Client-side types that extend Prisma types with proper JSON field typing
export interface Artifact extends Omit<PrismaArtifact, "content"> {
  content?:
    | FormContent
    | CodeContent
    | BrowserContent
    | IDEContent
    | LongformContent
    | BugReportContent
    | GraphContent
    | WorkflowContent
    | PullRequestContent
    | DiffContent
    | MediaContent
    | PublishWorkflowContent
    | PublishScriptContent
    | PublishPromptContent
    | PublishSkillContent
    | BountyContent
    | StreamContent
    | VerifyContent;
}

// Using Prisma Attachment type directly (no additional fields needed)
export type Attachment = PrismaAttachment;

export interface ChatMessage extends Omit<PrismaChatMessage, "contextTags"> {
  contextTags?: ContextTag[];
  artifacts?: Artifact[];
  attachments?: Attachment[];
  createdBy?: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
    githubAuth?: {
      githubUsername: string;
    } | null;
  };
}

// Helper functions to create client-side types with proper conversions
export function createChatMessage(data: {
  id: string;
  message: string;
  role: ChatRole;
  status: ChatStatus;
  taskId?: string;
  featureId?: string;
  workflowUrl?: string;
  contextTags?: ContextTag[];
  artifacts?: Artifact[];
  attachments?: Attachment[];
  sourceWebsocketID?: string;
  replyId?: string;
  createdBy?: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
    githubAuth?: {
      githubUsername: string;
    } | null;
  };
}): ChatMessage {
  return {
    id: data.id,
    taskId: data.taskId || null,
    featureId: data.featureId || null,
    message: data.message,
    workflowUrl: data.workflowUrl || null,
    role: data.role,
    timestamp: new Date(),
    contextTags: data.contextTags || [],
    status: data.status,
    sourceWebsocketID: data.sourceWebsocketID || null,
    replyId: data.replyId || null,
    artifacts: data.artifacts || [],
    attachments: data.attachments || [],
    createdBy: data.createdBy,
    userId: data.createdBy?.id || null,
    stakworkProjectId: null,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export function createArtifact(data: {
  id: string;
  messageId: string;
  type: ArtifactType;
  content?:
    | FormContent
    | CodeContent
    | BrowserContent
    | IDEContent
    | LongformContent
    | BugReportContent
    | GraphContent
    | WorkflowContent
    | PullRequestContent
    | DiffContent
    | MediaContent
    | PublishWorkflowContent
    | PublishScriptContent
    | PublishPromptContent
    | PublishSkillContent
    | BountyContent
    | StreamContent
    | VerifyContent;
  icon?: ArtifactIcon;
}): Artifact {
  return {
    id: data.id,
    messageId: data.messageId,
    type: data.type,
    content: data.content,
    icon: data.icon || null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}
