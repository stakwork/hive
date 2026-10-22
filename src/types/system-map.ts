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
  /** The CWEs the run was scoped to (`input.cwe_ids`); null when it covered everything. */
  cweIds: string[] | null;
  /** The System Map components the run was scoped to (`input.components`); null when it covered all. */
  components: string[] | null;
  /** The `Finding`s a finding check ran on (`input.finding_ref_ids`); null for other workflows. */
  findingRefIds: string[] | null;
  /** Whether a finding check wrote its verdict (`input.apply`); null for other workflows. */
  apply: boolean | null;
}

export type SystemMapWorkflowKey = "system_map" | "cwe_check" | "finding_verify" | "package_cves";

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

export type CweMappingUsage = "Allowed" | "Allowed-with-Review" | "Discouraged" | "Prohibited" | "Unknown";

/** A CWE node from the graph's `infosec` catalogue. */
export interface CweEntry {
  refId: string;
  /** `CWE-862` */
  id: string;
  number: number;
  name: string;
  description: string;
  /** `weakness`, `category` or `view`. */
  kind: string;
  /** Pillar, Class, Base, Variant or Compound. */
  abstraction: string | null;
  status: string | null;
  usage: CweMappingUsage;
  usageRationale: string | null;
  likelihood: string | null;
  url: string | null;
}

/** A usable descendant of a list member MITRE says not to map to directly. */
export interface CweUsableChild extends CweEntry {
  /** Ids of the unusable CWEs between the list member and this child (exclusive of both). */
  via: string[];
}

export interface CweListMember extends CweEntry {
  /** The OWASP category the weakness was reached through; null for a direct member. */
  category: { id: string; name: string } | null;
  /** Usable PARENT_OF descendants (three levels), for a member that is not usable itself. */
  usableChildren: CweUsableChild[];
  /** Why the children walk failed for this member, if it did. */
  childrenError: string | null;
}

export type CweListResponse =
  | { status: "ready"; view: { id: string; name: string }; members: CweListMember[] }
  | { status: "error"; error: string };

export type CweSearchResponse = { status: "ready"; results: CweEntry[] } | { status: "error"; error: string };

/** A catalogue node linked from a CWE (template, mitigation, detection method, platform). */
export interface CweRelatedNode {
  refId: string;
  nodeType: string;
  name: string;
  description: string | null;
  /** Short facts from the node and its edge: phases, effectiveness, prevalence, lifecycle… */
  details: string[];
}

export type CweRelatedResponse =
  | {
      status: "ready";
      templates: CweRelatedNode[];
      mitigations: CweRelatedNode[];
      detection: CweRelatedNode[];
      platforms: CweRelatedNode[];
    }
  | { status: "error"; error: string };

/** A `Finding` node from the workspace graph (Infosec page → Findings). */
export interface SystemMapFinding {
  refId: string;
  title: string;
  /** Lower-cased: critical / high / medium / low / info, or whatever the node says. */
  severity: string | null;
  status: string | null;
  cweId: string | null;
  file: string | null;
  line: number | null;
  description: string | null;
  /** Unix seconds. */
  dateAdded: number | null;
  properties: Record<string, unknown>;
}

export type SystemMapFindingsResponse =
  | { status: "ready"; findings: SystemMapFinding[]; truncated: boolean }
  | { status: "error"; error: string };

/** A node one edge away from a finding, from any namespace (jarvis does not say which). */
export interface SystemMapFindingRelated {
  refId: string;
  nodeType: string;
  edgeType: string;
  /** `out`: finding → node; `in`: node → finding. */
  direction: "in" | "out";
  name: string;
  file: string | null;
  properties: Record<string, unknown>;
}

export type SystemMapFindingRelatedResponse =
  | { status: "ready"; related: SystemMapFindingRelated[]; truncated: boolean }
  | { status: "error"; error: string };
