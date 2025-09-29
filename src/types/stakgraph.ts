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

export type TestStatus = "all" | "tested" | "untested";

export interface NodeFull {
  node_type: string;
  ref_id: string;
  weight: number;
  test_count: number;
  covered: boolean;
  properties: Record<string, unknown>;
}

export interface NodeConcise {
  name: string;
  file: string;
  weight: number;
  test_count: number;
  covered: boolean;
}

export type NodesResponseItem = NodeFull | NodeConcise;

export interface NodesResponse {
  functions?: NodesResponseItem[];
  endpoints?: NodesResponseItem[];
}

export interface CoverageNodeConcise {
  name: string;
  file: string;
  weight: number;
  test_count: number;
}

export interface CoverageNodesResponse {
  success: boolean;
  data?: {
    node_type: UncoveredNodeType;
    page: number;
    pageSize: number;
    hasNextPage: boolean;
    items: CoverageNodeConcise[];
    total_count?: number;
    total_pages?: number;
    total_returned?: number;
  };
  message?: string;
  details?: unknown;
}
