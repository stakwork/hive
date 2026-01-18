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
}

export interface CreateSharedConversationRequest {
  messages: unknown; // AI SDK UIMessage[] format
  provenanceData?: unknown; // ProvenanceData format (optional)
  followUpQuestions: unknown; // string[] format
  title?: string; // Optional title for the conversation
}

export interface SharedConversationResponse {
  shareId: string;
  url: string; // Format: `/w/${slug}/chat/shared/${shareId}`
}
