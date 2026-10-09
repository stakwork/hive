import type { StrutRunStatus } from "@prisma/client";

/** One System Map workflow run, as `GET /api/workspaces/:slug/system-map/runs` lists it. */
export interface SystemMapRun {
  id: string;
  workflow: string;
  strutRunId: string | null;
  status: StrutRunStatus;
  /** The workflow's `output` verbatim (success only). */
  output: unknown;
  error: string | null;
  durationMs: number | null;
  createdAt: string;
  settledAt: string | null;
  /** Hive link to the run in the org strut view; null until the launch returned. */
  strutUrl: string | null;
}

export type SystemMapWorkflowKey = "schema" | "materialize" | "cwe_check" | "cloud_links" | "security_review";

export interface SystemMapRunsResponse {
  /** Which workflow these runs belong to. */
  key: SystemMapWorkflowKey;
  workflow: string;
  runs: SystemMapRun[];
}

/** One node in the graph's `systemmap` namespace, as `GET /api/workspaces/:slug/system-map/nodes` lists it. */
export interface SystemMapDomainNode {
  refId: string;
  type: string;
  /** `properties.name`, else the ref id. */
  name: string;
  properties: Record<string, unknown>;
}

/** An edge whose both ends are System Map nodes. */
export interface SystemMapDomainEdge {
  source: string;
  target: string;
  edgeType: string;
}

export interface SystemMapDomainType {
  type: string;
  count: number;
}

export type SystemMapDomainNodesResponse =
  | {
      status: "ready";
      types: SystemMapDomainType[];
      nodes: SystemMapDomainNode[];
      edges: SystemMapDomainEdge[];
      truncated: boolean;
      /** Nodes whose edges could not be read. */
      edgeReadFailures: number;
    }
  | {
      status: "error";
      types: [];
      nodes: [];
      edges: [];
      truncated: false;
      edgeReadFailures: 0;
      error: string;
    };


/** One System Map node ↔ Endpoint link (CALLS, EXPOSES, …). */
export interface SystemMapEndpointLink {
  node: string;
  endpoint: string;
  edgeType: string;
  /** `out` when the System Map node is the edge's source. */
  direction: "out" | "in";
}

export interface SystemMapEndpoint {
  refId: string;
  /** The route path, e.g. `/api/tasks`. */
  name: string;
  verb: string;
  file: string;
}

export type SystemMapEndpointLinksResponse =
  | {
      status: "ready";
      links: SystemMapEndpointLink[];
      endpoints: SystemMapEndpoint[];
      /** True when the query hit its row limit. */
      truncated: boolean;
    }
  | { status: "error"; links: []; endpoints: []; truncated: false; error: string };
