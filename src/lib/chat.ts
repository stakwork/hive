// Import Prisma-generated types for enums that are duplicated
import {
  ChatRole,
  ChatStatus,
  ContextTagType,
  ArtifactType,
} from "@prisma/client";
import type {
  ChatMessage as PrismaChatMessage,
  Artifact as PrismaArtifact,
} from "@prisma/client";

// Re-export Prisma enums
export { ChatRole, ChatStatus, ContextTagType, ArtifactType };

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

export interface BugReportContent {
  bugDescription: string;
  iframeUrl: string;
  method: 'click' | 'selection';
  sourceFiles: Array<{
    file: string;
    lines: number[];
    context?: string;
  }>;
  coordinates?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
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
export interface LongformContent {
  text: string;
  title?: string;
}

// Client-side types that extend Prisma types with proper JSON field typing
export interface Artifact extends Omit<PrismaArtifact, "content"> {
  content?: FormContent | CodeContent | BrowserContent | BugReportContent | LongformContent;
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
  contextTags?: ContextTag[];
  artifacts?: Artifact[];
  sourceWebsocketID?: string;
  replyId?: string;
}): ChatMessage {
  return {
    id: data.id,
    taskId: data.taskId || null,
    message: data.message,
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
}): Artifact {
  return {
    id: data.id,
    messageId: data.messageId,
    type: data.type,
    content: data.content,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// Safe JSON parsing utility for contextTags field
export function parseContextTags(contextTags: unknown): ContextTag[] {
  try {
    // Handle null or undefined
    if (contextTags == null) {
      return [];
    }

    // Handle empty string
    if (contextTags === '') {
      return [];
    }

    // Handle already parsed objects
    if (Array.isArray(contextTags)) {
      return contextTags as ContextTag[];
    }

    // Handle string values
    if (typeof contextTags === 'string') {
      // Handle empty JSON string
      if (contextTags.trim() === '') {
        return [];
      }
      
      const parsed = JSON.parse(contextTags);
      return Array.isArray(parsed) ? parsed : [];
    }

    // Fallback for any other types
    return [];
  } catch (error) {
    console.warn('Failed to parse contextTags:', error, 'Input:', contextTags);
    return [];
  }
}
