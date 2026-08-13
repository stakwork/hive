"use client";

import React from "react";
import { FileText, AlertTriangle } from "lucide-react";
import {
  formatDuration,
  buildTimeline,
  buildGantt,
  readTraces,
  readSummaries,
  isRecord,
  asString,
} from "@/lib/run-report/derive";
import type {
  RunReportProjection,
  TraceRow,
  AgentSummary,
  ToolActivityProjection,
  ToolActivityGroup,
  NodeIdentityRow,
} from "@/lib/run-report/types";
import { buildNodeIdentities } from "@/lib/run-report/tool-activity";
import {
  anchorId,
  Section,
  Panel,
  EmptyPanel,
  Chip,
  StatusBadge,
  MiniHeading,
  KeyValues,
  Fold,
  Kicker,
  stringify,
  renderValue,
  CopyableId,
  SectionErrorBoundary,
} from "./chrome";
import { Gantt } from "./Gantt";
import { SafeMarkdown } from "./SafeMarkdown";

/**
 * The nine report sections, laid out as an editorial report rather than a stack
 * of cards — mirroring the information design of the generator's own viewer.
 *
 * ABSOLUTE RULE for this directory: every prose field from the bundle renders
 * as ESCAPED REACT TEXT. Nothing here imports `MarkdownRenderer` or
 * `MermaidDiagram` — `MarkdownRenderer` routes ```mermaid fences into
 * `MermaidDiagram`, which sets `dangerouslySetInnerHTML` with no mermaid
 * `securityLevel` configured. That is an HTML sink outside this directory, and
 * bundle content must never reach it.
 *
 * The only sanitized-HTML surface is `source_docs[].html`, rendered through
 * `SanitizedContent` in the document modal.
 */

// ── 2. Pipeline ──────────────────────────────────────────────────────────────

export function PipelineSection({ projection }: { projection: RunReportProjection }) {
  const { timeline, agents, branches } = projection.pageData;

  // Build Gantt from timeline[] + agents[] (absolute timestamps).
  // branches[] are plain strings — rendered as a list below the Gantt.
  const ganttSteps = buildTimeline(timeline, agents);
  const gantt = buildGantt(ganttSteps);

  return (
    <Section
      id="pipeline"
      kicker="Data flow"
      title="Pipeline timeline"
      lede={gantt ? `${gantt.bars.length} workflow steps on a shared time axis.` : undefined}
    >
      {gantt ? (
        <Gantt steps={ganttSteps} />
      ) : (
        <EmptyPanel label="No timing data for this run." />
      )}

      {branches.length > 0 && (
        <>
          <MiniHeading>Branch conditions ({branches.length})</MiniHeading>
          <Panel>
            <ul className="space-y-1">
              {branches.map((note, i) => (
                <li key={i} className="text-[13px] text-muted-foreground">
                  {note}
                </li>
              ))}
            </ul>
          </Panel>
        </>
      )}
    </Section>
  );
}

// ── 5. Agent roster ──────────────────────────────────────────────────────────

/** Map a trace Q/A pair to a readable label. */
const Q_LABELS: Record<string, string> = {
  q_ingested_to_graph: "Ingested to graph?",
  q_knowable_or_derived: "Knowable or derived?",
  q_draft_got_it: "Draft captured it?",
  q_verify_got_it: "Verify confirmed it?",
};

function TraceCard({
  trace,
  index,
  rubricTitle,
}: {
  trace: TraceRow;
  index: number;
  rubricTitle?: string;
}) {
  return (
    <Panel className="mt-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="font-mono text-[11px] text-muted-foreground/70">{trace.rubric_id}</span>
        <h3 className="text-[17px] font-semibold flex-1">
          {rubricTitle ?? `Trace ${index + 1}`}
        </h3>
        {trace.classification && (
          <StatusBadge kind="muted">{trace.classification}</StatusBadge>
        )}
      </div>

      {trace.root_cause && (
        <p className="text-[13px] text-muted-foreground mt-2 whitespace-pre-wrap">
          {trace.root_cause}
        </p>
      )}

      {trace.pathway.length > 0 && (
        <>
          <MiniHeading>Pathway ({trace.pathway.length} stations)</MiniHeading>
          <ul className="space-y-1">
            {trace.pathway.map((station, si) => (
              <li
                key={si}
                className="flex items-start gap-2 text-[12.5px] rounded px-2 py-1 bg-muted/30"
              >
                <StatusBadge
                  kind={
                    /pass|ok|found/i.test(String(station.status))
                      ? "pass"
                      : /fail|miss|no/i.test(String(station.status))
                        ? "fail"
                        : "muted"
                  }
                >
                  {String(station.status)}
                </StatusBadge>
                <span className="font-mono text-[11px] text-muted-foreground/70 shrink-0">
                  {String(station.station)}
                </span>
                {station.evidence != null && (
                  <div className="text-muted-foreground break-words flex-1">
                    {renderValue(station.evidence)}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {(["q_ingested_to_graph", "q_knowable_or_derived", "q_draft_got_it", "q_verify_got_it"] as const).map(
        (key) => {
          const qa = trace[key];
          if (!qa) return null;
          return (
            <React.Fragment key={key}>
              <MiniHeading>{Q_LABELS[key]}</MiniHeading>
              <div className="text-[13px] space-y-0.5">
                <div className="flex items-center gap-2">
                  <StatusBadge kind={/yes|pass|true/i.test(qa.answer) ? "pass" : "fail"}>
                    {qa.answer}
                  </StatusBadge>
                </div>
                {qa.evidence && (
                  <p className="text-muted-foreground whitespace-pre-wrap pl-0.5">
                    {qa.evidence}
                  </p>
                )}
              </div>
            </React.Fragment>
          );
        },
      )}

      {trace.fix_suggestions.length > 0 && (
        <>
          <MiniHeading>Fix suggestions</MiniHeading>
          <ul className="list-disc pl-5 space-y-1">
            {trace.fix_suggestions.map((s, si) => (
              <li key={si} className="text-[13px] text-muted-foreground">
                {s}
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

/** page_data.agents[].tools is a {toolName: count} record from send_agent_logs. */
function toolEntries(value: unknown): [string, number][] {
  return isRecord(value)
    ? Object.entries(value).filter((e): e is [string, number] => typeof e[1] === "number")
    : [];
}

function ToolCountsFold({ tools }: { tools: [string, number][] }) {
  return (
    <Fold summary={`Tool calls (${tools.length}) — as reported in the agent summary`}>
      <ul className="space-y-1">
        {tools.map(([toolName, count]) => (
          <li key={toolName} className="flex items-baseline gap-2 text-[12.5px]">
            <span className="font-mono text-[11px] text-muted-foreground/70 min-w-[80px]">
              {toolName}
            </span>
            <span className="text-muted-foreground/60 tabular-nums">×{count}</span>
          </li>
        ))}
      </ul>
    </Fold>
  );
}

function FinalAnswerFold({ text }: { text: string }) {
  return (
    <Fold summary="Final answer">
      <SafeMarkdown text={text} />
    </Fold>
  );
}

function AgentSummaryCard({
  summary,
  index,
  agent,
}: {
  summary: AgentSummary;
  index: number;
  agent?: Record<string, unknown>;
}) {
  const durationS = agent && typeof agent.duration_s === "number" ? agent.duration_s : null;
  const nMessages = agent && typeof agent.n_messages === "number" ? agent.n_messages : null;
  const recordedTools = agent ? toolEntries(agent.tools) : [];
  const finalAnswer = agent ? asString(agent.final_answer) : null;

  return (
    <div id={anchorId("agent", summary.agent_name)} className="scroll-mt-4">
    <Panel className="mt-4">
      <div className="flex flex-wrap items-baseline gap-3">
        <h3 className="text-[17px] font-semibold">{summary.agent_name}</h3>
        {durationS != null && <Chip label="ran" value={formatDuration(durationS * 1000)} />}
        {nMessages != null && <Chip label="messages" value={nMessages} />}
        {summary.mission && (
          <span className="text-[13px] text-muted-foreground truncate max-w-[40ch]">
            {summary.mission}
          </span>
        )}
      </div>

      {summary.context_gathered && (
        <p className="text-[13px] text-muted-foreground mt-2 whitespace-pre-wrap">
          {summary.context_gathered}
        </p>
      )}

      {summary.key_findings.length > 0 && (
        <>
          <MiniHeading>Key findings</MiniHeading>
          <ul className="list-disc pl-5 space-y-1">
            {summary.key_findings.map((f, fi) => (
              <li key={fi} className="text-[13px] text-muted-foreground">
                {f}
              </li>
            ))}
          </ul>
        </>
      )}

      {summary.anomalies.length > 0 && (
        <>
          <MiniHeading>Anomalies</MiniHeading>
          <ul className="list-disc pl-5 space-y-1">
            {summary.anomalies.map((a, ai) => (
              <li key={ai} className="text-[13px] text-muted-foreground">
                {a}
              </li>
            ))}
          </ul>
        </>
      )}

      {summary.tools.length > 0 && (
        <Fold summary={`Tools used (${summary.tools.length}) — as reported in the agent summary`}>
          <ul className="space-y-1">
            {summary.tools.map((tool, ti) => (
              <li key={ti} className="flex items-baseline gap-2 text-[12.5px]">
                <span className="font-mono text-[11px] text-muted-foreground/70 min-w-[80px]">
                  {tool.name}
                </span>
                <span className="text-muted-foreground/60 tabular-nums">×{tool.count}</span>
                {tool.purpose && (
                  <span className="text-muted-foreground">{tool.purpose}</span>
                )}
              </li>
            ))}
          </ul>
        </Fold>
      )}

      {summary.failed_rubric_relevance.length > 0 && (
        <Fold summary={`Rubric relevance notes (${summary.failed_rubric_relevance.length})`}>
          <ul className="space-y-1">
            {summary.failed_rubric_relevance.map((r, ri) => (
              <li key={ri} className="flex items-baseline gap-2 text-[12.5px]">
                <span className="font-mono text-[11px] text-muted-foreground/70">{r.rubric_id}</span>
                <span className="text-muted-foreground">{r.note}</span>
              </li>
            ))}
          </ul>
        </Fold>
      )}

      {/* Recorded activity from page_data.agents — ground truth regardless of
          what the LLM summary chose to mention. */}
      {summary.tools.length === 0 && recordedTools.length > 0 && (
        <ToolCountsFold tools={recordedTools} />
      )}
      {finalAnswer && <FinalAnswerFold text={finalAnswer} />}
    </Panel>
    </div>
  );
}

/**
 * Deterministic agent card — rendered from `page_data.agents[]` when the run
 * has no LLM summaries (deterministic mode, or every summary phase failed).
 * The producer contract for an entry: name, step, start/end, duration_s,
 * n_messages, tools as a {toolName: count} record, final_answer prose.
 * Everything renders as escaped React text per this directory's rule.
 */
function DeterministicAgentCard({ agent }: { agent: Record<string, unknown> }) {
  const name = asString(agent.name) ?? asString(agent.agent_label) ?? "(unnamed agent)";
  const step = asString(agent.step);
  const durationS = typeof agent.duration_s === "number" ? agent.duration_s : null;
  const nMessages = typeof agent.n_messages === "number" ? agent.n_messages : null;
  const tools = toolEntries(agent.tools);
  const finalAnswer = asString(agent.final_answer);

  return (
    <div id={anchorId("agent", name)} className="scroll-mt-4">
    <Panel className="mt-4">
      <div className="flex flex-wrap items-baseline gap-3" data-testid="run-report-deterministic-agent">
        <h3 className="text-[17px] font-semibold">{name}</h3>
        {step && <Chip label="step" value={step} />}
        {durationS != null && <Chip label="ran" value={formatDuration(durationS * 1000)} />}
        {nMessages != null && <Chip label="messages" value={nMessages} />}
      </div>

      {tools.length > 0 && <ToolCountsFold tools={tools} />}
      {finalAnswer && <FinalAnswerFold text={finalAnswer} />}
    </Panel>
    </div>
  );
}

export function TracesSection({ projection }: { projection: RunReportProjection }) {
  const traces = readTraces(projection.analysis);
  const summaries = readSummaries(projection.analysis);
  const deterministicAgents = projection.pageData.agents.filter(isRecord);
  const summarizedNames = new Set(summaries.map((s) => s.agent_name));
  const unsummarizedAgents = deterministicAgents.filter(
    (a) => !summarizedNames.has(asString(a.name) ?? ""),
  );
  // Recorded activity per agent (tool counts, final answer) joins the LLM
  // summary card by name so every card carries ground truth.
  const agentByName = new Map(
    deterministicAgents.map((a) => [asString(a.name) ?? "", a]),
  );

  // Build a quick rubric-id → title map for joining traces to rubric labels.
  const rubricTitleById = new Map(projection.rubricRows.map((r) => [r.id, r.title]));

  return (
    <Section id="agents" kicker="send_agent_logs" title="Agent roster" data-testid="run-report-section-agents">
      {/* ── Failure traces ──────────────────────────────────────────────── */}
      <MiniHeading>Failure traces ({traces.length})</MiniHeading>
      {/* An empty traces array is the deterministic-only run — a LEGITIMATE
          empty state that must never route to the error state. */}
      {traces.length === 0 ? (
        <EmptyPanel label="No agent traces for this run." />
      ) : (
        traces.map((trace, i) => (
          <TraceCard
            key={trace.rubric_id}
            trace={trace}
            index={i}
            rubricTitle={rubricTitleById.get(trace.rubric_id)}
          />
        ))
      )}

      {/* ── Agent summaries ─────────────────────────────────────────────── */}
      {summaries.length > 0 ? (
        <>
          <MiniHeading className="mt-8">Agent summaries ({summaries.length})</MiniHeading>
          {summaries.map((summary, i) => (
            <AgentSummaryCard
              key={summary.agent_name}
              summary={summary}
              index={i}
              agent={agentByName.get(summary.agent_name)}
            />
          ))}
          {/* Workers without an LLM summary (e.g. per-document ingestion
              agents) still render as deterministic cards so the roster shows
              every child project that did work. */}
          {unsummarizedAgents.length > 0 && (
            <>
              <MiniHeading className="mt-8">
                Other agent activity ({unsummarizedAgents.length})
              </MiniHeading>
              {unsummarizedAgents.map((agent, i) => (
                <DeterministicAgentCard key={asString(agent.name) ?? String(i)} agent={agent} />
              ))}
            </>
          )}
        </>
      ) : deterministicAgents.length > 0 ? (
        <>
          {/* Deterministic runs (run_llm=false) carry no LLM summaries, but
              page_data.agents still has the roster — show it rather than an
              empty state, flagged as activity metadata rather than analysis. */}
          <MiniHeading className="mt-8">
            Agent activity ({deterministicAgents.length}) — deterministic run, no LLM summaries
          </MiniHeading>
          {deterministicAgents.map((agent, i) => (
            <DeterministicAgentCard key={asString(agent.name) ?? String(i)} agent={agent} />
          ))}
        </>
      ) : (
        <>
          <MiniHeading className="mt-8">Agent summaries (0)</MiniHeading>
          <EmptyPanel label="No agent summaries for this run." />
        </>
      )}
    </Section>
  );
}

// ── 6. Tool activity ─────────────────────────────────────────────────────────

/** Map call.status to badge kind + label. */
function callStatusBadge(status: "ok" | "empty" | "error"): { kind: "pass" | "muted" | "fail"; label: string } | null {
  if (status === "ok") return null;
  if (status === "empty") return { kind: "muted", label: "EMPTY" };
  return { kind: "fail", label: "ERROR" };
}

export function ToolActivitySection({ projection }: { projection: RunReportProjection }) {
  const ta = projection.toolActivity;
  if (!ta.present || ta.groups.length === 0) return null;

  const { groups, unknownToolNames, unidentifiedNodeCount, unattributedRecordCount,
    ambiguousIdentityCount, allSurfacedHint, truncated, withheldInputFieldCount } = ta;

  return (
    <Section id="tool-activity" kicker="Graph traversal" title="Tool activity">
      {/* Data-quality counters — diagnostics, not the story: folded away */}
      {(unknownToolNames.length > 0 ||
        unidentifiedNodeCount > 0 ||
        unattributedRecordCount > 0 ||
        ambiguousIdentityCount > 0 ||
        allSurfacedHint ||
        truncated.groups > 0 ||
        truncated.callsPerAgent.length > 0 ||
        truncated.nodesPerCall > 0 ||
        withheldInputFieldCount > 0) && (
        <Fold summary="data-quality notes">
          <ul className="space-y-0.5 text-[12.5px] text-muted-foreground">
            {unknownToolNames.length > 0 && (
              <li>
                <StatusBadge kind="warn">unknown tool names</StatusBadge>{" "}
                {unknownToolNames.join(", ")}
              </li>
            )}
            {unidentifiedNodeCount > 0 && (
              <li>{unidentifiedNodeCount} node(s) with no identity</li>
            )}
            {unattributedRecordCount > 0 && (
              <li>{unattributedRecordCount} record(s) unattributed</li>
            )}
            {ambiguousIdentityCount > 0 && (
              <li>{ambiguousIdentityCount} ambiguous identity</li>
            )}
            {allSurfacedHint && (
              <li>All returned nodes were surfaced (no content/input retrieval observed)</li>
            )}
            {truncated.groups > 0 && (
              <li>{truncated.groups} agent group(s) truncated</li>
            )}
            {truncated.callsPerAgent.length > 0 && (
              <li>
                Calls capped per agent:{" "}
                {truncated.callsPerAgent.map((n, i) => `agent ${i + 1}: ${n} dropped`).join(", ")}
              </li>
            )}
            {truncated.nodesPerCall > 0 && (
              <li>{truncated.nodesPerCall} call(s) had nodes truncated</li>
            )}
            {withheldInputFieldCount > 0 && (
              <li>{withheldInputFieldCount} input field(s) withheld across all calls</li>
            )}
          </ul>
        </Fold>
      )}

      {groups.map((group) => {
        // Count calls per toolName
        const toolCounts = new Map<string, number>();
        for (const call of group.calls) {
          toolCounts.set(call.toolName, (toolCounts.get(call.toolName) ?? 0) + 1);
        }
        const sortedTools = [...toolCounts.entries()].sort((a, b) => b[1] - a[1]);
        const maxToolCount = sortedTools[0]?.[1] ?? 1;
        const emptyCalls = group.calls.filter((c) => c.status === "empty").length;
        const errorCalls = group.calls.filter((c) => c.status === "error").length;

        return (
          <div key={group.agentKey} className="mt-6">
            <div className="flex flex-wrap items-baseline gap-3 mb-2">
              <h3
                id={anchorId("tool", group.agentKey)}
                className="text-[15px] font-semibold scroll-mt-4"
              >
                {group.isUnattributed ? "(unattributed)" : group.agentName}
              </h3>
              <Chip label="calls" value={group.calls.length} />
              {emptyCalls > 0 && <Chip label="empty" value={emptyCalls} />}
              {errorCalls > 0 && <Chip label="errors" value={errorCalls} />}
            </div>

            {/* What this agent leaned on, at a glance */}
            <div className="space-y-1 mb-2 max-w-[440px]">
              {sortedTools.map(([toolName, count]) => (
                <div
                  key={toolName}
                  className="grid grid-cols-[minmax(0,170px)_1fr_auto] items-center gap-2"
                >
                  <span className="font-mono text-[11px] text-muted-foreground truncate">
                    {toolName}
                  </span>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary/60"
                      style={{ width: `${Math.max(4, (count / maxToolCount) * 100)}%` }}
                    />
                  </div>
                  <span className="font-mono text-[11px] text-muted-foreground/70 tabular-nums">
                    ×{count}
                  </span>
                </div>
              ))}
            </div>

            {/* The per-call record is drill-down, not the default view */}
            <Fold summary={`call-by-call detail (${group.calls.length})`}>
            <div className="space-y-2">
              {group.calls.map((call, ci) => {
                const foldLabel = call.rawToolName || call.toolName;
                const statusBadge = call.status === "ok" && call.nodes.length === 0 && !call.isUnknownTool
                  ? null
                  : call.status === "ok"
                    ? null
                    : callStatusBadge(call.status);

                return (
                  <Fold
                    key={ci}
                    summary={
                      <span className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-[12px]">{foldLabel}</span>
                        {statusBadge && (
                          <StatusBadge kind={statusBadge.kind}>{statusBadge.label}</StatusBadge>
                        )}
                        {call.isUnknownTool && (
                          <StatusBadge kind="warn">unknown tool</StatusBadge>
                        )}
                      </span>
                    }
                  >
                    {/* Input */}
                    {Object.keys(call.input).length > 0 && (
                      <>
                        <div className="text-[11px] font-mono text-muted-foreground/60 mb-1">input</div>
                        <KeyValues data={call.input as Record<string, unknown>} />
                      </>
                    )}
                    {call.withheldInputFieldCount > 0 && (
                      <div className="text-[11.5px] text-muted-foreground/70 mt-1">
                        {call.withheldInputFieldCount} input field(s) withheld
                      </div>
                    )}

                    {/* Returned nodes */}
                    {call.nodes.length > 0 ? (
                      <div className="mt-2 space-y-1">
                        <div className="text-[11px] font-mono text-muted-foreground/60 mb-1">nodes</div>
                        {call.nodes.map((node, ni) => (
                          <div key={ni} className="flex flex-wrap items-baseline gap-2 text-[12.5px]">
                            {node.nodeType && (
                              <span className="font-mono text-[10.5px] text-muted-foreground/70">
                                {node.nodeType}
                              </span>
                            )}
                            {node.name && (
                              <span className="text-muted-foreground">{node.name}</span>
                            )}
                            {node.identity && <CopyableId identity={node.identity} />}
                          </div>
                        ))}
                        {call.nodesTruncated && (
                          <div className="text-[11.5px] text-muted-foreground/60 mt-1">
                            {call.nodesDroppedCount} more node(s) not shown
                          </div>
                        )}
                      </div>
                    ) : call.status === "ok" ? (
                      <div className="mt-2 text-[12.5px] text-muted-foreground">
                        no nodes returned
                      </div>
                    ) : null}
                  </Fold>
                );
              })}
            </div>
            </Fold>
          </div>
        );
      })}
    </Section>
  );
}

// ── 7. Concept pulls ─────────────────────────────────────────────────────────

const TOP_CONCEPTS = 10;

/** One ranked row: how often a graph node was pulled, and by which stage. */
function ConceptRankRow({
  identity,
  total,
  maxTotal,
}: {
  identity: NodeIdentityRow;
  total: number;
  maxTotal: number;
}) {
  return (
    <div className="py-1" data-testid="run-report-concept-rank-row">
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="font-mono text-[11px] text-muted-foreground/70 tabular-nums w-9 shrink-0 text-right">
          ×{total}
        </span>
        {identity.nodeType && (
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground/60 shrink-0">
            {identity.nodeType}
          </span>
        )}
        <span className="text-[13px] truncate">{identity.name ?? identity.identity}</span>
        {identity.runStatus !== "retrieved" && (
          <StatusBadge kind="muted">{identity.runStatus}</StatusBadge>
        )}
      </div>
      <div className="grid grid-cols-[130px_minmax(0,1fr)] items-center gap-2 mt-1 ml-11">
        <div className="h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-primary/60"
            style={{ width: `${Math.max(4, (total / maxTotal) * 100)}%` }}
          />
        </div>
        <div className="flex flex-wrap gap-1">
          {identity.agents.map((agentEntry) => (
            <span
              key={agentEntry.agentKey}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground"
            >
              {agentEntry.agentName}
              {agentEntry.count > 1 && <span className="tabular-nums">×{agentEntry.count}</span>}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ConceptsSection({ projection }: { projection: RunReportProjection }) {
  const concepts = projection.concepts;
  const ta = projection.toolActivity;

  // `concepts.synthesis` absent means synthesis was not run — a common shape.
  const hasSynthesis = isRecord(concepts.synthesis);

  const synthesis = hasSynthesis ? (concepts.synthesis as Record<string, unknown>) : {};
  const narrative = asString(synthesis.overall_narrative);
  const conceptMatrix = Array.isArray(synthesis.concept_matrix)
    ? synthesis.concept_matrix.filter(isRecord)
    : [];

  const nodeIdentities = ta.present && ta.nodeIdentities.length > 0
    ? buildNodeIdentities(ta.groups)
    : [];

  return (
    <Section id="concepts" kicker="Concept usage" title="Concept pulls">
      {/* Ranked retrieval view: the story is which concepts the run leaned on
          and at what stage — not an exhaustive node dump. The full identity
          list (with copyable ids) is drill-down behind a fold. */}
      {nodeIdentities.length > 0 &&
        (() => {
          const ranked = nodeIdentities
            .map((identity) => ({
              identity,
              total: identity.agents.reduce((sum, a) => sum + a.count, 0) || 1,
            }))
            .sort((a, b) => b.total - a.total);
          // Only Concept-typed, named nodes rank as concepts - Document/
          // Organization/Excerpt identities are retrieval plumbing. The full
          // identity list (all types) stays in the fold below.
          const conceptRanked = ranked.filter(
            ({ identity }) => identity.nodeType === "Concept" && identity.name,
          );
          const top = conceptRanked.slice(0, TOP_CONCEPTS);
          const maxTotal = top[0]?.total || 1;
          return (
            <>
              <MiniHeading>
                Top retrieved concepts ({Math.min(TOP_CONCEPTS, conceptRanked.length)} of{" "}
                {conceptRanked.length} concept nodes · {ranked.length} graph nodes total)
              </MiniHeading>
              {conceptRanked.length === 0 && (
                <p className="text-[12.5px] text-muted-foreground italic mb-2">
                  No Concept-typed nodes were pulled in this run.
                </p>
              )}
              <div className="mb-3">
                {top.map(({ identity, total }) => (
                  <ConceptRankRow
                    key={identity.canonicalKey}
                    identity={identity}
                    total={total}
                    maxTotal={maxTotal}
                  />
                ))}
              </div>
              <div className="mb-6">
                <Fold summary={`all graph nodes (${ranked.length})`}>
                  <div className="space-y-2">
                    {ranked.map(({ identity, total }) => (
                      <div
                        key={identity.canonicalKey}
                        className="flex flex-wrap items-baseline gap-2 text-[12.5px] rounded px-2 py-1.5 bg-muted/20"
                      >
                        <span className="font-mono text-[10.5px] text-muted-foreground/70 tabular-nums">
                          ×{total}
                        </span>
                        {identity.nodeType && (
                          <span className="font-mono text-[10.5px] text-muted-foreground/70">
                            {identity.nodeType}
                          </span>
                        )}
                        {identity.name && (
                          <span className="text-muted-foreground">{identity.name}</span>
                        )}
                        <CopyableId identity={identity.identity} />
                        <StatusBadge kind={identity.runStatus === "retrieved" ? "pass" : "muted"}>
                          {identity.runStatus}
                        </StatusBadge>
                        {identity.runBasis && (
                          <span className="text-[10.5px] text-muted-foreground/60">
                            via {identity.runBasis}
                          </span>
                        )}
                        {identity.agents.map((agentEntry) => (
                          <span
                            key={agentEntry.agentKey}
                            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10.5px] text-muted-foreground"
                          >
                            {agentEntry.agentName}
                            {agentEntry.count > 1 && (
                              <span className="tabular-nums">×{agentEntry.count}</span>
                            )}
                          </span>
                        ))}
                        {identity.hasOffScreenEvidence && (
                          <span className="text-[10.5px] text-muted-foreground/60">
                            (additional evidence off-screen)
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                </Fold>
              </div>
            </>
          );
        })()}

      {/* Synthesis narrative */}
      {hasSynthesis ? (
        <>
          {narrative ? (
            <Panel>
              {/* Escaped React text. This string is known to contain ```mermaid
                  fences and raw HTML; both must render as literal characters. */}
              <p
                className="text-[13.5px] whitespace-pre-wrap text-muted-foreground"
                data-testid="run-report-concept-narrative"
              >
                {narrative}
              </p>
            </Panel>
          ) : (
            <EmptyPanel label="No synthesis narrative for this run." />
          )}

          {conceptMatrix.length > 0 && (
            <>
              <MiniHeading>Concept matrix</MiniHeading>
              <div className="space-y-2">
                {conceptMatrix.map((entry, i) => (
                  <div key={i} className="flex items-start gap-3 text-[13px]">
                    <span className="font-mono text-[11px] text-muted-foreground/70 min-w-[80px]">
                      {asString(entry.concept) ?? `concept-${i}`}
                    </span>
                    <span className="text-muted-foreground flex-1">
                      {asString(entry.note)}
                    </span>
                    {asString(entry.verdict) && (
                      <StatusBadge kind={asString(entry.verdict) === "addressed" ? "pass" : "fail"}>
                        {asString(entry.verdict)}
                      </StatusBadge>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        <EmptyPanel label="Concept synthesis was not run for this benchmark." />
      )}
    </Section>
  );
}

// ── 7 + 8. Sources & artifacts ───────────────────────────────────────────────

export function SourcesSection({
  projection,
  onOpenDoc,
}: {
  projection: RunReportProjection;
  onOpenDoc: (docId: string, tokens: string[]) => void;
}) {
  const { sourceDocs, workfiles } = projection;
  const documents = projection.pageData.documents;

  return (
    <Section id="sources" kicker="Context" title="Sources &amp; artifacts">
      <MiniHeading>Source documents ({sourceDocs.length})</MiniHeading>
      {sourceDocs.length === 0 ? (
        <EmptyPanel label="No source documents for this run." />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
          {sourceDocs.map((doc) => (
            <button
              key={doc.id}
              type="button"
              onClick={() => onOpenDoc(doc.id, [])}
              className="text-left rounded-lg border border-border bg-muted/20 p-3.5 hover:border-primary/50 transition-colors"
              data-testid="run-report-doc-link"
            >
              <div className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground/70 mb-1.5">
                Document
              </div>
              <div className="text-[13px] flex items-start gap-2">
                <FileText className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                <span className="break-words">{doc.title}</span>
              </div>
            </button>
          ))}
        </div>
      )}

      {documents.length > 0 && (
        <>
          <MiniHeading>Run documents ({documents.length})</MiniHeading>
          <Panel>
            <ul className="space-y-1">
              {documents.map((doc, i) => (
                <li key={i} className="flex items-center gap-3 text-[13px]">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="flex-1 text-muted-foreground break-words">{doc.name}</span>
                  {doc.type && (
                    <span className="font-mono text-[10px] text-muted-foreground/60">{doc.type}</span>
                  )}
                  {doc.sizeBytes !== undefined && (
                    <span className="font-mono text-[10px] text-muted-foreground/60">
                      {(doc.sizeBytes / 1024).toFixed(1)} KB
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Panel>
        </>
      )}

      <MiniHeading>Workfiles ({workfiles.length})</MiniHeading>
      {workfiles.length === 0 ? (
        <EmptyPanel label="No workfiles for this run." />
      ) : (
        workfiles.map((file, i) => (
          <Fold key={i} summary={file.name ?? `Workfile ${i + 1}`} monospace>
            {/* Plain text, rendered escaped. Running it through the HTML
                sanitizer would swallow angle-bracketed legal prose. */}
            <pre className="text-[11.5px] whitespace-pre-wrap break-words font-mono text-muted-foreground">
              {file.text}
            </pre>
          </Fold>
        ))
      )}
    </Section>
  );
}

// ── 9. System health ─────────────────────────────────────────────────────────

export function HealthSection({ projection }: { projection: RunReportProjection }) {
  const { security, healthNotes, logStats, outputs } = projection.pageData;
  const isEmpty =
    security.length === 0 &&
    healthNotes.length === 0 &&
    Object.keys(logStats).length === 0 &&
    Object.keys(outputs).length === 0;

  return (
    <Section id="system" kicker="Meta" title="System health">
      {isEmpty ? (
        <EmptyPanel label="No health or security data for this run." />
      ) : (
        <>
          {healthNotes.length > 0 && (
            <Panel>
              <ul className="space-y-1.5">
                {/* healthNotes are plain strings in the real contract */}
                {healthNotes.map((note, i) => (
                  <li key={i} className="flex items-start gap-2 text-[13px]">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground/50" />
                    <span className="text-muted-foreground">{note}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
            {security.length > 0 && (
              <Panel>
                <MiniHeading>Security findings ({security.length})</MiniHeading>
                <ul className="space-y-2">
                  {security.map((finding, i) => (
                    <li key={i} className="flex items-start gap-2 text-[13px]">
                      <StatusBadge kind={finding.severity === "high" ? "fail" : "warn"}>
                        {finding.severity ?? "info"}
                      </StatusBadge>
                      <div className="text-muted-foreground flex-1">
                        {asString(finding.detail) ??
                          asString(finding.where) ??
                          asString(finding.kind) ?? (
                            <pre className="text-[11px] font-mono whitespace-pre-wrap break-all bg-muted/40 rounded p-1">
                              {(() => {
                                try {
                                  return JSON.stringify(finding, null, 2);
                                } catch {
                                  return "[unserializable]";
                                }
                              })()}
                            </pre>
                          )}
                      </div>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
            {Object.keys(logStats).length > 0 && (
              <Panel>
                <MiniHeading>Log stats</MiniHeading>
                <KeyValues data={logStats} />
              </Panel>
            )}
            {Object.keys(outputs).length > 0 && (
              <Panel className="lg:col-span-2">
                <MiniHeading>Outputs</MiniHeading>
                <KeyValues data={outputs} />
              </Panel>
            )}
          </div>
        </>
      )}
    </Section>
  );
}

export { formatDuration };
