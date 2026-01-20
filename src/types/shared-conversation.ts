// Types for SharedConversation feature

export type ConversationSource = "dashboard" | "learn";

export interface SharedConversationData {
  id: string;
  workspaceId: string;
  userId: string;
  title?: string | null;
  messages: unknown; // AI SDK UIMessage[] format stored as JSON
  provenanceData?: unknown | null; // ProvenanceData format stored as JSON
  followUpQuestions: unknown; // string[] format stored as JSON
  isShared: boolean;
  lastMessageAt: string;
  source: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: {
    id: string;
    name: string | null;
    email: string | null;
  };
}

export interface CreateSharedConversationRequest {
  messages: unknown; // AI SDK UIMessage[] format
  provenanceData?: unknown; // ProvenanceData format (optional)
  followUpQuestions: unknown; // string[] format
  title?: string; // Optional title for the conversation
  conversationId?: string; // Optional: link to existing conversation and set isShared=true
}

export interface SharedConversationResponse {
  shareId: string;
  url: string; // Format: `/w/${slug}/chat/shared/${shareId}`
}

// Conversation management types
export interface ConversationListItem {
  id: string;
  title: string | null;
  lastMessageAt: string;
  source: string;
  preview: string;
  messageCount: number;
}

export interface ConversationDetail extends SharedConversationData {
  // All fields from SharedConversationData
}

export interface CreateConversationRequest {
  messages: unknown; // AI SDK UIMessage[] format
  title?: string; // Optional title (auto-generated if not provided)
  followUpQuestions: unknown; // string[] format
  provenanceData?: unknown; // ProvenanceData format (optional)
  source: ConversationSource;
}

export interface UpdateConversationRequest {
  messages?: unknown; // AI SDK UIMessage[] format (appended to existing)
  followUpQuestions?: unknown; // string[] format
  provenanceData?: unknown; // ProvenanceData format
  title?: string;
}
