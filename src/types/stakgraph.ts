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

export type UncoveredNodeType = "function" | "endpoint" | "class" | "mock";

export interface MockServiceItem {
  name: string;
  ref_id: string;
  description: string;
  linked_files: string[];
  file_count: number;
  mocked: boolean;
}

export interface MockInventoryResponse {
  items: MockServiceItem[];
  total_count: number;
  total_returned: number;
}

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
  ref_id: string;
  weight: number;
  test_count: number;
  covered: boolean;
  body_length: number | null;
  line_count: number | null;
  verb?: string;
  meta?: Record<string, unknown>;
  is_muted?: boolean;
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
    ignoreDirs?: string;
    unitGlob?: string;
    integrationGlob?: string;
    e2eGlob?: string;
  };
  message?: string;
  details?: unknown;
}
