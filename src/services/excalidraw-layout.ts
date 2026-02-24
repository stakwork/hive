/**
 * Excalidraw Layout Service
 *
 * Client-safe module: no server-only dependencies.
 * Handles ELK layout, element creation, and label collision fixing.
 */

import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkNode, ElkExtendedEdge, ElkPoint } from "elkjs/lib/elk-api";

const elk = new ELK();

// --- Public types ---

export type LayoutAlgorithm = "layered" | "force" | "stress" | "mrtree";

export interface ParsedComponent {
  id: string;
  name: string;
  type: "client" | "gateway" | "service" | "worker" | "queue" | "cache" | "database" | "external";
  color?: string | null;
  backgroundColor?: string | null;
}

export interface ParsedConnection {
  from: string;
  to: string;
  label: string;
  color?: string | null;
}

export interface ParsedDiagram {
  components: ParsedComponent[];
  connections: ParsedConnection[];
}

export interface ExcalidrawData {
  elements: ExcalidrawElement[];
  appState: {
    viewBackgroundColor: string;
    gridSize: number | null;
  };
}

// --- Internal types ---

interface ExcalidrawElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  strokeColor: string;
  backgroundColor: string;
  fillStyle: string;
  strokeWidth: number;
  strokeStyle: string;
  roughness: number;
  opacity: number;
  groupIds: string[];
  frameId: null;
  roundness: { type: number } | null;
  seed: number;
  version: number;
  versionNonce: number;
  isDeleted: boolean;
  boundElements: { id: string; type: string }[] | null;
  updated: number;
  link: null;
  locked: boolean;
  text?: string;
  fontSize?: number;
  fontFamily?: number;
  textAlign?: string;
  verticalAlign?: string;
  containerId?: string | null;
  originalText?: string;
  autoResize?: boolean;
  lineHeight?: number;
  points?: [number, number][];
  startBinding?: { elementId: string; focus: number; gap: number; fixedPoint: null } | null;
  endBinding?: { elementId: string; focus: number; gap: number; fixedPoint: null } | null;
  startArrowhead?: string | null;
  endArrowhead?: string | null;
  elbowed?: boolean;
}

interface LayoutedComponent extends ParsedComponent {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LayoutedConnection extends ParsedConnection {
  routePoints: ElkPoint[];
  labelPosition: { x: number; y: number };
}

interface LayoutedDiagram {
  components: LayoutedComponent[];
  connections: LayoutedConnection[];
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// --- Helpers ---

function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

function generateSeed(): number {
  return Math.floor(Math.random() * 2000000000);
}

// --- Text measurement & dynamic sizing ---

const NARROW_CHARS = new Set("iltf1.,;:!|'".split(""));
const WIDE_CHARS = new Set("ABCDEFGHJKLNOPQRSUVXYZ".split(""));
const VERY_WIDE_CHARS = new Set("mwMW@%".split(""));

function measureTextWidth(text: string, fontSize: number): number {
  let width = 0;
  for (const ch of text) {
    if (NARROW_CHARS.has(ch)) width += 5;
    else if (VERY_WIDE_CHARS.has(ch)) width += 12;
    else if (WIDE_CHARS.has(ch)) width += 10;
    else width += 8;
  }
  return width * (fontSize / 16);
}

function computeComponentSize(name: string): { width: number; height: number } {
  const textW = measureTextWidth(name, 16);
  const paddingH = 48;
  const paddingV = 40;
  return {
    width: Math.max(120, textW + paddingH),
    height: Math.max(60, 25 + paddingV),
  };
}

// --- Layer ordering for ELK constraints ---

const LAYER_ORDER: Record<string, string> = {
  client: "FIRST",
  gateway: "",
  service: "",
  worker: "",
  queue: "",
  cache: "",
  database: "LAST",
  external: "",
};

const LAYER_PRIORITY: Record<string, number> = {
  client: 100,
  gateway: 80,
  service: 60,
  worker: 50,
  queue: 40,
  cache: 30,
  database: 10,
  external: 20,
};

// --- ELK layout ---

function getElkOptions(algorithm: LayoutAlgorithm): Record<string, string> {
  const common: Record<string, string> = {
    "elk.edgeLabels.inline": "true",
    "elk.padding": "[top=40,left=40,bottom=40,right=40]",
    "elk.spacing.edgeEdge": "25",
    "elk.spacing.edgeNode": "30",
  };

  switch (algorithm) {
    case "force":
      return {
        ...common,
        "elk.algorithm": "force",
        "elk.force.temperature": "0.1",
        "elk.force.iterations": "300",
        "elk.force.repulsion": "5.0",
        "elk.spacing.nodeNode": "80",
        "elk.spacing.componentComponent": "100",
      };
    case "stress":
      return {
        ...common,
        "elk.algorithm": "stress",
        "elk.stress.desiredEdgeLength": "200",
        "elk.stress.epsilon": "0.001",
        "elk.stress.iterationLimit": "300",
        "elk.spacing.nodeNode": "80",
        "elk.spacing.componentComponent": "100",
      };
    case "mrtree":
      return {
        ...common,
        "elk.algorithm": "mrtree",
        "elk.direction": "RIGHT",
        "elk.spacing.nodeNode": "60",
        "elk.mrtree.spacing.nodeNodeBetweenLayers": "120",
      };
    case "layered":
    default:
      return {
        ...common,
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.edgeRouting": "ORTHOGONAL",
        "elk.spacing.nodeNode": "80",
        "elk.layered.spacing.nodeNodeBetweenLayers": "120",
        "elk.layered.spacing.edgeNode": "40",
        "elk.layered.spacing.edgeNodeBetweenLayers": "40",
        "elk.layered.spacing.edgeEdgeBetweenLayers": "20",
        "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
        "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      };
  }
}

async function applyLayout(diagram: ParsedDiagram, algorithm: LayoutAlgorithm = "layered"): Promise<LayoutedDiagram> {
  const componentSizes = new Map<string, { width: number; height: number }>();
  for (const c of diagram.components) {
    componentSizes.set(c.id, computeComponentSize(c.name));
  }

  const useLayerConstraints = algorithm === "layered" || algorithm === "mrtree";

  // Build per-node port lists so multiple edges don't overlap.
  // Each connection endpoint gets its own port on the node.
  const outPorts = new Map<string, number>(); // nodeId → next outgoing port index
  const inPorts = new Map<string, number>();  // nodeId → next incoming port index

  interface PortInfo { portId: string; nodeId: string; side: "EAST" | "WEST" }
  const edgePorts: { sourcePort: PortInfo; targetPort: PortInfo }[] = [];

  for (const conn of diagram.connections) {
    const srcIdx = outPorts.get(conn.from) ?? 0;
    outPorts.set(conn.from, srcIdx + 1);
    const srcPortId = `${conn.from}_out_${srcIdx}`;

    const tgtIdx = inPorts.get(conn.to) ?? 0;
    inPorts.set(conn.to, tgtIdx + 1);
    const tgtPortId = `${conn.to}_in_${tgtIdx}`;

    edgePorts.push({
      sourcePort: { portId: srcPortId, nodeId: conn.from, side: "EAST" },
      targetPort: { portId: tgtPortId, nodeId: conn.to, side: "WEST" },
    });
  }

  // Collect all ports per node
  const nodePorts = new Map<string, { id: string; side: string }[]>();
  for (const ep of edgePorts) {
    if (!nodePorts.has(ep.sourcePort.nodeId)) nodePorts.set(ep.sourcePort.nodeId, []);
    nodePorts.get(ep.sourcePort.nodeId)!.push({ id: ep.sourcePort.portId, side: ep.sourcePort.side });
    if (!nodePorts.has(ep.targetPort.nodeId)) nodePorts.set(ep.targetPort.nodeId, []);
    nodePorts.get(ep.targetPort.nodeId)!.push({ id: ep.targetPort.portId, side: ep.targetPort.side });
  }

  const elkGraph: ElkNode = {
    id: "root",
    layoutOptions: getElkOptions(algorithm),
    children: diagram.components.map((c) => {
      const size = componentSizes.get(c.id)!;
      const layoutOptions: Record<string, string> = {
        "elk.portConstraints": "FIXED_SIDE",
      };

      if (useLayerConstraints) {
        const constraint = LAYER_ORDER[c.type] || "";
        const priority = LAYER_PRIORITY[c.type] ?? 50;
        layoutOptions["elk.layered.priority.direction"] = String(priority);
        if (constraint) {
          layoutOptions["elk.layered.layering.layerConstraint"] = constraint;
        }
      }

      const ports = (nodePorts.get(c.id) || []).map((p) => ({
        id: p.id,
        layoutOptions: {
          "elk.port.side": p.side,
        },
      }));

      return {
        id: c.id,
        width: size.width,
        height: size.height,
        layoutOptions,
        ports,
      };
    }),
    edges: diagram.connections.map((conn, i) => {
      const ep = edgePorts[i];
      const edge: ElkExtendedEdge = {
        id: `e${i}`,
        sources: [ep.sourcePort.portId],
        targets: [ep.targetPort.portId],
      };
      if (conn.label) {
        edge.labels = [{ text: conn.label, width: measureTextWidth(conn.label, 14), height: 20 }];
      }
      return edge;
    }),
  };

  const result = await elk.layout(elkGraph);

  const layoutedComponents: LayoutedComponent[] = diagram.components.map((c) => {
    const elkNode = result.children?.find((n) => n.id === c.id);
    const size = componentSizes.get(c.id)!;
    return {
      ...c,
      x: elkNode?.x ?? 0,
      y: elkNode?.y ?? 0,
      width: elkNode?.width ?? size.width,
      height: elkNode?.height ?? size.height,
    };
  });

  const layoutedConnections: LayoutedConnection[] = diagram.connections.map((conn, i) => {
    const elkEdge = (result.edges as ElkExtendedEdge[] | undefined)?.find((e) => e.id === `e${i}`);
    const section = elkEdge?.sections?.[0];

    let routePoints: ElkPoint[] = [];
    let labelPosition = { x: 0, y: 0 };

    if (section) {
      routePoints = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];

      if (elkEdge?.labels?.[0]?.x != null && elkEdge?.labels?.[0]?.y != null) {
        labelPosition = { x: elkEdge.labels[0].x, y: elkEdge.labels[0].y };
      } else {
        const mid = Math.floor(routePoints.length / 2);
        labelPosition = { x: routePoints[mid].x, y: routePoints[mid].y };
      }
    }

    return { ...conn, routePoints, labelPosition };
  });

  // Add curve offsets for edges sharing a source or target node.
  // Without this, multiple straight-line edges from the same node overlap.
  separateOverlappingEdges(layoutedConnections);

  return { components: layoutedComponents, connections: layoutedConnections };
}

/**
 * For edges that share a source or target, insert a perpendicular midpoint
 * so curved arrows arc apart instead of overlapping.
 * Only applies to edges with just 2 route points (no ELK bend points).
 */
function separateOverlappingEdges(connections: LayoutedConnection[]): void {
  // Group edge indices by source and by target
  const bySource = new Map<string, number[]>();
  const byTarget = new Map<string, number[]>();
  for (let i = 0; i < connections.length; i++) {
    const c = connections[i];
    if (!bySource.has(c.from)) bySource.set(c.from, []);
    bySource.get(c.from)!.push(i);
    if (!byTarget.has(c.to)) byTarget.set(c.to, []);
    byTarget.get(c.to)!.push(i);
  }

  const processed = new Set<number>();

  const addOffsets = (indices: number[]) => {
    // Filter to only straight-line edges (2 points = no bend points from ELK)
    const eligible = indices.filter(
      (i) => connections[i].routePoints.length === 2 && !processed.has(i)
    );
    if (eligible.length < 2) return;

    const offset = 30; // pixels perpendicular offset between edges
    const totalSpan = (eligible.length - 1) * offset;

    eligible.forEach((idx, rank) => {
      processed.add(idx);
      const conn = connections[idx];
      const start = conn.routePoints[0];
      const end = conn.routePoints[1];

      // Direction vector and perpendicular
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const px = -dy / len; // perpendicular x
      const py = dx / len;  // perpendicular y

      // Center the offsets around zero
      const shift = -totalSpan / 2 + rank * offset;

      // Insert a midpoint offset perpendicular to the straight line
      const mid: ElkPoint = {
        x: (start.x + end.x) / 2 + px * shift,
        y: (start.y + end.y) / 2 + py * shift,
      };

      conn.routePoints = [start, mid, end];

      // Shift label to follow the midpoint
      conn.labelPosition = { x: mid.x, y: mid.y - 12 };
    });
  };

  for (const indices of bySource.values()) addOffsets(indices);
  for (const indices of byTarget.values()) addOffsets(indices);
}

// --- Color mapping ---

function getComponentColors(type: string): { backgroundColor: string; strokeColor: string } {
  switch (type) {
    case "client":
      return { backgroundColor: "#ffec99", strokeColor: "#f08c00" };
    case "gateway":
      return { backgroundColor: "#fcc2d7", strokeColor: "#c2255c" };
    case "worker":
      return { backgroundColor: "#99e9f2", strokeColor: "#0c8599" };
    case "queue":
      return { backgroundColor: "#d0bfff", strokeColor: "#7950f2" };
    case "cache":
      return { backgroundColor: "#ffd8a8", strokeColor: "#e8590c" };
    case "database":
      return { backgroundColor: "#b2f2bb", strokeColor: "#2f9e44" };
    case "external":
      return { backgroundColor: "#ffc9c9", strokeColor: "#e03131" };
    case "service":
    default:
      return { backgroundColor: "#a5d8ff", strokeColor: "#1971c2" };
  }
}

// --- Element creation ---

function createComponentElement(component: LayoutedComponent): ExcalidrawElement[] {
  const elementId = generateId();
  const textId = generateId();
  const timestamp = Date.now();
  const defaults = getComponentColors(component.type);
  const strokeColor = component.color ?? defaults.strokeColor;
  const backgroundColor = component.backgroundColor ?? defaults.backgroundColor;
  const { width, height } = component;
  const textWidth = measureTextWidth(component.name, 16);

  const rectangle: ExcalidrawElement = {
    id: elementId,
    type: "rectangle",
    x: component.x,
    y: component.y,
    width,
    height,
    angle: 0,
    strokeColor,
    backgroundColor,
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: { type: 3 },
    seed: generateSeed(),
    version: 1,
    versionNonce: generateSeed(),
    isDeleted: false,
    boundElements: [{ id: textId, type: "text" }],
    updated: timestamp,
    link: null,
    locked: false,
  };

  const text: ExcalidrawElement = {
    id: textId,
    type: "text",
    x: component.x + width / 2 - textWidth / 2,
    y: component.y + height / 2 - 12,
    width: textWidth,
    height: 25,
    angle: 0,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: null,
    seed: generateSeed(),
    version: 1,
    versionNonce: generateSeed(),
    isDeleted: false,
    boundElements: null,
    updated: timestamp,
    link: null,
    locked: false,
    text: component.name,
    fontSize: 16,
    fontFamily: 2,
    textAlign: "center",
    verticalAlign: "middle",
    containerId: elementId,
    originalText: component.name,
    autoResize: true,
    lineHeight: 1.25,
  };

  return [rectangle, text];
}

function createConnectionElement(connection: LayoutedConnection): ExcalidrawElement[] {
  if (connection.routePoints.length < 2) {
    return [];
  }

  const arrowId = generateId();
  const labelId = generateId();
  const timestamp = Date.now();
  const arrowColor = connection.color ?? "#1e1e1e";

  const origin = connection.routePoints[0];
  const points: [number, number][] = connection.routePoints.map((p) => [
    p.x - origin.x,
    p.y - origin.y,
  ]);

  const lastPoint = points[points.length - 1];

  const arrow: ExcalidrawElement = {
    id: arrowId,
    type: "arrow",
    x: origin.x,
    y: origin.y,
    width: lastPoint[0],
    height: lastPoint[1],
    angle: 0,
    strokeColor: arrowColor,
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: { type: 2 },
    seed: generateSeed(),
    version: 1,
    versionNonce: generateSeed(),
    isDeleted: false,
    boundElements: connection.label ? [{ id: labelId, type: "text" }] : null,
    updated: timestamp,
    link: null,
    locked: false,
    points,
    startBinding: null,
    endBinding: null,
    startArrowhead: null,
    endArrowhead: "arrow",
    elbowed: false,
  };

  const elements: ExcalidrawElement[] = [arrow];

  if (connection.label) {
    const labelWidth = measureTextWidth(connection.label, 14);
    const labelX = connection.labelPosition.x;
    const labelY = connection.labelPosition.y;

    const label: ExcalidrawElement = {
      id: labelId,
      type: "text",
      x: labelX - labelWidth / 2,
      y: labelY - 10,
      width: labelWidth,
      height: 20,
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 0,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: generateSeed(),
      version: 1,
      versionNonce: generateSeed(),
      isDeleted: false,
      boundElements: null,
      updated: timestamp,
      link: null,
      locked: false,
      text: connection.label,
      fontSize: 14,
      fontFamily: 2,
      textAlign: "center",
      verticalAlign: "middle",
      containerId: arrowId,
      originalText: connection.label,
      autoResize: true,
      lineHeight: 1.25,
    };

    elements.push(label);
  }

  return elements;
}

// --- Post-layout label collision check ---

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function fixLabelCollisions(diagram: LayoutedDiagram): void {
  const componentRects: Rect[] = diagram.components.map((c) => ({
    x: c.x,
    y: c.y,
    width: c.width,
    height: c.height,
  }));

  for (const conn of diagram.connections) {
    if (!conn.label) continue;

    const labelWidth = measureTextWidth(conn.label, 14);
    const labelHeight = 20;
    const labelRect: Rect = {
      x: conn.labelPosition.x - labelWidth / 2,
      y: conn.labelPosition.y - 10,
      width: labelWidth,
      height: labelHeight,
    };

    for (const compRect of componentRects) {
      if (rectsOverlap(labelRect, compRect)) {
        conn.labelPosition.y = compRect.y - labelHeight - 8;
        break;
      }
    }
  }
}

// --- Main conversion ---

function convertToExcalidrawElements(diagram: LayoutedDiagram): ExcalidrawElement[] {
  const elements: ExcalidrawElement[] = [];

  for (const component of diagram.components) {
    elements.push(...createComponentElement(component));
  }

  for (const connection of diagram.connections) {
    elements.push(...createConnectionElement(connection));
  }

  return elements;
}

// --- Reverse color → type mapping ---

const BG_COLOR_TO_TYPE: Record<string, ParsedComponent["type"]> = {
  "#ffec99": "client",
  "#fcc2d7": "gateway",
  "#99e9f2": "worker",
  "#d0bfff": "queue",
  "#ffd8a8": "cache",
  "#b2f2bb": "database",
  "#ffc9c9": "external",
  "#a5d8ff": "service",
};

/**
 * Reconstruct a ParsedDiagram from existing Excalidraw elements.
 * Allows client-side re-layout without an API call.
 */
export function extractParsedDiagram(elements: readonly Record<string, unknown>[]): ParsedDiagram | null {
  const rectangles = elements.filter((e) => e.type === "rectangle" && !e.isDeleted);
  if (rectangles.length === 0) return null;

  const textById = new Map<string, Record<string, unknown>>();
  for (const el of elements) {
    if (el.type === "text" && !el.isDeleted) {
      textById.set(el.id as string, el);
    }
  }

  const components: ParsedComponent[] = [];
  const rectIdMap = new Map<string, string>(); // excalidraw id → component id

  for (const rect of rectangles) {
    const bound = (rect.boundElements as { id: string; type: string }[] | null) ?? [];
    const boundText = bound.find((b) => b.type === "text");
    const textEl = boundText ? textById.get(boundText.id) : undefined;
    const name = (textEl?.text as string) ?? "Unknown";
    const bg = (rect.backgroundColor as string) ?? "";
    const type = BG_COLOR_TO_TYPE[bg] ?? "service";
    const compId = (rect.id as string);
    rectIdMap.set(compId, compId);
    components.push({ id: compId, name, type });
  }

  const arrows = elements.filter((e) => e.type === "arrow" && !e.isDeleted);
  const connections: ParsedConnection[] = [];

  for (const arrow of arrows) {
    const points = arrow.points as [number, number][] | undefined;
    if (!points || points.length < 2) continue;

    const ax = arrow.x as number;
    const ay = arrow.y as number;
    const startX = ax + points[0][0];
    const startY = ay + points[0][1];
    const endX = ax + points[points.length - 1][0];
    const endY = ay + points[points.length - 1][1];

    let fromId: string | null = null;
    let toId: string | null = null;
    let minStartDist = Infinity;
    let minEndDist = Infinity;

    for (const rect of rectangles) {
      const rx = rect.x as number;
      const ry = rect.y as number;
      const rw = rect.width as number;
      const rh = rect.height as number;
      const cx = rx + rw / 2;
      const cy = ry + rh / 2;

      const dStart = Math.hypot(startX - cx, startY - cy);
      const dEnd = Math.hypot(endX - cx, endY - cy);

      if (dStart < minStartDist) { minStartDist = dStart; fromId = rect.id as string; }
      if (dEnd < minEndDist) { minEndDist = dEnd; toId = rect.id as string; }
    }

    if (!fromId || !toId || fromId === toId) continue;

    const bound = (arrow.boundElements as { id: string; type: string }[] | null) ?? [];
    const boundText = bound.find((b) => b.type === "text");
    const textEl = boundText ? textById.get(boundText.id) : undefined;
    const label = (textEl?.text as string) ?? "";

    connections.push({ from: fromId, to: toId, label });
  }

  return { components, connections };
}

/**
 * Serialize current Excalidraw elements into a compact text summary
 * suitable for sending as LLM context. Uses extractParsedDiagram to
 * get structured components/connections, then formats as human-readable text.
 *
 * Returns null if the diagram has no recognizable components.
 */
export function serializeDiagramContext(
  elements: readonly Record<string, unknown>[]
): string | null {
  const parsed = extractParsedDiagram(elements);
  if (!parsed || parsed.components.length === 0) return null;

  const lines: string[] = [];

  lines.push("Components:");
  for (const c of parsed.components) {
    lines.push(`- "${c.name}" (${c.type})`);
  }

  if (parsed.connections.length > 0) {
    lines.push("");
    lines.push("Connections:");
    const nameById = new Map(parsed.components.map((c) => [c.id, c.name]));
    for (const conn of parsed.connections) {
      const from = nameById.get(conn.from) ?? conn.from;
      const to = nameById.get(conn.to) ?? conn.to;
      const label = conn.label ? ` [${conn.label}]` : "";
      lines.push(`- "${from}" -> "${to}"${label}`);
    }
  }

  return lines.join("\n");
}

/**
 * Re-layout a parsed diagram with a given algorithm.
 * Runs entirely client-side (ELK + element creation). No API call needed.
 */
export async function relayoutDiagram(
  parsed: ParsedDiagram,
  algorithm: LayoutAlgorithm = "layered"
): Promise<ExcalidrawData> {
  const layouted = await applyLayout(parsed, algorithm);
  fixLabelCollisions(layouted);
  const elements = convertToExcalidrawElements(layouted);

  return {
    elements,
    appState: {
      viewBackgroundColor: "#ffffff",
      gridSize: null,
    },
  };
}
