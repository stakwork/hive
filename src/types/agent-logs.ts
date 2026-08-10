import type { AgentRunConfig } from "@/lib/utils/agent-log-stats";

export type { AgentRunConfig };

export interface AgentLogStats {
  totalMessages: number;
  estimatedTokens: number;
  totalToolCalls: number;
  toolFrequency: Record<string, number>;
}

/**
 * One gitree Concept the session read, from stakgraph's SessionReflection
 * sidecar (mcp/src/repo/session.ts), stored on AgentLog.reflection.
 * `read_order` is recorded for every concept; `rank`/`evidence`/`contradicts`
 * only exist when a reflect pass judged it — null rank means "not judged",
 * not "useless".
 */
export interface ReflectedConcept {
  id?: string;
  ref_id?: string;
  repo?: string;
  name?: string;
  read_order?: number;
  rank: number | null;
  evidence?: string;
  contradicts?: string;
}

export interface SessionReflection {
  session_id?: string;
  updated_at?: string;
  concepts?: ReflectedConcept[];
  /** Something the agent had to work out from source that no concept covered. */
  gap?: string | null;
  /** Raw model output, kept only when it didn't parse upstream. */
  raw?: string;
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
  reflection?: SessionReflection | null;
  traceId?: string | null;
  phoenixTraceUrl?: string | null;
  traceStatus?: "pending" | "ready" | "error" | null;
}

export interface AgentLogsResponse {
  data: AgentLogRecord[];
  total: number;
  hasMore: boolean;
}
