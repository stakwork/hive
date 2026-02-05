/**
 * Excalidraw Generator Service
 *
 * Generates Excalidraw-compatible diagram elements from architecture text
 * using OpenAI's GPT model. Uses ELK for layout with orthogonal edge routing.
 */

import { generateText } from "ai";
import { getModel, getApiKeyForProvider } from "@/lib/ai/provider";
import ELK from "elkjs/lib/elk.bundled.js";
import type { ElkNode, ElkExtendedEdge, ElkPoint } from "elkjs/lib/elk-api";

const elk = new ELK();

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

export interface ExcalidrawData {
  elements: ExcalidrawElement[];
  appState: {
    viewBackgroundColor: string;
    gridSize: number | null;
  };
}

/**
 * Generates a unique ID for Excalidraw elements
 */
function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

/**
 * Generates a random seed for Excalidraw roughness
 */
function generateSeed(): number {
  return Math.floor(Math.random() * 2000000000);
}

/**
 * Builds the prompt for generating Excalidraw JSON from architecture text
 * Note: We only ask for logical structure, positioning is done by our layout algorithm
 */
function buildExcalidrawPrompt(architectureText: string): string {
  return `You are an expert at analyzing software architecture. Extract the components and their relationships from the following architecture description.

IMPORTANT: Output ONLY valid JSON, no markdown code blocks, no explanation text.

The JSON should have this structure:
{
  "components": [
    {
      "id": "unique_id (lowercase, underscores)",
      "name": "Component Name",
      "type": "client" | "gateway" | "service" | "worker" | "queue" | "cache" | "database" | "external"
    }
  ],
  "connections": [
    {
      "from": "component_id",
      "to": "component_id",
      "label": "short description (2-4 words)"
    }
  ]
}

Component type guidelines:
- "client": Frontend apps, mobile apps, web browsers
- "gateway": API gateways, load balancers, proxies
- "service": Backend services, APIs, microservices
- "worker": Background jobs, async processors
- "queue": Message queues (Kafka, RabbitMQ, SQS)
- "cache": Caching layers (Redis, Memcached)
- "database": Databases (PostgreSQL, MongoDB, etc.)
- "external": Third-party services, external APIs

Architecture Description:
${architectureText}

Output the JSON:`;
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
    else width += 8; // lowercase, digits, most punctuation
  }
  return width * (fontSize / 16);
}

function computeComponentSize(name: string): { width: number; height: number } {
  const textW = measureTextWidth(name, 16);
  const paddingH = 48; // 24px each side
  const paddingV = 40; // 20px top/bottom
  return {
    width: Math.max(120, textW + paddingH),
    height: Math.max(60, 25 + paddingV), // 25 = single line text height at 16px
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

// Numeric priority used for ELK layered.priority (higher = earlier layer)
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

// --- Parsed types ---

interface ParsedComponent {
  id: string;
  name: string;
  type: "client" | "gateway" | "service" | "worker" | "queue" | "cache" | "database" | "external";
  x: number;
  y: number;
}

interface ParsedConnection {
  from: string;
  to: string;
  label: string;
}

interface ParsedDiagram {
  components: ParsedComponent[];
  connections: ParsedConnection[];
}

// --- Layouted types (output of ELK) ---

interface LayoutedComponent extends ParsedComponent {
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

// --- ELK layout ---

async function applyLayout(diagram: ParsedDiagram): Promise<LayoutedDiagram> {
  const componentSizes = new Map<string, { width: number; height: number }>();
  for (const c of diagram.components) {
    componentSizes.set(c.id, computeComponentSize(c.name));
  }

  const elkGraph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": "80",
      "elk.layered.spacing.nodeNodeBetweenLayers": "120",
      "elk.layered.spacing.edgeNode": "40",
      "elk.layered.spacing.edgeNodeBetweenLayers": "40",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.edgeLabels.inline": "true",
      "elk.padding": "[top=40,left=40,bottom=40,right=40]",
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    },
    children: diagram.components.map((c) => {
      const size = componentSizes.get(c.id)!;
      const constraint = LAYER_ORDER[c.type] || "";
      const priority = LAYER_PRIORITY[c.type] ?? 50;
      const layoutOptions: Record<string, string> = {
        "elk.layered.priority.direction": String(priority),
      };
      if (constraint) {
        layoutOptions["elk.layered.layering.layerConstraint"] = constraint;
      }
      return {
        id: c.id,
        width: size.width,
        height: size.height,
        layoutOptions,
      };
    }),
    edges: diagram.connections.map((conn, i) => {
      const edge: ElkExtendedEdge = {
        id: `e${i}`,
        sources: [conn.from],
        targets: [conn.to],
      };
      if (conn.label) {
        edge.labels = [{ text: conn.label, width: measureTextWidth(conn.label, 14), height: 20 }];
      }
      return edge;
    }),
  };

  const result = await elk.layout(elkGraph);

  // Build layouted components
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

  // Build layouted connections with route points
  const layoutedConnections: LayoutedConnection[] = diagram.connections.map((conn, i) => {
    const elkEdge = (result.edges as ElkExtendedEdge[] | undefined)?.find((e) => e.id === `e${i}`);
    const section = elkEdge?.sections?.[0];

    let routePoints: ElkPoint[] = [];
    let labelPosition = { x: 0, y: 0 };

    if (section) {
      routePoints = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];

      // Use ELK label position if available, otherwise use route midpoint
      if (elkEdge?.labels?.[0]?.x != null && elkEdge?.labels?.[0]?.y != null) {
        labelPosition = { x: elkEdge.labels[0].x, y: elkEdge.labels[0].y };
      } else {
        const mid = Math.floor(routePoints.length / 2);
        labelPosition = { x: routePoints[mid].x, y: routePoints[mid].y };
      }
    }

    return { ...conn, routePoints, labelPosition };
  });

  return { components: layoutedComponents, connections: layoutedConnections };
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
  const { backgroundColor, strokeColor } = getComponentColors(component.type);

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
    roughness: 1,
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
    roughness: 1,
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
    fontFamily: 1,
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

  const origin = connection.routePoints[0];
  // Convert absolute ELK coordinates to relative Excalidraw points (offset from first point)
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
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
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
      roughness: 1,
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
      fontFamily: 1,
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

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

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
        // Shift label above the component with a gap
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

/**
 * Generates Excalidraw diagram data from architecture text using OpenAI
 *
 * @param architectureText - The architecture description text
 * @returns ExcalidrawData with elements and appState
 * @throws Error on API failures
 */
export async function generateExcalidrawFromArchitecture(
  architectureText: string
): Promise<ExcalidrawData> {
  // Validate input
  if (!architectureText || architectureText.trim().length === 0) {
    throw new Error("Architecture text cannot be empty");
  }

  try {
    const apiKey = getApiKeyForProvider("openai");
    const model = await getModel("openai", apiKey);

    const prompt = buildExcalidrawPrompt(architectureText);

    const result = await generateText({
      model,
      prompt,
      temperature: 0.7,
    });

    if (!result.text) {
      throw new Error("No response received from OpenAI API");
    }

    // Parse the JSON response
    let jsonText = result.text.trim();

    // Remove markdown code blocks if present
    if (jsonText.startsWith("```json")) {
      jsonText = jsonText.slice(7);
    } else if (jsonText.startsWith("```")) {
      jsonText = jsonText.slice(3);
    }
    if (jsonText.endsWith("```")) {
      jsonText = jsonText.slice(0, -3);
    }
    jsonText = jsonText.trim();

    let parsedDiagram: ParsedDiagram;
    try {
      parsedDiagram = JSON.parse(jsonText);
    } catch {
      throw new Error("Failed to parse JSON from OpenAI response");
    }

    // Validate parsed structure
    if (!parsedDiagram.components || !Array.isArray(parsedDiagram.components)) {
      throw new Error("Invalid diagram structure: missing components array");
    }

    if (!parsedDiagram.connections) {
      parsedDiagram.connections = [];
    }

    // Apply ELK layout algorithm to position components and route edges
    const layoutedDiagram = await applyLayout(parsedDiagram);

    // Fix any label-component collisions
    fixLabelCollisions(layoutedDiagram);

    // Convert to Excalidraw elements
    const elements = convertToExcalidrawElements(layoutedDiagram);

    return {
      elements,
      appState: {
        viewBackgroundColor: "#ffffff",
        gridSize: null,
      },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
    throw new Error(`Failed to generate Excalidraw diagram: ${errorMessage}`);
  }
}
