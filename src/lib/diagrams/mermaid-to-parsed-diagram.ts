import type { ParsedDiagram, ParsedComponent, ParsedConnection, ComponentShape } from "@/services/excalidraw-layout";

/**
 * Thrown when the pasted Mermaid diagram type is not supported (e.g. sequenceDiagram).
 */
export class UnsupportedMermaidTypeError extends Error {
  constructor(public diagramType: string) {
    super(`Unsupported Mermaid diagram type: ${diagramType}`);
    this.name = "UnsupportedMermaidTypeError";
  }
}

const UNSUPPORTED_TYPES = [
  "sequenceDiagram",
  "classDiagram",
  "erDiagram",
  "stateDiagram",
  "gantt",
  "pie",
  "mindmap",
  "gitGraph",
  "timeline",
  "xychart",
];

/** Strip %% comment lines */
function stripComments(source: string): string {
  return source
    .split("\n")
    .map((line) => (line.trimStart().startsWith("%%") ? "" : line))
    .join("\n");
}

/** Replace <br/> and <br> tags with a space */
function stripBrTags(text: string): string {
  return text.replace(/<br\s*\/?>/gi, " ").trim();
}

/** Strip surrounding quotes from a label string */
function stripQuotes(text: string): string {
  return text.replace(/^["']|["']$/g, "");
}

/**
 * Parse a node definition: `A[Label]`, `B(Label)`, `C{Label}`, `D((Label))`, `E>Label]`, or bare `A`
 * Returns { id, label, shape } or null if the string is not a recognisable node definition.
 */
function parseNodeDefinition(
  part: string
): { id: string; label: string; shape: ComponentShape } | null {
  part = part.trim();
  if (!part) return null;

  // Double parens: A((Label)) → rounded-rect
  const doubleParenMatch = /^([\w\s-]+?)\(\((.*?)\)\)$/.exec(part);
  if (doubleParenMatch) {
    return {
      id: doubleParenMatch[1].trim(),
      label: stripBrTags(stripQuotes(doubleParenMatch[2].trim())),
      shape: "rounded-rect",
    };
  }

  // Square brackets: A[Label] → rect
  const squareBracketMatch = /^([\w\s-]+?)\[(.*?)\]$/.exec(part);
  if (squareBracketMatch) {
    return {
      id: squareBracketMatch[1].trim(),
      label: stripBrTags(stripQuotes(squareBracketMatch[2].trim())),
      shape: "rect",
    };
  }

  // Curly braces: A{Label} → diamond
  const curlyMatch = /^([\w\s-]+?)\{(.*?)\}$/.exec(part);
  if (curlyMatch) {
    return {
      id: curlyMatch[1].trim(),
      label: stripBrTags(stripQuotes(curlyMatch[2].trim())),
      shape: "diamond",
    };
  }

  // Angle bracket: A>Label] → rect
  const angleMatch = /^([\w\s-]+?)>(.*?)\]$/.exec(part);
  if (angleMatch) {
    return {
      id: angleMatch[1].trim(),
      label: stripBrTags(stripQuotes(angleMatch[2].trim())),
      shape: "rect",
    };
  }

  // Single parens: A(Label) → rounded-rect
  const singleParenMatch = /^([\w\s-]+?)\((.*?)\)$/.exec(part);
  if (singleParenMatch) {
    return {
      id: singleParenMatch[1].trim(),
      label: stripBrTags(stripQuotes(singleParenMatch[2].trim())),
      shape: "rounded-rect",
    };
  }

  // Bare ID (word chars, underscores, hyphens only)
  const bareIdMatch = /^([\w-]+)$/.exec(part);
  if (bareIdMatch) {
    return {
      id: bareIdMatch[1].trim(),
      label: bareIdMatch[1].trim(),
      shape: "rounded-rect",
    };
  }

  return null;
}

/** Edge patterns ordered from most-specific to least-specific */
const EDGE_PATTERNS: Array<{
  re: RegExp;
  fromGroup: number;
  toGroup: number;
  labelGroup?: number;
}> = [
  // A -->|label| B  or  A -.->|label| B  or  A ==>|label| B
  { re: /^(.+?)\s*(?:-->|-\.->|==>)\|(.+?)\|\s*(.+)$/, fromGroup: 1, toGroup: 3, labelGroup: 2 },
  // A -- label --> B
  { re: /^(.+?)\s*--\s+(.+?)\s+-->\s*(.+)$/, fromGroup: 1, toGroup: 3, labelGroup: 2 },
  // A --> B
  { re: /^(.+?)\s*-->\s*(.+)$/, fromGroup: 1, toGroup: 2 },
  // A --- B
  { re: /^(.+?)\s*---\s*(.+)$/, fromGroup: 1, toGroup: 2 },
  // A ==> B
  { re: /^(.+?)\s*==>\s*(.+)$/, fromGroup: 1, toGroup: 2 },
  // A -.-> B
  { re: /^(.+?)\s*-\.->\s*(.+)$/, fromGroup: 1, toGroup: 2 },
];

interface ParsedEdge {
  from: string;
  to: string;
  label: string;
}

function parseEdge(line: string): ParsedEdge | null {
  for (const { re, fromGroup, toGroup, labelGroup } of EDGE_PATTERNS) {
    const m = re.exec(line);
    if (m) {
      return {
        from: m[fromGroup].trim(),
        to: m[toGroup].trim(),
        label: labelGroup ? m[labelGroup].trim() : "",
      };
    }
  }
  return null;
}

/** Ensure a node exists in the components map, registering it if needed */
function ensureComponent(
  components: Map<string, ParsedComponent>,
  endpoint: string
): string {
  const nodeDef = parseNodeDefinition(endpoint);
  if (nodeDef) {
    if (!components.has(nodeDef.id)) {
      components.set(nodeDef.id, {
        id: nodeDef.id,
        name: nodeDef.label,
        shape: nodeDef.shape,
      });
    }
    return nodeDef.id;
  }
  // Bare implicit node
  if (!components.has(endpoint)) {
    components.set(endpoint, {
      id: endpoint,
      name: endpoint,
      shape: "rounded-rect",
    });
  }
  return endpoint;
}

/**
 * Parse raw Mermaid `graph` or `flowchart` syntax into a `ParsedDiagram`.
 *
 * @throws `UnsupportedMermaidTypeError` for known-but-unsupported diagram types
 * @throws `Error` for unrecognisable or empty input
 */
export function parseMermaidToParsedDiagram(source: string): ParsedDiagram {
  const cleaned = stripComments(source);
  const lines = cleaned.split("\n").map((l) => l.trim()).filter(Boolean);

  if (lines.length === 0) {
    throw new Error("Empty diagram");
  }

  // Detect diagram type from first non-empty line
  const firstLine = lines[0];
  const typeKeyword = firstLine.split(/[\s\t]/)[0].toLowerCase();

  const unsupportedMatch = UNSUPPORTED_TYPES.find(
    (t) => t.toLowerCase() === typeKeyword
  );
  if (unsupportedMatch) {
    throw new UnsupportedMermaidTypeError(unsupportedMatch);
  }

  if (typeKeyword !== "graph" && typeKeyword !== "flowchart") {
    throw new Error(`Cannot detect diagram type from: "${firstLine}"`);
  }

  const components = new Map<string, ParsedComponent>();
  const connections: ParsedConnection[] = [];
  const styleMap = new Map<string, string>(); // nodeId → backgroundColor

  // Process lines after the type declaration
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];

    // Skip subgraph wrapper lines — contents are processed normally (flattened)
    if (/^subgraph\b/i.test(line) || /^end\b/i.test(line)) {
      continue;
    }

    // Style directive: style NodeId fill:#hex[,...]
    const styleMatch = /^style\s+([\w-]+)\s+fill:([#\w]+)/i.exec(line);
    if (styleMatch) {
      styleMap.set(styleMatch[1].trim(), styleMatch[2].trim());
      continue;
    }

    // Try edge parsing first (edges may inline node definitions on either side)
    const edge = parseEdge(line);
    if (edge) {
      const fromId = ensureComponent(components, edge.from);
      const toId = ensureComponent(components, edge.to);
      connections.push({ from: fromId, to: toId, label: edge.label });
      continue;
    }

    // Standalone node definition
    const nodeDef = parseNodeDefinition(line);
    if (nodeDef && !components.has(nodeDef.id)) {
      components.set(nodeDef.id, {
        id: nodeDef.id,
        name: nodeDef.label,
        shape: nodeDef.shape,
      });
    }
  }

  // Apply style directives (backgroundColor) to already-registered components
  for (const [nodeId, color] of styleMap.entries()) {
    const comp = components.get(nodeId);
    if (comp) {
      comp.backgroundColor = color;
    }
  }

  return {
    components: Array.from(components.values()),
    connections,
  };
}
