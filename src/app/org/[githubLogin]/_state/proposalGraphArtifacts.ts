/**
 * A proposal that changes a workspace's graph — a new concept, new docs, a
 * node edit, new edges — is itself something to look at on the graph. Each
 * one yields a `graph` artifact: the workspace, the node to centre on, and
 * the change to draw. Its card is the proposal card; there is no second one.
 *
 * Derived, not stored: the proposal's tool output is the source of truth,
 * and the artifact is read off it whenever the conversation is listed.
 */

import type { GraphChange } from "@/components/graph-workbench/changes";
import type { GraphEdgeEndpoint, ProposalOutput } from "@/lib/proposals/types";
import type { ArtifactRef } from "./canvasChatArtifacts";

/** An edge end as the graph knows it: an existing node's ref_id, or a new node's name. */
function endpoint(end: GraphEdgeEndpoint): string | null {
  if ("ref_id" in end) return end.ref_id;
  const name = end.node_data?.name;
  return typeof name === "string" ? name : null;
}

const nameOf = (data: Record<string, unknown>) => (typeof data.name === "string" ? data.name : null);

/** The graph a proposal changes, and how — or null for a proposal that changes no graph. */
function derive(
  p: ProposalOutput,
): { workspace: string; title: string; focus?: string; changes: GraphChange[] } | null {
  switch (p.kind) {
    case "conceptCreate":
      return {
        workspace: p.payload.workspaceSlug,
        title: p.payload.name,
        focus: p.payload.parent,
        changes: [
          {
            kind: "node",
            name: p.payload.name,
            parent: p.payload.parent,
            description: p.payload.description,
            docs: p.payload.documentation,
          },
        ],
      };
    case "conceptUpdate":
      return {
        workspace: p.payload.workspaceSlug,
        title: p.meta?.conceptName ?? p.payload.conceptId,
        focus: p.payload.conceptId,
        changes: [
          { kind: "docs", node: p.payload.conceptId, before: p.meta?.oldStr ?? "", after: p.meta?.newStr ?? "" },
        ],
      };
    case "graphNodeCreate": {
      const name = nameOf(p.payload.node_data) ?? p.payload.node_type;
      return {
        workspace: p.payload.workspaceSlug,
        title: name,
        changes: [{ kind: "node", name, type: p.payload.node_type }],
      };
    }
    case "graphNodeEdit":
      return {
        workspace: p.payload.workspaceSlug,
        title: nameOf(p.payload.node_data) ?? "Node edit",
        focus: p.payload.ref_id,
        changes: [
          {
            kind: "edit",
            node: p.payload.ref_id,
            before: p.meta?.oldStr ?? "",
            after: p.meta?.newStr ?? JSON.stringify(p.payload.node_data, null, 2),
          },
        ],
      };
    case "graphTripletCreate":
    case "graphBatchTripletCreate": {
      const triplets = p.kind === "graphTripletCreate" ? [p.payload] : p.payload.triplets;
      const changes: GraphChange[] = triplets.flatMap((t) => {
        const source = endpoint(t.source);
        const target = endpoint(t.target);
        return source && target ? [{ kind: "edge" as const, edge: t.edge_type, source, target }] : [];
      });
      if (changes.length === 0) return null;
      const first = changes[0] as Extract<GraphChange, { kind: "edge" }>;
      return {
        workspace: p.payload.workspaceSlug,
        title: changes.length === 1 ? `New ${first.edge} link` : `${changes.length} new links`,
        focus: first.source,
        changes,
      };
    }
    default:
      return null;
  }
}

/** What a proposal does to a graph, or null when it changes none (or is a tool error). */
const graphChange = (p: ProposalOutput) => (typeof p.proposalId === "string" && !("error" in p) ? derive(p) : null);

/** One artifact per proposal object, so the panel sees the same ref while a reply streams. */
const cache = new WeakMap<object, ArtifactRef | null>();

/** The graph artifact a proposal yields, or null when it changes no graph. Its card opens it. */
export function proposalGraphArtifact(proposal: ProposalOutput): ArtifactRef | null {
  if (cache.has(proposal)) return cache.get(proposal) ?? null;
  const found = graphChange(proposal);
  const ref: ArtifactRef | null = found
    ? {
        id: `proposal:${proposal.proposalId}`,
        kind: "graph",
        title: found.title,
        label: "Proposed change",
        summary: proposal.rationale,
        source: {
          type: "inline",
          content: {
            workspace: found.workspace,
            ...(found.focus && { focus: found.focus }),
            changes: found.changes,
            proposal: proposal.proposalId,
          },
        },
      }
    : null;
  cache.set(proposal, ref);
  return ref;
}

/** The graph artifacts a message's proposals yield. `derive` tells a graph proposal from any other tool's output. */
export function proposalGraphArtifacts(toolCalls: ReadonlyArray<{ output?: unknown }> | undefined): ArtifactRef[] {
  if (!toolCalls?.length) return [];
  return toolCalls.flatMap((tc) => {
    if (!tc.output || typeof tc.output !== "object") return [];
    const ref = proposalGraphArtifact(tc.output as ProposalOutput);
    return ref ? [ref] : [];
  });
}

/**
 * The graphs this conversation's approved proposals changed: each approved
 * graph proposal's id and workspace, so a graph open on it can be read again.
 */
export function approvedGraphChanges(
  messages: ReadonlyArray<{
    role: string;
    toolCalls?: ReadonlyArray<{ output?: unknown }>;
    approvalResult?: { proposalId: string };
  }>,
): Array<{ proposalId: string; workspace: string }> {
  const approved = new Set(
    messages.flatMap((m) => (m.role === "assistant" && m.approvalResult ? [m.approvalResult.proposalId] : [])),
  );
  if (approved.size === 0) return [];
  return messages.flatMap((m) =>
    (m.toolCalls ?? []).flatMap((tc) => {
      if (!tc.output || typeof tc.output !== "object") return [];
      const proposal = tc.output as ProposalOutput;
      const found = approved.has(proposal.proposalId) ? graphChange(proposal) : null;
      return found ? [{ proposalId: proposal.proposalId, workspace: found.workspace }] : [];
    }),
  );
}
