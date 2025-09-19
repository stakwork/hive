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

export type UncoveredNodeType = "function" | "endpoint";

export interface UncoveredNodeConcise {
  name: string;
  file: string;
  weight: number;
}

export interface UncoveredNodeFull {
  node_type: string;
  ref_id: string;
  weight: number;
  properties: Record<string, unknown>;
}

export type UncoveredResponseItem = UncoveredNodeFull | UncoveredNodeConcise;

export interface UncoveredResponseRaw {
  functions?: UncoveredResponseItem[];
  endpoints?: UncoveredResponseItem[];
}

export interface UncoveredItemsResponse {
  success: boolean;
  data?: {
    node_type: UncoveredNodeType;
    limit: number;
    offset: number;
    items: UncoveredResponseItem[];
  };
  message?: string;
  details?: unknown;
}
