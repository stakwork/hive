"use client";

import React, { useEffect, useMemo, useState } from "react";
import type { RunReportProjection } from "@/lib/run-report/types";
import { readTraces } from "@/lib/run-report/derive";
import type { ChainModel, CriterionChain, Hop, HopLink } from "@/lib/run-report/chain";
import { Kicker, StatusBadge, EmptyPanel } from "./chrome";
import { resolveJudgeDispute } from "@/lib/harvey-lab/eval-normalizers";
import {
  buildContestedIndex,
  isCriterionContested,
  type GraphRubric,
} from "@/lib/harvey-lab/rubric-scoring";
import { CriterionMarkers } from "./CriterionMarkers";

/**
 * Shared pass/fail badge used in the rubric ledger list rows and in
 * `ConsolidatedReportView`'s cross-run matrix cells.
 *
 * Deliberately minimal — one round dot + text. Styling is consistent with
 * the DOT map used in `CriterionButton` so the two surfaces read as one system.
 */
export function PassFailBadge({ pass }: { pass: boolean }) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5",
        "font-mono text-[10px] uppercase tracking-[0.07em] border",
        pass
          ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40"
          : "bg-destructive/15 text-destructive border-destructive/45",
      ].join(" ")}
      data-testid={pass ? "pass-fail-badge-pass" : "pass-fail-badge-fail"}
    >
      <span
        className={[
          "h-1.5 w-1.5 rounded-full",
          pass ? "bg-emerald-500/70" : "bg-destructive",
        ].join(" ")}
      />
      {pass ? "pass" : "fail"}
    </span>
  );
}

/**
 * Rubric-first review ledger.
 *
 * Master list on the left carries only failed and unscored criteria (the
 * review surface); passes fold away beneath it. The right panel walks the
 * selected criterion backwards through six hops — deliverable → checklist →
 * rubric coverage → sources → raw materials — every hop deterministic and
 * method-labeled. Agent commentary (Tier 2) appends per hop only when the
 * bundle actually carries failure traces; a missing annotation never
 * removes a hop.
 *
 * Rail deep links: `#rubric-<id>` selects that criterion.
 */

type OpenDoc = (docId: string, tokens: string[]) => void;

const DOT: Record<CriterionChain["verdict"], string> = {
  fail: "bg-destructive",
  unscored: "bg-amber-500",
  pass: "bg-emerald-500/70",
};

const TONE_DOT: Record<Hop["tone"], string> = {
  pass: "bg-emerald-500",
  warn: "bg-amber-500",
  muted: "bg-muted-foreground/40",
};

const METHOD_LABEL: Record<string, string> = {
  "term-match": "term match",
  artifact: "recovered artifact",
  records: "run records",
};

function MethodTag({ method }: { method: Hop["method"] }) {
  const label = METHOD_LABEL[method];
  if (!label) return null;
  return (
    <span
      title={
        method === "term-match"
          ? "Distinctive terms from the rubric (figures, quoted phrases) searched in the document text — mechanical, not semantic."
          : method === "artifact"
            ? "Reconstructed from the run's own transcripts and outputs."
            : "Derived from the run's recorded tool calls."
      }
      className="font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground/50 border border-border rounded px-1 py-px cursor-help"
    >
      {label}
    </span>
  );
}

function WorkfileChip({ name, chain }: { name: string; chain: ChainModel }) {
  const [open, setOpen] = useState(false);
  const wf = chain.workfiles.find((w) => w.name === name);
  return (
    <span className="inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 font-mono text-[10.5px] text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors"
      >
        🗎 {name}
      </button>
      {open && wf && (
        <pre className="mt-2 max-h-72 overflow-auto rounded border border-border bg-muted/20 p-3 text-[11px] whitespace-pre-wrap">
          {wf.text.slice(0, 6000)}
          {wf.text.length > 6000 ? "\n… (truncated preview)" : ""}
        </pre>
      )}
    </span>
  );
}

function HopLinks({
  links,
  chain,
  onOpenDoc,
}: {
  links: HopLink[];
  chain: ChainModel;
  onOpenDoc: OpenDoc;
}) {
  if (links.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5">
      {links.map((link, i) =>
        link.docId ? (
          <button
            key={`${link.docId}-${i}`}
            type="button"
            onClick={() => onOpenDoc(link.docId!, link.tokens ?? [])}
            className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 font-mono text-[10.5px] text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors"
            data-testid="run-report-hop-doc-link"
          >
            📄 {link.label}
            {link.tokens && link.tokens.length > 0 && (
              <span className="text-muted-foreground/60">· {link.tokens[0]}</span>
            )}
          </button>
        ) : link.workfile ? (
          <WorkfileChip key={`${link.workfile}-${i}`} name={link.workfile} chain={chain} />
        ) : null,
      )}
    </div>
  );
}

function CommentarySlot({ hop, show }: { hop: Hop; show: boolean }) {
  if (!show) return null;
  if (hop.commentary) {
    return (
      <div className="mt-2 rounded border border-primary/25 bg-primary/[0.04] px-3 py-2">
        <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground/70 mb-0.5">
          Agent assessment
        </div>
        <div className="text-[12.5px]">
          <b>{hop.commentary.answer}</b>
          {hop.commentary.evidence && (
            <span className="text-muted-foreground"> — {hop.commentary.evidence}</span>
          )}
        </div>
        {hop.commentaryNote && (
          <div className="text-[11.5px] text-muted-foreground mt-1">{hop.commentaryNote}</div>
        )}
      </div>
    );
  }
  return (
    <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground/60">
      not yet assessed
    </div>
  );
}

function CriterionButton({
  c,
  selected,
  small,
  contested,
  onSelect,
}: {
  c: CriterionChain;
  selected: boolean;
  small?: boolean;
  contested: boolean;
  onSelect: (id: string) => void;
}) {
  const dispute = resolveJudgeDispute({
    verdict: c.verdict,
    flagged: c.judgeFlagged,
    llm_flag_reason: c.judgeFlagReason,
    flag_basis: c.judgeFlagBasis,
  });
  return (
    <button
      type="button"
      onClick={() => onSelect(c.id)}
      className={`w-full text-left px-3 flex items-center gap-2 transition-colors ${
        small ? "py-1.5" : "py-2"
      } ${selected ? "bg-muted/60" : "hover:bg-muted/30"}`}
      data-testid="run-report-ledger-item"
    >
      <span className={`${small ? "h-1.5 w-1.5" : "h-2 w-2"} rounded-full shrink-0 ${DOT[c.verdict]}`} />
      <span className={`font-mono ${small ? "text-[10px]" : "text-[10.5px]"} text-muted-foreground/80 min-w-[44px]`}>
        {c.id}
      </span>
      <span className={`${small ? "text-[11.5px] text-muted-foreground" : "text-[12px]"} truncate flex-1`}>
        {c.title}
      </span>
      <CriterionMarkers
        disputed={dispute?.isDispute}
        contested={contested}
        flagBasis={dispute?.flagBasis}
      />
    </button>
  );
}

export function RubricLedger({
  projection,
  chain,
  graphRubrics = null,
  onOpenDoc,
}: {
  projection: RunReportProjection;
  chain: ChainModel;
  graphRubrics?: GraphRubric[] | null;
  onOpenDoc: OpenDoc;
}) {
  // Tier 2 renders only when the bundle actually carries failure traces —
  // a deterministic run shows the pure scaffold, no empty slots.
  const hasCommentary = readTraces(projection.analysis).length > 0;

  // Contested definitions from the graph roster; the run-recorded flag is the
  // fallback inside isCriterionContested.
  const contestedIndex = useMemo(() => buildContestedIndex(graphRubrics), [graphRubrics]);
  const contestedOf = (c: CriterionChain) =>
    isCriterionContested(
      { id: c.id, title: c.title, contested: c.criterionContested },
      contestedIndex,
    );

  const [selectedId, setSelectedId] = useState(chain.criteria[0]?.id ?? "");
  const selected = chain.criteria.find((c) => c.id === selectedId) ?? chain.criteria[0];

  // Rail links (`#rubric-C-003`) select the criterion.
  useEffect(() => {
    const applyHash = () => {
      const m = window.location.hash.match(/^#rubric-(.+)$/);
      if (!m) return;
      const id = decodeURIComponent(m[1]);
      if (chain.criteria.some((c) => c.id === id)) {
        setSelectedId(id);
        document.getElementById("rubrics")?.scrollIntoView();
      }
    };
    applyHash();
    window.addEventListener("hashchange", applyHash);
    return () => window.removeEventListener("hashchange", applyHash);
  }, [chain.criteria]);

  const open = chain.criteria.filter((c) => c.verdict !== "pass");
  const passed = chain.criteria.filter((c) => c.verdict === "pass");

  if (chain.criteria.length === 0) {
    return (
      <section id="rubrics" className="scroll-mt-6" data-testid="run-report-section-rubrics">
        <Kicker>Review</Kicker>
        <h2 className="text-2xl font-semibold tracking-tight mb-4">Rubrics</h2>
        <EmptyPanel label="This run is ungraded — the bundle carries no rubric results." />
      </section>
    );
  }

  return (
    <section id="rubrics" className="scroll-mt-6" data-testid="run-report-section-rubrics">
      <Kicker>Review</Kicker>
      <h2 className="text-2xl font-semibold tracking-tight mb-4">Rubrics</h2>

      <div className="grid grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)] gap-6 items-start">
        <div className="md:sticky md:top-4 max-h-[calc(100dvh-8rem)] overflow-y-auto overscroll-contain">
          <div className="rounded-lg border border-border divide-y divide-border">
            {open.map((c) => (
              <CriterionButton
                key={c.id}
                c={c}
                selected={c.id === selected?.id}
                contested={contestedOf(c)}
                onSelect={setSelectedId}
              />
            ))}
          </div>
          {passed.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer font-mono text-[10.5px] text-muted-foreground/70 px-1 py-1 list-none [&::-webkit-details-marker]:hidden hover:text-foreground">
                ✓ {passed.length} passed
              </summary>
              <div className="rounded-lg border border-border divide-y divide-border mt-1">
                {passed.map((c) => (
                  <CriterionButton
                    key={c.id}
                    c={c}
                    small
                    selected={c.id === selected?.id}
                    contested={contestedOf(c)}
                    onSelect={setSelectedId}
                  />
                ))}
              </div>
            </details>
          )}
        </div>

        {selected && (() => {
          const detailDispute = resolveJudgeDispute({
            verdict: selected.verdict,
            flagged: selected.judgeFlagged,
            llm_flag_reason: selected.judgeFlagReason,
            flag_basis: selected.judgeFlagBasis,
          });
          return (
            <div className="rounded-lg border border-border p-5">
              <div className="flex items-baseline gap-3 mb-2">
                <span className="font-mono text-[11px] text-muted-foreground/70">{selected.id}</span>
                <h3 className="text-[16px] font-semibold flex-1">{selected.title}</h3>
                <CriterionMarkers
                  disputed={detailDispute?.isDispute}
                  contested={contestedOf(selected)}
                  flagBasis={detailDispute?.flagBasis}
                />
                <StatusBadge
                  kind={selected.verdict === "pass" ? "pass" : selected.verdict === "fail" ? "fail" : "warn"}
                >
                  {selected.verdict}
                </StatusBadge>
              </div>
              {selected.matchCriteria && (
                <div className="mb-3">
                  <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground/70 mb-0.5">
                    Criteria
                  </div>
                  <p className="text-[12.5px] text-muted-foreground whitespace-pre-wrap">
                    {selected.matchCriteria}
                  </p>
                </div>
              )}
              {selected.reasoning && (
                <p className="text-[12.5px] text-muted-foreground border-l-2 border-border pl-3 mb-4 whitespace-pre-wrap">
                  <b className="text-foreground">Judge:</b> {selected.reasoning}
                </p>
              )}
              {detailDispute && (
                <div
                  className="rounded border border-amber-500/40 bg-amber-500/[0.06] px-3.5 py-2.5 mb-4"
                  data-testid="run-report-judge-dispute"
                  data-judge-state={detailDispute.isDispute ? "dispute" : "note"}
                >
                  <div className="font-mono text-[9px] uppercase tracking-[0.12em] text-amber-700 dark:text-amber-400 mb-1">
                    {detailDispute.isDispute ? "Judge Dispute" : "Judge Note"}
                  </div>
                  <p className="text-[12.5px] whitespace-pre-wrap">{detailDispute.displayText}</p>
                  {selected.documentExcerpt && (
                    <blockquote className="mt-2 max-h-40 overflow-y-auto overscroll-contain border-l-2 border-amber-500/40 pl-3 text-[12px] text-muted-foreground whitespace-pre-wrap">
                      {selected.documentExcerpt}
                    </blockquote>
                  )}
                </div>
              )}
              {hasCommentary && selected.verdictNote && (
                <div className="rounded border border-destructive/30 bg-destructive/[0.04] px-3.5 py-2.5 mb-4">
                  <div className="flex items-baseline gap-2">
                    <StatusBadge kind="fail">{selected.verdictNote.classification || "root cause"}</StatusBadge>
                    <span className="text-[13px]">{selected.verdictNote.rootCause}</span>
                  </div>
                  {selected.verdictNote.fixes.length > 0 && (
                    <ul className="list-disc pl-5 mt-1.5 space-y-0.5">
                      {selected.verdictNote.fixes.map((f, i) => (
                        <li key={i} className="text-[12.5px] text-muted-foreground">
                          {f}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="divide-y divide-border/60">
                {selected.hops.map((hop) => (
                  <div
                    key={hop.n}
                    className="grid grid-cols-[210px_minmax(0,1fr)] gap-4 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/70 pt-0.5">
                      <span className="text-muted-foreground/40 mr-1">{hop.n}</span>
                      {hop.question}
                    </div>
                    <div>
                      {hop.answer ? (
                        <div className="flex items-center gap-2 text-[13px]">
                          <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${TONE_DOT[hop.tone]}`} />
                          <span>{hop.answer}</span>
                          <MethodTag method={hop.method} />
                        </div>
                      ) : null}
                      <HopLinks links={hop.links} chain={chain} onOpenDoc={onOpenDoc} />
                      <CommentarySlot hop={hop} show={hasCommentary} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })()}
      </div>
    </section>
  );
}
