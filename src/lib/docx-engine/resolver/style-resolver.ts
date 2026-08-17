/**
 * Style resolver with basedOn chain traversal, cycle detection, and depth cap.
 *
 * Word's own limit is 9 levels of style inheritance.
 * Cycle detection uses a per-call Set<styleId>.
 */

import { DocxStyleDef, RunProperties, ParagraphProperties } from "../types/document";

export class DocxStyleCycleError extends Error {
  constructor(cycleStyleId: string) {
    super(`Circular style basedOn chain detected at styleId: "${cycleStyleId}"`);
    this.name = "DocxStyleCycleError";
  }
}

const MAX_DEPTH = 9;

/**
 * Merge two RunProperties objects. Later (child) values override earlier (base) values.
 */
function mergeRunProps(
  base: RunProperties,
  child: RunProperties
): RunProperties {
  return {
    ...base,
    ...Object.fromEntries(
      Object.entries(child).filter(([, v]) => v !== undefined)
    ),
  };
}

/**
 * Merge two ParagraphProperties objects. Later values override earlier values.
 */
function mergeParaProps(
  base: ParagraphProperties,
  child: ParagraphProperties
): ParagraphProperties {
  return {
    ...base,
    ...Object.fromEntries(
      Object.entries(child).filter(([, v]) => v !== undefined)
    ),
  };
}

/**
 * Resolve the full RunProperties for a style, following the basedOn chain.
 * Throws DocxStyleCycleError if a cycle is detected.
 * Returns best-effort result (stops at depth cap without throwing).
 */
export function resolveRunStyle(
  styleId: string,
  styles: Map<string, DocxStyleDef>,
  _visited: Set<string> = new Set(),
  _depth: number = 0
): RunProperties {
  if (_visited.has(styleId)) {
    throw new DocxStyleCycleError(styleId);
  }
  if (_depth >= MAX_DEPTH) {
    // Hard depth cap — return whatever the current style has
    return styles.get(styleId)?.runProperties ?? {};
  }

  const styleDef = styles.get(styleId);
  if (!styleDef) return {};

  _visited.add(styleId);

  let base: RunProperties = {};
  if (styleDef.basedOn) {
    base = resolveRunStyle(styleDef.basedOn, styles, _visited, _depth + 1);
  }

  return mergeRunProps(base, styleDef.runProperties ?? {});
}

/**
 * Resolve the full ParagraphProperties for a style, following the basedOn chain.
 * Throws DocxStyleCycleError if a cycle is detected.
 * Returns best-effort result (stops at depth cap without throwing).
 */
export function resolveParaStyle(
  styleId: string,
  styles: Map<string, DocxStyleDef>,
  _visited: Set<string> = new Set(),
  _depth: number = 0
): ParagraphProperties {
  if (_visited.has(styleId)) {
    throw new DocxStyleCycleError(styleId);
  }
  if (_depth >= MAX_DEPTH) {
    return styles.get(styleId)?.paragraphProperties ?? {};
  }

  const styleDef = styles.get(styleId);
  if (!styleDef) return {};

  _visited.add(styleId);

  let base: ParagraphProperties = {};
  if (styleDef.basedOn) {
    base = resolveParaStyle(styleDef.basedOn, styles, _visited, _depth + 1);
  }

  return mergeParaProps(base, styleDef.paragraphProperties ?? {});
}
