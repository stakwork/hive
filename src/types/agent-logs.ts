export interface AgentLogRecord {
  id: string;
  blobUrl: string;
  agent: string;
  stakworkRunId: string | null;
  taskId: string | null;
  featureTitle: string | null;
  createdAt: Date;
}

export interface AgentLogsResponse {
  data: AgentLogRecord[];
  total: number;
  hasMore: boolean;
}
