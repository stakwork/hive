/**
 * Recursive Graph Entity Model
 *
 * Core idea: every visible thing is an entity. An entity has an exterior (shell)
 * and may have an interior (content = local graph of child entities).
 * There is no type distinction between "node" and "cluster" — these are
 * rendering states of the same thing.
 */

import type { Vec3 } from "./types";

// ── Enums ──

export type EdgeKind = "structural" | "associative";

export type LayoutMode =
  | "radial"      // structural edges dominate, tree-like
  | "force"       // associative edges dominate, network-like
  | "hybrid"      // both present, structural backbone + force overlay
  | "grid"        // uniform children, no meaningful edges
  | "ring"        // single-depth children around center
  | "collapsed";  // too dense, show shell only

export type ViewMode =
  | "collapsed"   // shell only — single glyph
  | "preview"     // shell + summary (count badge, miniature)
  | "expanded";   // full internal graph visible

// ── Bounds ──

export interface Bounds {
  center: Vec3;
  radius: number;
}

// ── Shell: collapsed representation ──

export interface Shell {
  position: Vec3;           // position in parent's coordinate space
  scale: number;
  label: string;
  icon?: string;
  badge?: string | number;  // summary (child count, status)
  nodeIndex?: number;       // back-reference to Graph.nodes index (if backed by a real node)
}

// ── Content: internal graph revealed on expansion ──

export interface EntityContent {
  children: GraphEntity[];
  edges: ContentEdge[];
  layoutMode: LayoutMode;
  structuralRatio: number;      // fraction of edges that are structural (0–1)
  stats: ContentStats;
}

export interface ContentEdge {
  sourceId: string;             // entity id
  targetId: string;             // entity id
  kind: EdgeKind;
  label?: string;
  type?: string;                // semantic subtype
  /** Original edge indices in Graph.edges (for rendering) */
  graphEdgeIndices: number[];
}

export interface ContentStats {
  entityCount: number;
  edgeCount: number;
  structuralEdgeCount: number;
  associativeEdgeCount: number;
  maxDepth: number;
  density: number;
}

// ── The Entity: the recursive primitive ──

export interface GraphEntity {
  id: string;
  shell: Shell;
  viewMode: ViewMode;
  content?: EntityContent;
  parentId?: string;
  depth: number;

  /** All Graph.nodes indices contained in this entity (recursively). */
  memberNodeIndices: number[];

  /**
   * For cluster entities: the structural node this cluster is anchored to.
   * Used for positioning the cluster near its structural neighbor.
   */
  anchorNodeIndex?: number;

  /** Computed bounding sphere (set during layout). */
  bounds?: Bounds;
}

// ── Scene State ──

export interface SceneState {
  root: GraphEntity;
  focusPath: string[];          // entity id path from root to current focus
  expandedEntities: Set<string>;
}

// ── Helpers ──

/** Find an entity by id in the tree. */
export function findEntity(root: GraphEntity, id: string): GraphEntity | undefined {
  if (root.id === id) return root;
  if (!root.content) return undefined;
  for (const child of root.content.children) {
    const found = findEntity(child, id);
    if (found) return found;
  }
  return undefined;
}

/** Collect all entities in the tree (depth-first). */
export function walkEntities(root: GraphEntity, fn: (e: GraphEntity) => void): void {
  fn(root);
  if (root.content) {
    for (const child of root.content.children) {
      walkEntities(child, fn);
    }
  }
}

/** Collect all expanded entities. */
export function collectExpanded(root: GraphEntity): Set<string> {
  const set = new Set<string>();
  walkEntities(root, (e) => {
    if (e.viewMode === "expanded") set.add(e.id);
  });
  return set;
}

/** Get the focus path from root to a target entity. */
export function getFocusPath(root: GraphEntity, targetId: string): string[] | null {
  if (root.id === targetId) return [root.id];
  if (!root.content) return null;
  for (const child of root.content.children) {
    const sub = getFocusPath(child, targetId);
    if (sub) return [root.id, ...sub];
  }
  return null;
}
