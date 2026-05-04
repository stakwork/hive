// Types for SharedConversation feature

export interface ConversationSettings {
  extraWorkspaceSlugs?: string[];
}

export interface SharedConversationData {
  id: string;
  workspaceId: string;
  // Null for anonymous public-viewer chats (workspace must be flagged
  // `isPublicViewable`). Always populated for member-authored rows.
  userId: string | null;
  title?: string | null;
  messages: unknown; // AI SDK UIMessage[] format stored as JSON
  provenanceData?: unknown | null; // ProvenanceData format stored as JSON
  followUpQuestions: unknown; // string[] format stored as JSON
  settings?: ConversationSettings | null;
  isShared: boolean;
  lastMessageAt?: string | null;
  source?: string | null;
  createdAt: string;
  updatedAt: string;
  // Null for anonymous public-viewer chats.
  createdBy?: {
    id: string;
    name: string | null;
    email: string | null;
  } | null;
}

export interface CreateSharedConversationRequest {
  messages: unknown; // AI SDK UIMessage[] format
  provenanceData?: unknown; // ProvenanceData format (optional)
  followUpQuestions: unknown; // string[] format
  title?: string; // Optional title for the conversation
  conversationId?: string; // Optional: update existing conversation instead of creating new
  source?: string; // Optional: conversation source (e.g., "learn", "dashboard", "task")
  settings?: ConversationSettings; // Optional: chat settings (e.g., extraWorkspaceSlugs)
}

export interface SharedConversationResponse {
  shareId: string;
  url: string; // Format: `/w/${slug}/chat/shared/${shareId}`
}

// Conversation list item for GET /conversations
export interface ConversationListItem {
  id: string;
  title: string | null;
  lastMessageAt: string | null;
  preview: string | null; // Preview of first message
  source: string | null;
  isShared: boolean;
  createdAt: string;
  updatedAt: string;
  creatorName?: string | null;
  creatorId?: string;
}

// Full conversation detail for GET /conversations/[id]
export interface ConversationDetail extends SharedConversationData {
  // Inherits all fields from SharedConversationData
}

// Request to update conversation with new messages
export interface UpdateConversationRequest {
  messages: unknown[]; // Array of AI SDK UIMessage to append
  title?: string; // Optional: update title
  source?: string; // Optional: update source
  settings?: ConversationSettings; // Optional: update chat settings
}

// Recent chat list item for GET /recent
export interface RecentChatItem {
  id: string;
  title: string | null;
  lastMessageAt: string | null;
  creatorName: string | null;
  creatorId: string;
  source: string | null;
}
