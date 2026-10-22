"use client";

import { type CSSProperties, useRef } from "react";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import type { ArtifactRef, ArtifactVersion } from "../../_state/canvasChatArtifacts";
import type { CanvasJob } from "../../_state/useCanvasJobs";
import { ChatArtifacts } from "../artifacts/ChatArtifacts";
import { useMoreBelow } from "../artifacts/chrome";
import type { PlanNode } from "./board";
import { type CardContext, TYPE, label, pill, stop } from "./nodes";
import { a, v } from "./theme";

const panel = (w: number, h: number): CSSProperties => ({
  width: w,
  height: h,
  boxSizing: "border-box",
  padding: "12px 14px",
  borderRadius: 8,
  background: v("card"),
  border: `1px solid ${v("border")}`,
  boxShadow: v("shadow"),
  color: v("ink"),
  display: "flex",
  flexDirection: "column",
  gap: 8,
  overflow: "hidden",
});

/** Markdown inside a card, in the card's ink. */
const prose = "[&_*]:!text-[var(--ic-ink-soft)] [&_*]:![font-family:inherit]";

/** How the feature is built (`HAS_ARCHITECTURE`): its summary and diagram, or an empty state that says who writes it. */
export function ArchitectureCard({ f, w, h }: { f: PlanNode; w: number; h: number }) {
  const arch = f.architecture;
  return (
    <div data-architecture={f.id} style={panel(w, h)}>
      <div style={label}>Architecture</div>
      {arch ? (
        <div style={{ display: "flex", gap: 14, flex: 1, minHeight: 0 }}>
          <div
            data-wheel-scroll
            style={{ flex: 1, minWidth: 0, overflowY: "auto", fontFamily: TYPE, fontSize: 12.5, lineHeight: 1.4 }}
          >
            {arch.name ? <div style={{ fontWeight: 600, marginBottom: 4 }}>{arch.name}</div> : null}
            <div className={prose}>
              <MarkdownRenderer variant="assistant" size="compact">
                {arch.description}
              </MarkdownRenderer>
            </div>
          </div>
          {arch.diagram ? (
            <div
              data-diagram
              style={{
                flex: 1.3,
                minWidth: 0,
                overflow: "hidden",
                borderRadius: 6,
                background: v("field"),
                border: `1px solid ${v("border")}`,
                padding: 6,
              }}
            >
              <MarkdownRenderer variant="assistant" size="compact">
                {`\`\`\`mermaid\n${arch.diagram}\n\`\`\``}
              </MarkdownRenderer>
            </div>
          ) : null}
        </div>
      ) : (
        <div style={{ fontFamily: TYPE, fontSize: 12.5, color: v("notStarted") }}>
          No architecture yet. Ask Jamie to draft it.
        </div>
      )}
    </div>
  );
}

const JOB: Record<CanvasJob["state"], { label: string; color: string }> = {
  running: { label: "Running", color: v("job") },
  done: { label: "Done", color: v("done") },
  failed: { label: "Failed", color: v("blocked") },
};

const NO_VERSIONS = new Map<ArtifactRef, ArtifactVersion>();

/**
 * The build: the strut jobs started on this feature, then the pull requests
 * they returned (any number, across repos), which open on the artifact
 * panel. With no jobs yet, Implement starts one once there's an architecture.
 */
export function BuildCard({
  c,
  f,
  prs,
  busy,
  w,
  h,
}: {
  c: CardContext;
  f: PlanNode;
  prs: ArtifactRef[];
  busy: boolean;
  w: number;
  h: number;
}) {
  const jobs = c.jobs[f.id] ?? [];
  const canImplement = !!f.architecture && !busy;
  const list = useRef<HTMLDivElement>(null);
  const more = useMoreBelow(list);
  return (
    // As tall as what it holds, up to its slot: no empty band under the last row.
    <div data-build={f.id} style={{ ...panel(w, h), height: "auto", maxHeight: h }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={label}>Build</span>
        <span style={{ fontFamily: TYPE, fontSize: 11.5, color: v("muted") }}>{c.work(f.id)?.line}</span>
      </div>
      {jobs.length || prs.length ? (
        <div
          ref={list}
          data-wheel-scroll
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
            overflowY: "auto",
            minHeight: 0,
            // More below: the last rows fade out.
            ...(more ? { maskImage: "linear-gradient(to bottom, black calc(100% - 36px), transparent)" } : {}),
          }}
        >
          {jobs.map((j) => (
            <div
              key={j.jobId}
              data-build-job={j.jobId}
              style={{
                display: "flex",
                flexDirection: "column",
                padding: "4px 0",
                borderTop: `1px solid ${a("road", 12)}`,
                fontFamily: TYPE,
                fontSize: 12.5,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  className={j.state === "running" ? "icb-pulse" : undefined}
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 9,
                    flexShrink: 0,
                    border: `1.5px solid ${JOB[j.state].color}`,
                    background: j.state === "done" ? v("done") : "transparent",
                  }}
                />
                <span
                  style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {j.title}
                  {j.startedBy?.name ? <span style={{ color: v("muted") }}> · {j.startedBy.name}</span> : null}
                </span>
                <span style={{ whiteSpace: "nowrap", fontSize: 11.5, color: JOB[j.state].color }}>
                  {JOB[j.state].label}
                </span>
              </div>
              {j.state === "failed" && j.error ? (
                <div style={{ paddingLeft: 16, fontSize: 11.5, color: v("blockedInk") }}>{j.error}</div>
              ) : null}
            </div>
          ))}
          {prs.length ? (
            <div className="bg-transparent text-[var(--ic-ink)]" style={{ paddingTop: 6 }} {...stop}>
              <ChatArtifacts artifacts={prs} versions={NO_VERSIONS} />
            </div>
          ) : null}
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: TYPE, fontSize: 12.5 }}>
          <button
            type="button"
            data-implement={f.id}
            disabled={!canImplement}
            title={f.architecture ? undefined : "Draft the architecture first"}
            onPointerDown={stop.onPointerDown}
            onClick={(e) => {
              e.stopPropagation();
              c.actions.implement(f.id);
            }}
            style={pill(12, { opacity: canImplement ? 1 : 0.5, cursor: canImplement ? "pointer" : "default" })}
          >
            Implement
          </button>
          <span style={{ color: v("notStarted") }}>
            {f.architecture
              ? "Starts a job on this feature. Its pull requests show here."
              : "Needs an architecture first."}
          </span>
        </div>
      )}
    </div>
  );
}
