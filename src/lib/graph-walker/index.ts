/**
 * graph-walker — pg realm relationship registry and bidirectional resolver.
 *
 * Depends on @/lib/urn/ (URN Addressing Scheme & Resolver feature) for
 * parseUrn, formatUrn, UrnEdge, and checkPgAccess.
 */

export { pgNeighbors } from "./pg-neighbors";
export type { NeighborResult, PgNeighborContext } from "./pg-neighbors";

export { REGISTRY, PG_NODE_TYPES } from "./registry";

export { linkFeatureToConcepts, backfillFeatureConceptEdges } from "./feature-concept-bridge";
export type { FeatureConceptResult, BackfillResult } from "./feature-concept-bridge";
export type {
  EdgeDefinition,
  ForwardScalarResolver,
  ForwardArrayResolver,
  ReverseIndexedResolver,
  OpaqueExternalResolver,
} from "./registry";
