// Types for Conversation feature (private chat history)

import type { ProvenanceData } from "@/components/dashboard/DashboardChat/ProvenanceTree";

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  imageData?: string;
  toolCalls?: {
    id: string;
    toolName: string;
    input?: unknown;
    status: string;
    output?: unknown;
    errorText?: string;
  }[];
}

export interface ConversationData {
  id: string;
  workspaceId: string;
  userId: string;
  title?: string | null;
  messages: ConversationMessage[];
  provenanceData?: ProvenanceData | null;
  followUpQuestions: string[];
  sharedConversationId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateConversationRequest {
  messages: ConversationMessage[];
  provenanceData?: ProvenanceData | null;
  followUpQuestions?: string[];
  title?: string;
}

export interface UpdateConversationRequest {
  messages: ConversationMessage[];
  provenanceData?: ProvenanceData | null;
  followUpQuestions?: string[];
  title?: string;
}

export interface ConversationListItem {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ConversationResponse {
  conversation: ConversationData;
}

export interface ConversationListResponse {
  conversations: ConversationListItem[];
  total: number;
}
