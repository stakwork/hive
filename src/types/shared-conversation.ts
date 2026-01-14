// Message structure for shared conversations
export interface SharedMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}

// Provenance data structure for tracking conversation origin
export interface ProvenanceData {
  sourceType?: "agent" | "quick_ask" | "learn" | "manual";
  sourceId?: string; // task ID or other source identifier
  metadata?: Record<string, unknown>;
}

// Full shared conversation data structure
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

// Request body for creating a shared conversation
export interface CreateSharedConversationRequest {
  messages: SharedMessage[];
  provenanceData?: ProvenanceData;
  followUpQuestions?: string[];
}

// Response for creating a shared conversation
export interface CreateSharedConversationResponse {
  shareId: string;
  url: string;
}

// Response for getting a shared conversation
export interface GetSharedConversationResponse {
  conversation: SharedConversationData;
}
