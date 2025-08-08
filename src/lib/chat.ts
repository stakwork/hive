// Import Prisma-generated types for enums that are duplicated
import {
  ChatRole,
  ChatStatus,
  ContextTagType,
  ArtifactType,
  WorkflowStatus,
} from "@prisma/client";
import type {
  ChatMessage as PrismaChatMessage,
  Artifact as PrismaArtifact,
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
export type ArtifactIcon = 'Code' | 'Agent' | 'Call' | 'Message';

export interface LongformContent {
  text: string;
  title?: string;
}

// Client-side types that extend Prisma types with proper JSON field typing
export interface Artifact extends Omit<PrismaArtifact, "content"> {
  content?: FormContent | CodeContent | BrowserContent | LongformContent;
}

export interface ChatMessage
  extends Omit<PrismaChatMessage, "contextTags" | "artifacts"> {
  contextTags?: ContextTag[];
  artifacts?: Artifact[];
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
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export function createArtifact(data: {
  id: string;
  messageId: string;
  type: ArtifactType;
  content?: FormContent | CodeContent | BrowserContent | LongformContent;
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
