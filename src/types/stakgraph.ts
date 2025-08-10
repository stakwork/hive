export interface WebhookPayload {
  request_id: string;
  status: string;
  progress: number;
  result?: { nodes?: number; edges?: number } | null;
  error?: string | null;
  started_at?: string;
  completed_at?: string;
  duration_ms?: number;
}

export interface StakgraphStatusResponse {
  status?: string;
  progress?: number;
  result?: { nodes?: number; edges?: number };
}
