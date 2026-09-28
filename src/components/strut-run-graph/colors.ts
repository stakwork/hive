import { GRAPH_EXPLORER_COLORS } from "@/components/graph-explorer/nodeColors";

/** Strut's own bookkeeping nodes — a run reads them by accident, walking out from a node earlier runs touched. */
const PROVENANCE_TYPE_PREFIX = "Strut";

export function isProvenanceType(type: string): boolean {
  return type.startsWith(PROVENANCE_TYPE_PREFIX);
}

/** Types the explorer's palette does not name, given hues that stay apart from the ones it does. */
const RUN_GRAPH_COLORS: Record<string, string> = {
  ...GRAPH_EXPLORER_COLORS,
  ClinicalFinding: "#14b8a6",
  Diagnosis: "#f43f5e",
  Event: "#a855f7",
  Entity: "#ec4899",
};

/** A stable hue for a type no palette names. */
function hashedColor(type: string): string {
  let hash = 0;
  for (let i = 0; i < type.length; i++) hash = (hash * 31 + type.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360} 62% 52%)`;
}

/** A colour per type: the palette's for a type it names, a hashed one for any other. */
export function runGraphColorMap(types: Iterable<string>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const type of types) map[type] = RUN_GRAPH_COLORS[type] ?? hashedColor(type);
  return map;
}
