/**
 * Public surface of the canvas projection pipeline.
 *
 * Everything callers should import from outside `src/lib/canvas/` is
 * re-exported here. Internal helpers (blob JSON shape, projector
 * registry, merge/split primitives) stay private to their own modules.
 */
export {
  readCanvas,
  writeCanvas,
  splitCanvas,
  hideLiveNode,
  showLiveNode,
  readHiddenLive,
  setLivePosition,
} from "./io";
export type { HiddenLiveEntry } from "./io";
export { parseScope, isLiveId, ROOT_REF } from "./scope";
export { featureProjectsOn, mostSpecificRef } from "./feature-projection";
export type { FeaturePlacementPayload } from "./feature-projection";
export { resolvePlacement } from "./placement";
export type { PlacementContext } from "./placement";
export {
  notifyCanvasUpdated,
  notifyCanvasUpdatedByLogin,
  notifyCanvasesUpdatedByLogin,
} from "./pusher";
export {
  resolveAffectedCanvasRefs,
  notifyFeatureCanvasRefresh,
  notifyFeatureContentRefresh,
  notifyFeatureReassignmentRefresh,
} from "./feature-pusher";
export {
  notifyResearchEvent,
  notifyResearchEventByLogin,
  notifyResearchReassignmentRefresh,
} from "./research-pusher";
export type { ResearchEventAction } from "./research-pusher";
export type {
  CanvasBlob,
  Scope,
  Projector,
  ProjectionResult,
  CanvasData,
  CanvasNode,
  CanvasEdge,
} from "./types";
