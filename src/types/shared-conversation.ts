// Types for shared conversation feature

/**
 * Base message structure for shared conversations
 */
export interface SharedMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

/**
 * Provenance data tracking the source of shared conversations
 */
export interface ProvenanceData {
  source?: string;
  timestamp?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Complete shared conversation data
 */
export interface SharedConversationData {
  id: string;
  workspaceId: string;
  userId: string;
  title: string | null;
  messages: SharedMessage[];
  provenanceData: ProvenanceData | null;
  followUpQuestions: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * Request body for creating a shared conversation
 */
export interface CreateSharedConversationRequest {
  messages: SharedMessage[];
  provenanceData?: ProvenanceData | null;
  followUpQuestions: string[];
}

/**
 * Response from creating a shared conversation
 */
export interface CreateSharedConversationResponse {
  shareId: string;
  url: string;
}
