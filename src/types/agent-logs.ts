import type { AgentRunConfig } from "@/lib/utils/agent-log-stats";

export type { AgentRunConfig };

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
  model?: string | null;
  provider?: string | null;
  source?: string | null;
  repos?: string[];
  sessionId?: string | null;
  config?: AgentRunConfig | null;
  traceId?: string | null;
  phoenixTraceUrl?: string | null;
  traceStatus?: "pending" | "ready" | "error" | null;
}

export interface AgentLogsResponse {
  data: AgentLogRecord[];
  total: number;
  hasMore: boolean;
}
