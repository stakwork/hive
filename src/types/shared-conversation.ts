// Types for SharedConversation feature

export interface SharedConversationData {
  id: string;
  workspaceId: string;
  userId: string;
  title?: string | null;
  messages: unknown; // AI SDK UIMessage[] format stored as JSON
  provenanceData?: unknown | null; // ProvenanceData format stored as JSON
  followUpQuestions: unknown; // string[] format stored as JSON
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
  conversationId?: string; // Optional: update existing conversation instead of creating new one
}

export interface SharedConversationResponse {
  shareId: string;
  url: string; // Format: `/w/${slug}/chat/shared/${shareId}`
}

// Conversation management types
export interface ConversationListItem {
  id: string;
  title: string | null;
  lastMessageAt: string | null;
  preview: string; // Preview of first message
  source: string | null;
  isShared: boolean;
  createdAt: string;
}

export interface ConversationDetail extends SharedConversationData {
  source: string | null;
  isShared: boolean;
  lastMessageAt: string | null;
}

export interface UpdateConversationRequest {
  messages: unknown[]; // Messages to append
  title?: string; // Optional: update title
}

export interface CreateConversationRequest {
  messages: unknown[]; // AI SDK UIMessage[] format
  provenanceData?: unknown; // ProvenanceData format (optional)
  followUpQuestions?: unknown; // string[] format (optional)
  title?: string; // Optional title for the conversation
  source?: string; // Optional source identifier
}
