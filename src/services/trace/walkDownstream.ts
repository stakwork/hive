/**
 * Finding the later steps that used a selection that came from a middle
 * step — up to the final output. Pure, and shares its matching rule with
 * `matchUpstream` so a value read the same way on both sides of the chain.
 */

import type { TraceLink } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";
import { containsSelection } from "./matchUpstream";
import type { TraceSourceStep } from "./types";

const EXCERPT_WINDOW = 160;
const MAX_EXCERPT = 4000;

function excerptAround(text: string, selection: string): string {
  const idx = text.indexOf(selection);
  if (idx === -1) {
    return text.length > MAX_EXCERPT ? `${text.slice(0, MAX_EXCERPT)}…` : text;
  }
  const start = Math.max(0, idx - EXCERPT_WINDOW);
  const end = Math.min(text.length, idx + selection.length + EXCERPT_WINDOW);
  const excerpt = `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
  return excerpt.length > MAX_EXCERPT ? `${excerpt.slice(0, MAX_EXCERPT)}…` : excerpt;
}

/**
 * Every step after `afterOrder` whose INPUT holds the selection, in the
 * order they ran — the chain of what used the value on, to the final
 * output. Downstream links are always `"exact"`: a later step's input
 * either quotes the value or it does not.
 */
export function walkDownstream(selection: string, steps: TraceSourceStep[], afterOrder: number): TraceLink[] {
  const trimmed = selection.trim();
  if (!trimmed) return [];
  const links: TraceLink[] = [];
  for (const step of steps) {
    if (step.order <= afterOrder) continue;
    if (!containsSelection(step.input, trimmed)) continue;
    links.push({
      toolCallId: step.toolCallId,
      path: step.path,
      toolName: step.toolName,
      excerpt: excerptAround(step.input, trimmed),
      match: "exact",
      ...(step.nodes && step.nodes.length > 0 ? { nodes: step.nodes } : {}),
    });
  }
  return links;
}
