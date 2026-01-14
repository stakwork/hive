// Types for shared conversation feature

/**
 * Base message interface for serialized messages in shared conversations
 */
export interface SharedConversationMessage {
  id: string;
  content: string;
  role: "user" | "assistant";
  timestamp: Date | string;
  // Additional fields can be added as needed for different message types
}

/**
 * Provenance data for tracking conversation source/context
 */
export interface ProvenanceData {
  source?: string;
  taskId?: string;
  workspaceSlug?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Complete shared conversation data structure
 */
export interface SharedConversationData {
  id: string;
  workspaceId: string;
  userId: string;
  title: string | null;
  messages: SharedConversationMessage[];
  provenanceData: ProvenanceData | null;
  followUpQuestions: string[];
  createdAt: Date | string;
  updatedAt: Date | string;
}

/**
 * Request body for creating a shared conversation
 */
export interface CreateSharedConversationRequest {
  messages: SharedConversationMessage[];
  provenanceData?: ProvenanceData | null;
  followUpQuestions?: string[];
}

/**
 * Response from creating a shared conversation
 */
export interface CreateSharedConversationResponse {
  shareId: string;
  url: string;
}
