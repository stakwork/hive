import { DEFAULT_COLORS } from "@/components/graph/graphUtils";

/**
 * Node-type palette for the Graph Explorer's 2D view.
 *
 * Scoped to this view rather than folded into `DEFAULT_COLORS`, because
 * `GraphVisualization`'s `colorMap` prop *replaces* the shared map outright —
 * so this spreads it first to keep every code type, then retunes for the
 * domains the explorer actually walks. Editing the shared map instead would
 * repaint `GraphArtifact` and the chat artifacts along with it.
 *
 * Unlisted types fall through to `getNodeColor`'s neutral gray.
 */
export const GRAPH_EXPLORER_COLORS: Record<string, string> = {
  ...DEFAULT_COLORS,

  // Concept is what you walk here, and amber is already its color everywhere
  // else — the trace rail's diamond chips, the proposal chips. So it takes the
  // amber that `File` holds in the shared map...
  Concept: "#f59e0b",
  // ...and File steps back to a muted slate. In a concept walk, files are the
  // context around the subject rather than the subject.
  File: "#94a3b8",

  // Legal domain — kept far apart in hue so a Matter, its Agreements, and an
  // issue raised against them never read as the same thing at circle size.
  Matter: "#14b8a6",
  Agreement: "#6366f1",
  Document: "#0ea5e9",
  DiligenceIssue: "#f43f5e",

  // Agent runs
  AgentSession: "#d946ef",
};
