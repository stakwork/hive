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

export interface WorkflowContent {
  projectId?: string; // For polling mode (Stakwork project)
  workflowJson?: string; // For direct rendering from graph (current/updated version)
  originalWorkflowJson?: string; // Original workflow JSON before changes
  workflowId?: number; // Workflow ID from graph
  workflowName?: string; // Optional workflow name
  workflowRefId?: string; // Graph node ref_id
  workflowVersionId?: number; // Version ID to fetch updated spec from Stakwork
}

export interface PublishWorkflowContent {
  workflowId: number; // Workflow ID to publish
  workflowName?: string; // Workflow name for display
  workflowRefId?: string; // Graph node ref_id
  published?: boolean; // Whether the workflow has been published
  publishedAt?: string; // ISO timestamp of when it was published
  workflowVersionId?: number; // Version ID returned from publish API
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
  state: "healthy" | "conflict" | "ci_failure" | "checking";
  lastCheckedAt: string;

  // GitHub data
  mergeable?: boolean | null;
  ciStatus?: "pending" | "success" | "failure";
  ciSummary?: string; // "5/5 passed" or "build: failed"

  // Problem details (when state !== "healthy")
  problemDetails?: string;
  conflictFiles?: string[]; // If conflict
  failedChecks?: string[]; // If CI failure

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
    | PublishWorkflowContent;
}

// Using Prisma Attachment type directly (no additional fields needed)
export type Attachment = PrismaAttachment;

export interface ChatMessage extends Omit<PrismaChatMessage, "contextTags" | "artifacts" | "attachments"> {
  contextTags?: ContextTag[];
  artifacts?: Artifact[];
  attachments?: Attachment[];
}

// Helper functions to create client-side types with proper conversions
export function createChatMessage(data: {
  id: string;
  message: string;
  role: ChatRole;
  status: ChatStatus;
  taskId?: string;
  workflowUrl?: string;
  contextTags?: ContextTag[];
  artifacts?: Artifact[];
  attachments?: Attachment[];
  sourceWebsocketID?: string;
  replyId?: string;
}): ChatMessage {
  return {
    id: data.id,
    taskId: data.taskId || null,
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
    | PublishWorkflowContent;
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
