"use client";

/**
 * "Checklist ↔ Rubrics" two-column join view.
 *
 * Left: the checklist items the run wrote for itself. Right: the rubric the
 * judge scored against. Deterministic joins are TERM MATCHES (a rubric's
 * distinctive figures/phrases appearing in an item's text) — mechanical and
 * incomplete by design; the semantic "did the checklist represent the
 * rubric" mapping is the agent layer (hop 4), unanswered in v1.
 * Hover either side to highlight counterparts.
 */

import React, { useMemo, useRef, useState } from "react";
import { Kicker } from "./chrome";
import type { ChainModel } from "@/lib/run-report/chain";

interface ChecklistItem {
  key: string;
  text: string;
}

function parseChecklistItems(text: string): ChecklistItem[] {
  const items: ChecklistItem[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*(?:[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)(.+)$/);
    if (!m) continue;
    const t = m[1].replace(/\*\*/g, "").trim();
    if (t.length < 4) continue;
    items.push({ key: `item-${items.length}`, text: t });
  }
  return items;
}

type Hover = { side: "item" | "rubric"; key: string } | null;
/** Hover highlights transiently; a click PINS the selection until re-clicked. */

export function ChecklistMap({ chain }: { chain: ChainModel }) {
  const model = chain;
  const containerRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const [hover, setHover] = useState<Hover>(null);
  // Clicking a row expands it to show its matches inline - the answer
  // appears under the click, never off-screen in the other column.
  const [expanded, setExpanded] = useState<Hover>(null);
  const active = hover ?? expanded;
  const toggle = (side: "item" | "rubric", key: string) =>
    setExpanded((p) => (p?.key === key ? null : { side, key }));

  const items = useMemo(
    () => (model.checklist ? parseChecklistItems(model.checklist.text) : []),
    [model.checklist],
  );

  // item.key -> rubric matches (with the term that joined them), and back
  const joins = useMemo(() => {
    const byItem = new Map<string, { id: string; token: string }[]>();
    const byRubric = new Map<string, { key: string; text: string; token: string }[]>();
    for (const item of items) {
      const lower = item.text.toLowerCase();
      for (const c of model.criteria) {
        const token = c.tokens.find((tok) => tok.length >= 4 && lower.includes(tok.toLowerCase()));
        if (token) {
          byItem.set(item.key, [...(byItem.get(item.key) ?? []), { id: c.id, token }]);
          byRubric.set(c.id, [...(byRubric.get(c.id) ?? []), { key: item.key, text: item.text, token }]);
        }
      }
    }
    return { byItem, byRubric };
  }, [items, model.criteria]);

  const hoveredRubrics = new Set(
    active?.side === "item"
      ? (joins.byItem.get(active.key) ?? []).map((m) => m.id)
      : active?.side === "rubric"
        ? [active.key]
        : [],
  );
  const hoveredItems = new Set(
    active?.side === "rubric"
      ? (joins.byRubric.get(active.key) ?? []).map((m) => m.key)
      : active?.side === "item"
        ? [active.key]
        : [],
  );

  if (!model.checklist) {
    return (
      <section id="checklist-map" className="mt-14 scroll-mt-6">
        <Kicker>Coverage</Kicker>
        <h2 className="text-2xl font-semibold tracking-tight mb-2">Checklist ↔ Rubrics</h2>
        <p className="text-sm text-muted-foreground italic">{model.checklistGap}</p>
      </section>
    );
  }

  return (
    <section id="checklist-map" className="mt-14 scroll-mt-6">
      <Kicker>Coverage</Kicker>
      <h2 className="text-2xl font-semibold tracking-tight mb-1">Checklist ↔ Rubrics</h2>
      <p className="text-sm text-muted-foreground max-w-[78ch] mb-4">
        What the run told itself to do, against what the judge scored. Hover either side to highlight its counterparts — joins are <b>term matches</b> (a rubric&apos;s distinctive
        figures or phrases appearing in an item), mechanical and incomplete by design; the
        semantic mapping is the agent layer.
      </p>

      <div ref={containerRef} className="relative grid grid-cols-2 gap-10">
        <div>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground/70 mb-2">
            checklist.md · {items.length} items
          </div>
          <div className="space-y-px max-h-[560px] overflow-y-auto overscroll-contain pr-1">
            {items.map((item, i) => {
              const n = joins.byItem.get(item.key)?.length ?? 0;
              const hot = hoveredItems.has(item.key);
              return (
                <div
                  key={item.key}
                  ref={(el) => { if (el) rowRefs.current.set(item.key, el); }}
                  onMouseEnter={() => setHover({ side: "item", key: item.key })}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => toggle("item", item.key)}
                  className={`flex items-baseline gap-2 rounded px-2 py-1 text-[11.5px] cursor-pointer transition-colors ${
                    hot ? "bg-primary/10" : n > 0 ? "hover:bg-muted/50" : "opacity-60"
                  }`}
                >
                  <span className="font-mono text-[9.5px] text-muted-foreground/50 min-w-[20px] text-right">{i + 1}</span>
                  <span className="flex-1">
                    {item.text}
                    {expanded?.key === item.key && (
                      <span className="block mt-1.5" onClick={(e) => e.stopPropagation()}>
                        {(joins.byItem.get(item.key) ?? []).length === 0 ? (
                          <span className="font-mono text-[10px] text-muted-foreground/60">
                            no term match to any rubric
                          </span>
                        ) : (
                          (joins.byItem.get(item.key) ?? []).map((m) => (
                            <a
                              key={m.id}
                              href={`#rubric-${m.id}`}
                              className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/[0.06] px-2 py-0.5 font-mono text-[10px] mr-1.5 hover:border-primary transition-colors"
                            >
                              {m.id} <span className="text-muted-foreground/70">via “{m.token}”</span> ↑
                            </a>
                          ))
                        )}
                      </span>
                    )}
                  </span>
                  {n > 0 && (
                    <span className="font-mono text-[9.5px] text-muted-foreground/70 tabular-nums shrink-0">⇢{n}</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground/70 mb-2">
            rubric · {model.criteria.length} criteria
          </div>
          <div className="space-y-px max-h-[560px] overflow-y-auto overscroll-contain pr-1">
            {model.criteria.map((c) => {
              const n = joins.byRubric.get(c.id)?.length ?? 0;
              const hot = hoveredRubrics.has(c.id);
              return (
                <div
                  key={c.id}
                  ref={(el) => { if (el) rowRefs.current.set(`rubric-${c.id}`, el); }}
                  onMouseEnter={() => setHover({ side: "rubric", key: c.id })}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => toggle("rubric", c.id)}
                  className={`group flex items-baseline gap-2 rounded px-2 py-1 text-[11.5px] cursor-pointer transition-colors ${
                    hot ? "bg-primary/10" : "hover:bg-muted/50"
                  } ${c.verdict === "fail" ? "text-destructive" : c.verdict === "unscored" ? "text-amber-600 dark:text-amber-400" : ""}`}
                >
                  {n > 0 && (
                    <span className="font-mono text-[9.5px] text-muted-foreground/70 tabular-nums shrink-0">{n}⇠</span>
                  )}
                  <span className="font-mono text-[9.5px] text-muted-foreground/60 min-w-[40px]">{c.id}</span>
                  <span className="flex-1">
                    {c.title}
                    {expanded?.key === c.id && (
                      <span className="block mt-1.5 text-foreground" onClick={(e) => e.stopPropagation()}>
                        {(joins.byRubric.get(c.id) ?? []).length === 0 ? (
                          <span className="font-mono text-[10px] text-muted-foreground/60">
                            no checklist item shares a distinctive term with this rubric
                          </span>
                        ) : (
                          (joins.byRubric.get(c.id) ?? []).map((m) => (
                            <span
                              key={m.key}
                              className="block rounded border border-primary/30 bg-primary/[0.05] px-2 py-1 text-[10.5px] mb-1"
                            >
                              {m.text.slice(0, 140)}
                              <span className="font-mono text-muted-foreground/70"> — via “{m.token}”</span>
                            </span>
                          ))
                        )}
                      </span>
                    )}
                  </span>
                  <a
                    href={`#rubric-${c.id}`}
                    onClick={(e) => e.stopPropagation()}
                    title="open in the rubric ledger"
                    className="opacity-0 group-hover:opacity-100 font-mono text-[10px] text-primary shrink-0"
                  >
                    open ↑
                  </a>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
