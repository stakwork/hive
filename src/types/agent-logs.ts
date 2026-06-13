export interface AgentLogStats {
  totalMessages: number;
  estimatedTokens: number;
  totalToolCalls: number;
  toolFrequency: Record<string, number>;
}

export interface AgentLogRecord {
  id: string;
  blobUrl: string;
  agent: string;
  stakworkRunId: string | null;
  taskId: string | null;
  featureTitle: string | null;
  createdAt: Date;
  stats?: AgentLogStats;
  initiatorName?: string | null;
  initiatorImage?: string | null;
}

export interface AgentLogsResponse {
  data: AgentLogRecord[];
  total: number;
  hasMore: boolean;
}
