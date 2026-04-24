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
} from "./io";
export type { HiddenLiveEntry } from "./io";
export {
  summarizeChildObjectives,
  computeChildRollups,
} from "./rollups";
export { parseScope, isLiveId, ROOT_REF } from "./scope";
export type {
  CanvasBlob,
  Scope,
  Projector,
  ProjectionResult,
  CanvasData,
  CanvasNode,
  CanvasEdge,
} from "./types";
