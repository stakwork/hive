import {
  getGraphCallers,
  listNodesByType,
  type JarvisCallersTarget,
  type JarvisGraphNode,
} from "@/services/swarm/api/nodes";
import type { JarvisConnectionConfig } from "@/types/jarvis";
import type { ProtectEndpoint, ProtectSystemCall } from "@/types/protect";

export const ENDPOINT_NODE_TYPE = "Endpoint";

const PAGE_SIZE = 500;
const MAX_PAGES = 20;
// Endpoint nodes carry the full handler source in `body`; only pull what the list renders.
const ENDPOINT_FIELDS = ["name", "verb", "file"];

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Stakgraph stores some verbs as `"GET"`, quotes included. */
function asVerb(value: unknown): string {
  return asString(value).replace(/^["']+|["']+$/g, "").toUpperCase();
}

/** `stakwork/hive/src/app.ts` -> `stakwork/hive`, mirroring jarvis' system_depth=2. */
export function systemFromFile(file: string): string {
  const segments = file.split("/").filter(Boolean);
  return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : segments[0] || "unknown";
}

export function parseCallersTarget(target: JarvisCallersTarget): ProtectEndpoint | null {
  if (!target.ref_id) return null;
  return {
    refId: target.ref_id,
    name: asString(target.name),
    verb: asVerb(target.verb),
    file: asString(target.file),
    system: target.system || systemFromFile(asString(target.file)),
    callers: (target.callers ?? []).map((caller) => ({
      system: caller.system,
      callSites: caller.call_sites,
    })),
  };
}

export function parseProtectEndpoint(node: JarvisGraphNode): ProtectEndpoint | null {
  if (!node.ref_id) return null;
  const properties = node.properties ?? {};
  const file = asString(properties.file);
  return {
    refId: node.ref_id,
    name: asString(properties.name),
    verb: asVerb(properties.verb),
    file,
    system: systemFromFile(file),
    callers: [],
  };
}

function byNameThenVerb(a: ProtectEndpoint, b: ProtectEndpoint): number {
  return a.name.localeCompare(b.name) || a.verb.localeCompare(b.verb);
}

export type ListProtectEndpointsResult =
  | {
      ok: true;
      endpoints: ProtectEndpoint[];
      systems: ProtectSystemCall[];
      callersUnavailable: boolean;
    }
  | { ok: false; endpoints: []; systems: []; error: string; status?: number };

/**
 * List Endpoint nodes for a workspace swarm with the systems that call them.
 *
 * Reads `GET /v2/graph/callers`; on a swarm that predates that route, falls
 * back to a plain attribute search so the list still renders without callers.
 */
export async function listProtectEndpoints(
  config: JarvisConnectionConfig,
): Promise<ListProtectEndpointsResult> {
  const callers = await getGraphCallers(config, { targetType: ENDPOINT_NODE_TYPE });

  if (callers.ok) {
    return {
      ok: true,
      endpoints: callers.targets
        .map(parseCallersTarget)
        .filter((endpoint): endpoint is ProtectEndpoint => endpoint !== null)
        .sort(byNameThenVerb),
      systems: callers.systems.map((row) => ({
        caller: row.caller,
        callee: row.callee,
        callSites: row.call_sites,
      })),
      callersUnavailable: false,
    };
  }

  if (!callers.endpointMissing) {
    return {
      ok: false,
      endpoints: [],
      systems: [],
      error: callers.error || "Failed to load endpoints",
      status: callers.status,
    };
  }

  // Older swarm without /v2/graph/callers: page through GET /v2/nodes.
  const nodes: JarvisGraphNode[] = [];
  let startingAfter: string | undefined;
  let truncated = false;
  for (let page = 0; ; page++) {
    if (page === MAX_PAGES) {
      truncated = true;
      break;
    }
    const result = await listNodesByType(config, ENDPOINT_NODE_TYPE, PAGE_SIZE, {
      startingAfter,
      fields: ENDPOINT_FIELDS,
    });
    if (!result.ok) {
      return {
        ok: false,
        endpoints: [],
        systems: [],
        error: result.error || "Failed to load endpoints",
        status: result.status,
      };
    }
    nodes.push(...result.nodes);
    const lastRefId = result.nodes[result.nodes.length - 1]?.ref_id;
    if (result.nodes.length < PAGE_SIZE || !lastRefId) break;
    startingAfter = lastRefId;
  }
  if (truncated) {
    console.warn(`[Protect] endpoint listing stopped after ${MAX_PAGES * PAGE_SIZE} nodes`);
  }

  return {
    ok: true,
    endpoints: nodes
      .map(parseProtectEndpoint)
      .filter((endpoint): endpoint is ProtectEndpoint => endpoint !== null)
      .sort(byNameThenVerb),
    systems: [],
    callersUnavailable: true,
  };
}
