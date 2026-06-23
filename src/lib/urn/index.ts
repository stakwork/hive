/**
 * URN Addressing Scheme — public module exports.
 *
 * Canonical format:
 *   pg / canvas  →  urn:{org}:{realm}:{type}:{id}
 *   kg           →  urn:{org}:kg:{workspace}:{type}:{id}
 *
 * The import path `@/lib/urn` stays identical so all existing consumers
 * (e.g. `pg-neighbors.ts`) continue to work without changes to their
 * import statements.
 */

// Core parse / format
export type { ParsedUrn } from "./parse";
export {
  parseUrn,
  formatUrn,
  encodeCanvasRef,
  decodeCanvasRef,
  composeCanvasId,
  parseCanvasId,
} from "./parse";

// Access guard
export type { PgAccessContext } from "./access";
export { checkPgAccess } from "./access";

// Shared types
export type { UrnEdgeNeighbor } from "./edges";

// UrnEdge namespace (matches stub shape)
import { neighborsOf } from "./edges";
export const UrnEdge = { neighborsOf };

// Edge CRUD (for callers that need direct access)
export {
  createEdge,
  listEdges,
  deleteEdge,
  neighborsOf as urnEdgeNeighborsOf,
} from "./edges";

// Resolvers
export { resolvePgNode } from "./resolvers/pg";
export { resolveCanvasNode } from "./resolvers/canvas";
export { resolveKgSeam } from "./resolvers/kg";
export type { KgSeamResult, KgAccessContext } from "./resolvers/kg";
