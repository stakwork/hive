"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  ChevronRight,
  X,
  Loader2,
  Eye,
  EyeOff,
  Play,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  DEFAULT_PATTERN_DETECTION_PROMPT,
  DEFAULT_SINGLE_SESSION_PROMPT,
} from "@/lib/scorer/prompts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Workspace {
  id: string;
  name: string;
  slug: string;
  scorerEnabled: boolean;
  scorerPatternPrompt: string | null;
  scorerSinglePrompt: string | null;
}

interface AggregateMetrics {
  featureCount: number;
  avgMessagesPerTask: number;
  ciPassRate: number;
  avgPlanPrecision: number;
  avgPlanRecall: number;
  prMergeRate: number;
}

interface TaskMetrics {
  taskId: string;
  taskTitle: string;
  messageCount: number;
  correctionCount: number;
  ciPassedFirstAttempt: boolean | null;
  prStatus: string | null;
  prUrl: string | null;
  durationMinutes: number | null;
  filesTouched: Array<{ file: string; action: string }>;
}

interface FeatureMetrics {
  featureId: string;
  featureTitle: string;
  featureStatus: string;
  taskCount: number;
  totalMessages: number;
  totalCorrections: number;
  planPrecision: number | null;
  planRecall: number | null;
  filesPlanned: string[];
  filesTouched: string[];
  tasks: TaskMetrics[];
}

interface Insight {
  id: string;
  mode: string;
  severity: string;
  pattern: string;
  description: string;
  featureIds: string[];
  suggestion: string;
  dismissedAt: string | null;
  createdAt: string;
  workspace: { name: string; slug: string };
}

interface DigestData {
  content: string;
  metadata: unknown;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ScorerDashboard({
  workspaces,
}: {
  workspaces: Workspace[];
}) {
  const [selectedWs, setSelectedWs] = useState<Workspace | null>(
    workspaces[0] || null
  );
  const [aggregate, setAggregate] = useState<AggregateMetrics | null>(null);
  const [features, setFeatures] = useState<FeatureMetrics[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [expandedFeature, setExpandedFeature] = useState<string | null>(null);
  const [digests, setDigests] = useState<Record<string, DigestData>>({});
  const [loading, setLoading] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [analyzingFeature, setAnalyzingFeature] = useState<string | null>(null);
  const [editingPrompt, setEditingPrompt] = useState<
    "pattern" | "single" | null
  >(null);
  const [promptDraft, setPromptDraft] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalFeatures, setTotalFeatures] = useState(0);

  // Fetch metrics when workspace or page changes
  const fetchMetrics = useCallback(async () => {
    if (!selectedWs) return;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/admin/scorer/metrics?workspaceId=${selectedWs.id}&page=${page}`
      );
      if (!res.ok) throw new Error("Failed to fetch metrics");
      const data = await res.json();
      setAggregate(data.aggregate);
      setFeatures(data.features);
      setTotalPages(data.pagination?.totalPages || 1);
      setTotalFeatures(data.pagination?.totalFeatures || data.features.length);
    } catch (err) {
      toast.error("Failed to load metrics");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [selectedWs, page]);

  const fetchInsights = useCallback(async () => {
    if (!selectedWs) return;
    try {
      const url = `/api/admin/scorer/insights?workspaceId=${selectedWs.id}${showDismissed ? "&dismissed=true" : ""}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch insights");
      const data = await res.json();
      setInsights(data.insights);
    } catch (err) {
      console.error(err);
    }
  }, [selectedWs, showDismissed]);

  useEffect(() => {
    fetchMetrics();
    fetchInsights();
  }, [fetchMetrics, fetchInsights]);

  // Fetch digest for expanded feature
  useEffect(() => {
    if (!expandedFeature || digests[expandedFeature]) return;
    fetch(`/api/admin/scorer/digests?workspaceId=${selectedWs?.id}`)
      .then((r) => r.json())
      .then((data) => {
        const map: Record<string, DigestData> = {};
        for (const d of data.digests) {
          map[d.featureId] = {
            content: d.content,
            metadata: d.metadata,
            updatedAt: d.updatedAt,
          };
        }
        setDigests((prev) => ({ ...prev, ...map }));
      })
      .catch(() => {});
  }, [expandedFeature, selectedWs, digests]);

  // Actions
  const dismissInsight = async (id: string) => {
    try {
      await fetch(`/api/admin/scorer/insights/${id}/dismiss`, {
        method: "PATCH",
      });
      setInsights((prev) => prev.filter((i) => i.id !== id));
      toast.success("Insight dismissed");
    } catch {
      toast.error("Failed to dismiss");
    }
  };

  const analyzeFeature = async (featureId: string) => {
    setAnalyzingFeature(featureId);
    try {
      const res = await fetch(`/api/admin/scorer/analyze/${featureId}`, {
        method: "POST",
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      toast.success(`Analysis complete: ${data.insightCount} insight(s) found`);
      fetchInsights();
    } catch (err) {
      toast.error("Analysis failed");
      console.error(err);
    } finally {
      setAnalyzingFeature(null);
    }
  };

  const toggleScorer = async () => {
    if (!selectedWs) return;
    try {
      const res = await fetch(
        `/api/admin/scorer/workspaces/${selectedWs.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scorerEnabled: !selectedWs.scorerEnabled,
          }),
        }
      );
      if (!res.ok) throw new Error();
      setSelectedWs({ ...selectedWs, scorerEnabled: !selectedWs.scorerEnabled });
      toast.success(
        selectedWs.scorerEnabled ? "Scorer disabled" : "Scorer enabled"
      );
    } catch {
      toast.error("Failed to update");
    }
  };

  const savePrompt = async () => {
    if (!selectedWs || !editingPrompt) return;
    try {
      const body =
        editingPrompt === "pattern"
          ? { scorerPatternPrompt: promptDraft || null }
          : { scorerSinglePrompt: promptDraft || null };
      const res = await fetch(
        `/api/admin/scorer/workspaces/${selectedWs.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) throw new Error();
      const updated = await res.json();
      setSelectedWs({
        ...selectedWs,
        scorerPatternPrompt: updated.scorerPatternPrompt,
        scorerSinglePrompt: updated.scorerSinglePrompt,
      });
      setEditingPrompt(null);
      toast.success("Prompt updated");
    } catch {
      toast.error("Failed to save prompt");
    }
  };

  // Helper functions
  const metricColor = (
    val: number,
    thresholds: { good: number; warn: number },
    inverse?: boolean
  ) => {
    if (inverse) {
      if (val <= thresholds.good) return "text-green-400";
      if (val <= thresholds.warn) return "text-orange-400";
      return "text-red-400";
    }
    if (val >= thresholds.good) return "text-green-400";
    if (val >= thresholds.warn) return "text-orange-400";
    return "text-red-400";
  };

  const severityColor = (sev: string) => {
    switch (sev) {
      case "HIGH":
        return "bg-red-500/10 text-red-400 border-l-red-500";
      case "MEDIUM":
        return "bg-orange-500/10 text-orange-400 border-l-orange-500";
      case "LOW":
        return "bg-blue-500/10 text-blue-400 border-l-blue-500";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const sevBadgeColor = (sev: string) => {
    switch (sev) {
      case "HIGH":
        return "bg-red-500/10 text-red-400";
      case "MEDIUM":
        return "bg-orange-500/10 text-orange-400";
      case "LOW":
        return "bg-blue-500/10 text-blue-400";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const formatDuration = (min: number | null) => {
    if (min === null) return "—";
    if (min < 60) return `${min}m`;
    return `${Math.floor(min / 60)}h${min % 60 > 0 ? `${min % 60}m` : ""}`;
  };

  const insightFeatureIds = new Set(insights.flatMap((i) => i.featureIds));

  if (!selectedWs) {
    return (
      <div className="text-muted-foreground">No workspaces found.</div>
    );
  }

  return (
    <div className="flex gap-6">
      {/* Main content */}
      <div className="flex-1 min-w-0">
        {/* Workspace tabs */}
        <div className="flex gap-px mb-5 overflow-x-auto pb-1 scrollbar-thin">
          {workspaces.map((ws) => (
            <button
              key={ws.id}
              onClick={() => {
                setSelectedWs(ws);
                setExpandedFeature(null);
                setPage(1);
              }}
              className={`px-3 py-1.5 text-xs font-mono border transition-colors whitespace-nowrap shrink-0 ${
                ws.id === selectedWs.id
                  ? "bg-accent/10 text-foreground border-border"
                  : "bg-card text-muted-foreground border-border hover:text-foreground"
              } ${ws.id === workspaces[0]?.id ? "rounded-l" : ""} ${
                ws.id === workspaces[workspaces.length - 1]?.id
                  ? "rounded-r"
                  : ""
              }`}
            >
              {ws.slug}
            </button>
          ))}
        </div>

        {/* Aggregate metrics bar */}
        {loading ? (
          <div className="flex items-center justify-center h-16 border rounded-md bg-card mb-5">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : aggregate ? (
          <div className="flex gap-6 p-3 px-4 border rounded-md bg-card mb-5">
            <MetricItem
              label="Features"
              value={aggregate.featureCount}
              className="text-muted-foreground"
            />
            <MetricItem
              label="Avg msgs/task"
              value={aggregate.avgMessagesPerTask}
              className={metricColor(
                aggregate.avgMessagesPerTask,
                { good: 5, warn: 8 },
                true
              )}
            />
            <MetricItem
              label="CI pass"
              value={`${aggregate.ciPassRate}%`}
              className={metricColor(aggregate.ciPassRate, {
                good: 80,
                warn: 60,
              })}
            />
            <MetricItem
              label="Plan precision"
              value={`${aggregate.avgPlanPrecision}%`}
              className={metricColor(aggregate.avgPlanPrecision, {
                good: 70,
                warn: 50,
              })}
            />
            <MetricItem
              label="Plan recall"
              value={`${aggregate.avgPlanRecall}%`}
              className={metricColor(aggregate.avgPlanRecall, {
                good: 70,
                warn: 50,
              })}
            />
            <MetricItem
              label="PR merge"
              value={`${aggregate.prMergeRate}%`}
              className={metricColor(aggregate.prMergeRate, {
                good: 80,
                warn: 60,
              })}
            />
          </div>
        ) : null}

        {/* Insights feed */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Insights
            </h3>
            {insights.filter((i) => !i.dismissedAt).length > 0 && (
              <span className="text-[10px] font-bold bg-red-500/10 text-red-400 px-2 py-0.5 rounded-full">
                {insights.filter((i) => !i.dismissedAt).length}
              </span>
            )}
            <button
              onClick={() => setShowDismissed(!showDismissed)}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              {showDismissed ? (
                <EyeOff className="w-3 h-3" />
              ) : (
                <Eye className="w-3 h-3" />
              )}
              {showDismissed ? "Hide dismissed" : "Show dismissed"}
            </button>
          </div>

          {insights.length === 0 ? (
            <div className="text-xs text-muted-foreground border rounded-md p-4 bg-card">
              No insights yet. Run analysis on a feature or wait for the
              automatic pipeline.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {insights.map((insight) => (
                <div
                  key={insight.id}
                  className={`border rounded-md p-3 pl-4 border-l-[3px] bg-card relative ${
                    insight.severity === "HIGH"
                      ? "border-l-red-500"
                      : insight.severity === "MEDIUM"
                        ? "border-l-orange-500"
                        : "border-l-blue-500"
                  } ${insight.dismissedAt ? "opacity-50" : ""}`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${sevBadgeColor(insight.severity)}`}
                      >
                        {insight.severity}
                      </span>
                      <span className="text-xs font-semibold">
                        {insight.pattern}
                      </span>
                    </div>
                    {!insight.dismissedAt && (
                      <button
                        onClick={() => dismissInsight(insight.id)}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed mb-2">
                    {insight.description}
                  </p>
                  <div className="text-[11px] bg-purple-500/5 text-purple-400 rounded p-2 leading-relaxed mb-2">
                    {insight.suggestion}
                  </div>
                  <div className="flex gap-3 text-[10px] text-muted-foreground">
                    <span className="capitalize">{insight.mode}</span>
                    <span>{timeAgo(insight.createdAt)}</span>
                    <button
                      onClick={() => {
                        const fId = insight.featureIds[0];
                        if (fId) setExpandedFeature(fId);
                      }}
                      className="text-purple-400 hover:underline"
                    >
                      {insight.featureIds.length} feature
                      {insight.featureIds.length !== 1 ? "s" : ""}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Features table */}
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
            Features
          </h3>
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-card">
                  <th className="text-left p-2 px-3 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Feature
                  </th>
                  <th className="text-left p-2 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Status
                  </th>
                  <th className="text-left p-2 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Tasks
                  </th>
                  <th className="text-left p-2 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Msgs
                  </th>
                  <th className="text-left p-2 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Corrections
                  </th>
                  <th className="text-left p-2 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Precision
                  </th>
                  <th className="text-left p-2 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Recall
                  </th>
                </tr>
              </thead>
              <tbody>
                {features.map((f) => (
                  <FeatureRow
                    key={f.featureId}
                    feature={f}
                    isExpanded={expandedFeature === f.featureId}
                    hasInsight={insightFeatureIds.has(f.featureId)}
                    digest={digests[f.featureId] || null}
                    onToggle={() =>
                      setExpandedFeature(
                        expandedFeature === f.featureId
                          ? null
                          : f.featureId
                      )
                    }
                    onAnalyze={() => analyzeFeature(f.featureId)}
                    analyzing={analyzingFeature === f.featureId}
                    formatDuration={formatDuration}
                    metricColor={metricColor}
                  />
                ))}
                {features.length === 0 && !loading && (
                  <tr>
                    <td
                      colSpan={7}
                      className="text-center p-8 text-muted-foreground"
                    >
                      No features found for this workspace.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-3 text-xs text-muted-foreground">
              <span>
                {totalFeatures} feature{totalFeatures !== 1 ? "s" : ""} total
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-7 px-2"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Prev
                </Button>
                <span>
                  {page} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs h-7 px-2"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sidebar */}
      <div className="w-56 shrink-0 border-l pl-5 text-xs">
        <div className="mb-6">
          <h4 className="font-semibold text-sm mb-3">Workspace</h4>
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground">Scorer enabled</span>
            <button
              onClick={toggleScorer}
              className={`w-7 h-4 rounded-full relative transition-colors ${
                selectedWs.scorerEnabled ? "bg-purple-500" : "bg-border"
              }`}
            >
              <span
                className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${
                  selectedWs.scorerEnabled ? "left-3.5" : "left-0.5"
                }`}
              />
            </button>
          </div>
        </div>

        <div>
          <h4 className="font-semibold text-sm mb-3">Active Prompts</h4>

          <PromptBlock
            label="Pattern detection"
            value={selectedWs.scorerPatternPrompt}
            defaultValue={DEFAULT_PATTERN_DETECTION_PROMPT}
            isEditing={editingPrompt === "pattern"}
            onEdit={() => {
              setEditingPrompt("pattern");
              setPromptDraft(
                selectedWs.scorerPatternPrompt || DEFAULT_PATTERN_DETECTION_PROMPT
              );
            }}
            onSave={savePrompt}
            onCancel={() => setEditingPrompt(null)}
            draft={promptDraft}
            onDraftChange={setPromptDraft}
          />

          <PromptBlock
            label="Single session"
            value={selectedWs.scorerSinglePrompt}
            defaultValue={DEFAULT_SINGLE_SESSION_PROMPT}
            isEditing={editingPrompt === "single"}
            onEdit={() => {
              setEditingPrompt("single");
              setPromptDraft(
                selectedWs.scorerSinglePrompt || DEFAULT_SINGLE_SESSION_PROMPT
              );
            }}
            onSave={savePrompt}
            onCancel={() => setEditingPrompt(null)}
            draft={promptDraft}
            onDraftChange={setPromptDraft}
          />

          <Button
            variant="outline"
            size="sm"
            className="w-full mt-3 text-xs"
            onClick={async () => {
              try {
                await fetch("/api/admin/scorer/cron", { method: "POST" });
                toast.success("Pattern detection started");
                setTimeout(fetchInsights, 5000);
              } catch {
                toast.error("Failed to start pattern detection");
              }
            }}
          >
            <Zap className="w-3 h-3 mr-1" />
            Run Pattern Detection
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MetricItem({
  label,
  value,
  className,
}: {
  label: string;
  value: string | number;
  className: string;
}) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-0.5">
        {label}
      </div>
      <div className={`text-base font-bold ${className}`}>{value}</div>
    </div>
  );
}

function FeatureRow({
  feature: f,
  isExpanded,
  hasInsight,
  digest,
  onToggle,
  onAnalyze,
  analyzing,
  formatDuration,
  metricColor,
}: {
  feature: FeatureMetrics;
  isExpanded: boolean;
  hasInsight: boolean;
  digest: DigestData | null;
  onToggle: () => void;
  onAnalyze: () => void;
  analyzing: boolean;
  formatDuration: (min: number | null) => string;
  metricColor: (
    val: number,
    thresholds: { good: number; warn: number },
    inverse?: boolean
  ) => string;
}) {
  const statusColor =
    f.featureStatus === "COMPLETED"
      ? "bg-green-500/10 text-green-400"
      : f.featureStatus === "IN_PROGRESS"
        ? "bg-blue-500/10 text-blue-400"
        : "bg-muted text-muted-foreground";

  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b hover:bg-card/50 cursor-pointer transition-colors"
      >
        <td className="p-2 px-3 font-medium">
          <div className="flex items-center gap-1.5">
            {isExpanded ? (
              <ChevronDown className="w-3 h-3 text-muted-foreground" />
            ) : (
              <ChevronRight className="w-3 h-3 text-muted-foreground" />
            )}
            {f.featureTitle}
            {hasInsight && (
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-500 ml-1" />
            )}
          </div>
        </td>
        <td className="p-2">
          <span
            className={`text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded ${statusColor}`}
          >
            {f.featureStatus === "COMPLETED"
              ? "Done"
              : f.featureStatus === "IN_PROGRESS"
                ? "WIP"
                : f.featureStatus}
          </span>
        </td>
        <td className="p-2 text-muted-foreground">{f.taskCount}</td>
        <td
          className={`p-2 ${metricColor(f.totalMessages, { good: 5, warn: 10 }, true)}`}
        >
          {f.totalMessages}
        </td>
        <td
          className={`p-2 ${metricColor(f.totalCorrections, { good: 1, warn: 3 }, true)}`}
        >
          {f.totalCorrections}
        </td>
        <td
          className={`p-2 ${f.planPrecision !== null ? metricColor(f.planPrecision, { good: 70, warn: 50 }) : "text-muted-foreground"}`}
        >
          {f.planPrecision !== null ? `${f.planPrecision}%` : "—"}
        </td>
        <td
          className={`p-2 ${f.planRecall !== null ? metricColor(f.planRecall, { good: 70, warn: 50 }) : "text-muted-foreground"}`}
        >
          {f.planRecall !== null ? `${f.planRecall}%` : "—"}
        </td>
      </tr>
      {isExpanded && (
        <tr>
          <td colSpan={7} className="p-0">
            <div className="border-t bg-background">
              {/* Digest */}
              <div className="p-4 border-b">
                <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Digest
                </div>
                {digest ? (
                  <div className="text-[11px] text-muted-foreground leading-relaxed p-3 bg-card rounded border-l-2 border-l-purple-500 whitespace-pre-wrap font-mono">
                    {digest.content}
                  </div>
                ) : (
                  <div className="text-[11px] text-muted-foreground italic">
                    No digest generated yet.
                  </div>
                )}
              </div>

              {/* Task cards */}
              <div className="p-4 border-b">
                <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Tasks
                </div>
                <div className="flex flex-col gap-2">
                  {f.tasks.map((task) => (
                    <TaskCard
                      key={task.taskId}
                      task={task}
                      filesPlanned={f.filesPlanned}
                      formatDuration={formatDuration}
                    />
                  ))}
                </div>
              </div>

              {/* Analyze button */}
              <div className="p-3 flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    onAnalyze();
                  }}
                  disabled={analyzing}
                >
                  {analyzing ? (
                    <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                  ) : (
                    <Play className="w-3 h-3 mr-1" />
                  )}
                  Analyze
                </Button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function TaskCard({
  task,
  filesPlanned,
  formatDuration,
}: {
  task: TaskMetrics;
  filesPlanned: string[];
  formatDuration: (min: number | null) => string;
}) {
  const plannedSet = new Set(filesPlanned);
  const statusColor =
    task.prStatus === "DONE"
      ? "bg-green-500/10 text-green-400"
      : "bg-blue-500/10 text-blue-400";

  return (
    <div className="border rounded-md p-3 bg-card">
      <div className="flex items-center justify-between mb-1.5">
        <span className="font-semibold text-[11px]">{task.taskTitle}</span>
        <span
          className={`text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded ${statusColor}`}
        >
          {task.prStatus === "DONE" ? "Done" : task.prStatus || "—"}
        </span>
      </div>

      <div className="flex gap-3 text-[10px] text-muted-foreground mb-2">
        <span>{task.messageCount} msgs</span>
        <span
          className={
            task.correctionCount > 1 ? "text-red-400" : task.correctionCount > 0 ? "text-orange-400" : ""
          }
        >
          {task.correctionCount} correction{task.correctionCount !== 1 ? "s" : ""}
        </span>
        <span>{formatDuration(task.durationMinutes)}</span>
      </div>

      {/* File chips */}
      {task.filesTouched.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {task.filesTouched.map((f) => {
            const isPlanned = plannedSet.has(f.file);
            return (
              <span
                key={f.file}
                className={`text-[9px] px-1.5 py-0.5 rounded border ${
                  isPlanned
                    ? "border-green-500/30 text-green-400"
                    : "border-orange-500/30 text-orange-400"
                }`}
              >
                {f.file}
              </span>
            );
          })}
        </div>
      )}

      {/* PR */}
      {task.prUrl && (
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span>PR:</span>
          <a
            href={task.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-purple-400 hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {task.prUrl.replace(/.*\/pull\//, "#")}
          </a>
          <span
            className={`text-[9px] font-semibold uppercase px-1.5 py-0.5 rounded ${
              task.prStatus === "DONE"
                ? "bg-green-500/10 text-green-400"
                : "bg-muted text-muted-foreground"
            }`}
          >
            {task.prStatus === "DONE" ? "merged" : task.prStatus || "open"}
          </span>
          {task.ciPassedFirstAttempt !== null && (
            <span>
              CI: {task.ciPassedFirstAttempt ? "passed 1st try" : "failed 1st try"}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function PromptBlock({
  label,
  value,
  defaultValue,
  isEditing,
  onEdit,
  onSave,
  onCancel,
  draft,
  onDraftChange,
}: {
  label: string;
  value: string | null;
  defaultValue: string;
  isEditing: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  draft: string;
  onDraftChange: (v: string) => void;
}) {
  const displayText = value || defaultValue;
  const isDefault = !value;

  return (
    <div className="border rounded p-2.5 bg-background mb-2">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
          {isDefault && (
            <span className="text-[8px] text-muted-foreground/50">
              (default)
            </span>
          )}
        </div>
        {!isEditing && (
          <button
            onClick={onEdit}
            className="text-[9px] text-purple-400 hover:underline"
          >
            edit
          </button>
        )}
      </div>
      {isEditing ? (
        <div>
          <textarea
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            className="w-full h-48 text-[10px] bg-card border rounded p-2 text-foreground resize-y font-mono"
          />
          <div className="flex gap-1 mt-1">
            <Button size="sm" variant="outline" className="text-[9px] h-6" onClick={onSave}>
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-[9px] h-6"
              onClick={onCancel}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <pre className="text-[9px] text-muted-foreground leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto font-mono">
          {displayText}
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Utils
// ---------------------------------------------------------------------------

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
