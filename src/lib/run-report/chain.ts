/**
 * Deterministic backwards-chain builder for the rubric-first report.
 *
 * Tier 1: built purely from the bundle projection; complete and navigable
 * with zero commentary. Tier 2: optional per-hop commentary from
 * analysis.traces[], attached by rubric_id — a missing trace never removes
 * or collapses a hop, and every derived answer names its method.
 */
import type { RunReportProjection } from "./types";
import { isRecord, asString, readTraces } from "./derive";
import { buildNodeIdentities } from "./tool-activity";

export type Tone = "pass" | "warn" | "muted";

export const CONCEPT_NODE_TYPES = new Set(["Concept"]);

/** How a deterministic answer was derived — shown so nothing looks like magic. */
export type Method = "term-match" | "artifact" | "records" | "none";

export interface HopLink {
  label: string;
  docId?: string; // opens the document modal
  tokens?: string[]; // highlight terms
  workfile?: string; // workfile name (no viewer mode — inline preview)
}

export interface Hop {
  n: number;
  question: string;
  answer: string; // deterministic, always present (named gap when absent)
  tone: Tone;
  method: Method; // how the deterministic answer was derived
  links: HopLink[];
  gap?: string; // named gap class, when the answer is a gap statement
  commentary?: { answer: string; evidence: string } | null; // null = not yet assessed
  commentaryNote?: string; // e.g. verification sub-annotation on hop 2
}

export interface ConceptPull {
  name: string;
  nodeType: string | null;
  total: number;
  agents: { name: string; count: number }[];
  /** Graph ref_id when the run recorded one — enables live node fetches. */
  refId: string | null;
}

export interface CriterionChain {
  id: string;
  title: string;
  verdict: "fail" | "unscored" | "pass";
  reasoning: string;
  /** What the criterion asked for (empty when the bundle lacks it). */
  matchCriteria: string;
  /** Judge-review fields; interpreted only via resolveJudgeDispute. */
  judgeFlagged?: boolean | number | string;
  judgeFlagReason?: string;
  documentExcerpt: string;
  hops: Hop[];
  /** Distinctive rubric terms (figures + quoted phrases) for term matching. */
  tokens: string[];
  verdictNote?: { rootCause: string; classification: string; fixes: string[] };
}

/** Figures and quoted phrases — the rubric author flagging exact expectations. */
export function rubricTokens(title: string, reasoning: string): string[] {
  const txt = `${title} ${reasoning}`;
  const toks = new Set<string>();
  for (const m of txt.matchAll(/\$?\d{1,3}(?:,\d{3})+(?:\.\d+)?|\$?\d+\.\d+%?|\d+%/g)) {
    toks.add(m[0]);
  }
  for (const m of txt.matchAll(/[‘'"“]([A-Za-z][A-Za-z0-9 \-\/]{5,60})[’'"”]/g)) {
    toks.add(m[1]);
  }
  return [...toks].slice(0, 12);
}

export interface ChainModel {
  deliverables: { id: string; title: string }[];
  checklist: { name: string; text: string } | null;
  checklistGap: string | null;
  criteria: CriterionChain[];
  inputDocs: { id: string; title: string; kind: string }[];
  workfiles: { name: string; text: string }[];
  /** Deterministic: graph nodes pulled during the run, ranked by retrieval count. */
  topConcepts: ConceptPull[];
  conceptsGap: string | null;
}

const CHECKLIST_STEP_HINT = /checklist/i;

export function buildChainModel(projection: RunReportProjection): ChainModel {
  // The projection strips the bundle's `kind` field, so the deliverable is
  // identified by the producer's stable id/title convention.
  const sourceDocs = projection.sourceDocs;
  const isDeliverable = (d: { id: string; title: string }) =>
    d.id.startsWith("deliverable-") || d.title.startsWith("FINAL DELIVERABLE");
  const deliverables = sourceDocs
    .filter(isDeliverable)
    .map((d) => ({ id: d.id, title: d.title }));
  const inputDocs = sourceDocs
    .filter((d) => !isDeliverable(d))
    .map((d) => ({ id: d.id, title: d.title, kind: "document" }));

  const workfiles = projection.workfiles
    .map((w) => ({ name: asString((w as Record<string, unknown>).name) ?? "", text: asString((w as Record<string, unknown>).text) ?? "" }))
    .filter((w) => w.name);
  const checklistWf = workfiles.find((w) => w.name === "checklist.md" || w.name.endsWith("/checklist.md")) ?? null;

  // Named gap for a missing checklist: artifact absent vs stage never ran.
  const ranChecklistStep = projection.pageData.timeline.some((t) => CHECKLIST_STEP_HINT.test(t.step));
  const checklistGap = checklistWf
    ? null
    : ranChecklistStep
      ? "A checklist step ran, but the checklist artifact is absent from this bundle."
      : "No checklist stage ran in this pipeline.";

  const deliverableIds = new Set(deliverables.map((d) => d.id));
  const traceById = new Map(
    readTraces(projection.analysis).map((t) => [t.rubric_id, t]),
  );

  const criteria: CriterionChain[] = projection.rubricRows.map((row) => {
    const verdict: CriterionChain["verdict"] = row.passed
      ? "pass"
      : row.verdict?.trim()
        ? "fail"
        : "unscored";

    const links = projection.rubricLinks[row.id] ?? [];
    const delivHits = links.filter((l) => deliverableIds.has(l.doc));
    const srcHits = links.filter((l) => !deliverableIds.has(l.doc));
    const tokens = rubricTokens(row.title, row.matchCriteria || row.reasoning || "");
    // "no terms found" is only meaningful when the rubric HAS distinctive
    // terms - otherwise term matching is not applicable, a different state.
    const termable = tokens.length > 0 || links.length > 0;
    const trace = traceById.get(row.id);

    const q = (t: unknown): { answer: string; evidence: string } | null => {
      if (!isRecord(t)) return null;
      const answer = asString(t.answer);
      if (!answer) return null;
      return { answer, evidence: asString(t.evidence) ?? "" };
    };

    const hops: Hop[] = [
      {
        n: 1,
        question: "The deliverable",
        ...(deliverables.length > 0
          ? {
              answer: "",
              tone: "pass" as Tone,
              method: "artifact" as Method,
              links: deliverables.map((d) => ({ label: d.title, docId: d.id })),
            }
          : {
              answer:
                Object.keys(projection.pageData.outputs ?? {}).length > 0
                  ? "The run recorded outputs, but none convertible to a viewable deliverable."
                  : "The run recorded no outputs.",
              tone: "warn" as Tone,
              method: "none" as Method,
              links: [],
              gap: "deliverable",
            }),
        commentary: null,
      },
      {
        n: 2,
        question: "Did the deliverable cover this rubric?",
        ...(deliverables.length === 0
          ? { answer: "Cannot be assessed — no viewable deliverable.", tone: "muted" as Tone, method: "none" as Method, links: [], gap: "deliverable" }
          : delivHits.length > 0
            ? {
                answer: `Rubric terms appear in the deliverable: ${delivHits[0].tokens.slice(0, 3).map((t) => `“${t}”`).join(", ")}.`,
                tone: "pass" as Tone,
                method: "term-match" as Method,
                links: delivHits.map((h) => ({ label: "open highlighted", docId: h.doc, tokens: h.tokens })),
              }
            : termable
              ? {
                  answer: "None of this rubric's distinctive terms appear in the deliverable.",
                  tone: "warn" as Tone,
                  method: "term-match" as Method,
                  links: [],
                }
              : {
                  answer:
                    "This rubric has no distinctive terms (figures or quoted phrases) — term matching is not applicable.",
                  tone: "muted" as Tone,
                  method: "none" as Method,
                  links: [],
                }),
        commentary: q(trace?.q_draft_got_it),
        commentaryNote: q(trace?.q_verify_got_it)
          ? `Verification: ${q(trace?.q_verify_got_it)!.answer}`
          : undefined,
      },
      {
        n: 3,
        question: "The checklist",
        ...(checklistWf
          ? { answer: "", tone: "pass" as Tone, method: "artifact" as Method, links: [{ label: checklistWf.name, workfile: checklistWf.name }] }
          : { answer: checklistGap!, tone: "warn" as Tone, method: "none" as Method, links: [], gap: "checklist" }),
        commentary: null,
      },
      {
        n: 4,
        question: "Did the checklist represent what the rubric expected?",
        answer: "No deterministic signal exists for this — it needs semantic comparison (LLM tier).",
        tone: "muted",
        method: "none",
        links: [],
        commentary: null,
      },
      {
        n: 5,
        question: "Does this rubric trace to the source documents?",
        ...(srcHits.length > 0
          ? {
              answer: `Rubric terms found in ${srcHits.length} source document(s).`,
              tone: "pass" as Tone,
              method: "term-match" as Method,
              links: srcHits.map((h) => ({ label: h.doc, docId: h.doc, tokens: h.tokens })),
            }
          : termable
            ? {
                answer: "None of this rubric's distinctive terms appear in any source document.",
                tone: "warn" as Tone,
                method: "term-match" as Method,
                links: [],
                gap: "sources",
              }
            : {
                answer:
                  "This rubric has no distinctive terms — term matching is not applicable; only the agent layer can trace it.",
                tone: "muted" as Tone,
                method: "none" as Method,
                links: [],
              }),
        commentary: q(trace?.q_ingested_to_graph),
      },
      {
        n: 6,
        question: "The raw materials",
        answer: `${inputDocs.length} source document(s), ${workfiles.length} work file(s).`,
        tone: "pass",
        method: "artifact",
        links: [
          ...inputDocs.map((d) => ({ label: d.title, docId: d.id })),
          ...workfiles.slice(0, 12).map((w) => ({ label: w.name, workfile: w.name })),
        ],
        commentary: q(trace?.q_knowable_or_derived),
      },
    ];

    const rootCause = asString((trace as unknown as Record<string, unknown> | undefined)?.root_cause);
    return {
      id: row.id,
      title: row.title,
      verdict,
      reasoning: row.reasoning ?? "",
      matchCriteria: row.matchCriteria ?? "",
      judgeFlagged: row.judgeFlagged,
      judgeFlagReason: row.judgeFlagReason,
      documentExcerpt: row.documentExcerpt ?? "",
      hops,
      tokens,
      verdictNote: trace && rootCause
        ? {
            rootCause,
            classification: asString((trace as unknown as Record<string, unknown>).classification) ?? "",
            fixes: Array.isArray(trace.fix_suggestions) ? trace.fix_suggestions.filter((f): f is string => typeof f === "string") : [],
          }
        : undefined,
    };
  });

  // Review order: failed first, then unscored, then passed — stable by id.
  const rank = { fail: 0, unscored: 1, pass: 2 } as const;
  criteria.sort((a, b) => rank[a.verdict] - rank[b.verdict] || a.id.localeCompare(b.id));

  // Concepts pulled — deterministic, from the run's own tool-activity records.
  const ta = projection.toolActivity;
  let topConcepts: ConceptPull[] = [];
  let conceptsGap: string | null = null;
  if (ta.present && ta.groups.length > 0) {
    // Aggregate identities sharing a display name (same node reached via
    // different identity kinds) so the header chips read one-per-concept.
    // Only knowledge-type nodes count as concepts - Excerpt/Document/
    // ComputedFigure/Organization are retrieval plumbing, not concepts.
    const byName = new Map<string, ConceptPull>();
    for (const identity of buildNodeIdentities(ta.groups)) {
      if (!CONCEPT_NODE_TYPES.has(identity.nodeType ?? "")) continue;
      const name = identity.name;
      if (!name) continue;
      const key = `${identity.nodeType ?? ""}|${name}`;
      const total = identity.agents.reduce((sum, a) => sum + a.count, 0) || 1;
      const refId = identity.identityKind === "ref_id" ? identity.identity : null;
      const existing = byName.get(key);
      if (existing) {
        existing.total += total;
        existing.refId = existing.refId ?? refId;
        for (const a of identity.agents) {
          const ea = existing.agents.find((x) => x.name === a.agentName);
          if (ea) ea.count += a.count;
          else existing.agents.push({ name: a.agentName, count: a.count });
        }
      } else {
        byName.set(key, {
          name,
          nodeType: identity.nodeType ?? null,
          total,
          agents: identity.agents.map((a) => ({ name: a.agentName, count: a.count })),
          refId,
        });
      }
    }
    topConcepts = [...byName.values()].sort((a, b) => b.total - a.total);
  } else {
    conceptsGap = "This bundle carries no tool-activity records — concept pulls cannot be derived.";
  }

  return {
    deliverables,
    checklist: checklistWf,
    checklistGap,
    criteria,
    inputDocs,
    workfiles,
    topConcepts,
    conceptsGap,
  };
}
