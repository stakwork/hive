/**
 * Finding where a highlighted selection reads VERBATIM in an earlier
 * step's output — an "exact" link, before any model is asked to guess.
 * Pure: no DB, no network, so this is tested directly against fixtures.
 */

import type { TraceLink } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";
import type { TraceSourceStep } from "./types";

const EXCERPT_WINDOW = 160;
const MAX_EXCERPT = 4000;

/** Collapse whitespace, and strip thousands separators from numbers, so "12,345" and "12345" read the same. */
export function normalizeForMatch(text: string): string {
  return text
    .replace(/\d{1,3}(,\d{3})+(\.\d+)?/g, (match) => match.replace(/,/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether `haystack` holds `needle`, verbatim or after whitespace/number normalizing. */
export function containsSelection(haystack: string, needle: string): boolean {
  if (!needle) return false;
  if (haystack.includes(needle)) return true;
  const normalizedNeedle = normalizeForMatch(needle);
  return normalizedNeedle.length > 0 && normalizeForMatch(haystack).includes(normalizedNeedle);
}

/** A window of `text` around its (first, raw) occurrence of `selection`; the start of `text` when only the normalized form matched. */
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
 * Every step whose OUTPUT holds the selection, nearest producer first
 * (the step order reversed): the step right before the selection's own is
 * the most likely direct source, an earlier one is further back the chain.
 */
export function matchUpstream(selection: string, steps: TraceSourceStep[], beforeOrder = Infinity): TraceLink[] {
  const trimmed = selection.trim();
  if (!trimmed) return [];
  const links: TraceLink[] = [];
  for (const step of steps) {
    if (step.order >= beforeOrder) continue;
    if (!containsSelection(step.output, trimmed)) continue;
    links.push({
      toolCallId: step.toolCallId,
      path: step.path,
      toolName: step.toolName,
      excerpt: excerptAround(step.output, trimmed),
      match: "exact",
      ...(step.nodes && step.nodes.length > 0 ? { nodes: step.nodes } : {}),
    });
  }
  return links.reverse();
}
