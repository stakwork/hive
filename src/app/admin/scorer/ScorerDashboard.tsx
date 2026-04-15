"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
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
  RefreshCw,
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
  taskDescription: string | null;
  messageCount: number;
  correctionCount: number;
  correctionMessages: string[];
  ciPassedFirstAttempt: boolean | null;
  prStatus: string | null;
  prUrl: string | null;
  durationMinutes: number | null;
  filesTouched: Array<{ file: string; action: string }>;
  agentRuns: Array<{ agent: string; count: number }>;
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

interface AgentLogStatsJson {
  totalMessages: number;
  estimatedTokens: number;
  durationSeconds: number | null;
  totalToolCalls: number;
  toolFrequency: Record<string, number>;
  bashFrequency: Record<string, number>;
  developerShellFrequency: Record<string, number>;
  conversationPreview: Array<{ role: string; text: string }>;
}

interface AgentLogEntry {
  id: string;
  agent: string;
  agentType: string;
  taskId: string | null;
  featureId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  stats: AgentLogStatsJson | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ScorerDashboard({
  workspaces,
}: {
  workspaces: Workspace[];
}) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const initialWs =
    workspaces.find((ws) => ws.slug === searchParams.get("w")) ||
    workspaces[0] ||
    null;

  const [selectedWs, setSelectedWs] = useState<Workspace | null>(initialWs);
  const [aggregate, setAggregate] = useState<AggregateMetrics | null>(null);
  const [features, setFeatures] = useState<FeatureMetrics[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [expandedFeature, setExpandedFeature] = useState<string | null>(null);
  const [digests, setDigests] = useState<Record<string, DigestData>>({});
  const [agentStats, setAgentStats] = useState<Record<string, AgentLogEntry[]>>({});
  const [agentStatsLoading, setAgentStatsLoading] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showDismissed, setShowDismissed] = useState(false);
  const [expandedInsight, setExpandedInsight] = useState<string | null>(null);
  const [insightsVisible, setInsightsVisible] = useState(10);
  const [analyzingFeature, setAnalyzingFeature] = useState<string | null>(null);
  const [editingPrompt, setEditingPrompt] = useState<
    "pattern" | "single" | null
  >(null);
  const [promptDraft, setPromptDraft] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalFeatures, setTotalFeatures] = useState(0);

  // Fetch metrics when workspace or page changes
  const fetchMetrics = useCallback(async (refresh?: boolean) => {
    if (!selectedWs) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({
        workspaceId: selectedWs.id,
        page: String(page),
      });
      if (refresh) params.set("refresh", "true");
      const res = await fetch(`/api/admin/scorer/metrics?${params}`);
      if (!res.ok) throw new Error("Failed to fetch metrics");
      const data = await res.json();
      setAggregate(data.aggregate);
      setFeatures(data.features);
      setTotalPages(data.pagination?.totalPages || 1);
      setTotalFeatures(data.pagination?.totalFeatures || data.features.length);
      if (refresh) toast.success("Metrics refreshed");
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

  // Fetch agent stats for expanded feature
  useEffect(() => {
    if (!expandedFeature || agentStats[expandedFeature]) return;
    setAgentStatsLoading(expandedFeature);
    fetch(`/api/admin/scorer/agent-stats?featureId=${expandedFeature}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.logs) {
          setAgentStats((prev) => ({ ...prev, [expandedFeature]: data.logs }));
        }
      })
      .catch(() => {})
      .finally(() => setAgentStatsLoading(null));
  }, [expandedFeature, agentStats]);

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
      // Refresh digest so the expanded feature shows it immediately
      setDigests((prev) => {
        const next = { ...prev };
        delete next[featureId];
        return next;
      });
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
                setExpandedInsight(null);
                setInsightsVisible(10);
                setPage(1);
                router.replace(`?w=${ws.slug}`, { scroll: false });
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
          <div className="flex items-center gap-6 p-3 px-4 border rounded-md bg-card mb-5">
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
            <button
              onClick={() => fetchMetrics(true)}
              disabled={loading}
              className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
              title="Refresh metrics (skip cache)"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
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
              {insights.slice(0, insightsVisible).map((insight) => {
                const isOpen = expandedInsight === insight.id;
                return (
                  <div
                    key={insight.id}
                    className={`border rounded-md bg-card border-l-[3px] ${
                      insight.severity === "HIGH"
                        ? "border-l-red-500"
                        : insight.severity === "MEDIUM"
                          ? "border-l-orange-500"
                          : "border-l-blue-500"
                    } ${insight.dismissedAt ? "opacity-50" : ""}`}
                  >
                    {/* Collapsed summary row — always visible */}
                    <button
                      onClick={() =>
                        setExpandedInsight(isOpen ? null : insight.id)
                      }
                      className="w-full flex items-center gap-2 p-3 pl-4 text-left"
                    >
                      {isOpen ? (
                        <ChevronDown className="w-3 h-3 shrink-0 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="w-3 h-3 shrink-0 text-muted-foreground" />
                      )}
                      <span
                        className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${sevBadgeColor(insight.severity)}`}
                      >
                        {insight.severity}
                      </span>
                      <span className="text-xs font-semibold truncate">
                        {insight.pattern}
                      </span>
                      <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
                        {timeAgo(insight.createdAt)}
                      </span>
                      {!insight.dismissedAt && (
                        <span
                          role="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            dismissInsight(insight.id);
                          }}
                          className="text-muted-foreground hover:text-foreground shrink-0"
                        >
                          <X className="w-3.5 h-3.5" />
                        </span>
                      )}
                    </button>

                    {/* Expanded details */}
                    {isOpen && (
                      <div className="px-4 pb-3 pt-0 border-t border-border/50">
                        <p className="text-[11px] text-muted-foreground leading-relaxed mb-2 mt-2">
                          {insight.description}
                        </p>
                        <div className="text-[11px] bg-purple-500/5 text-purple-400 rounded p-2 leading-relaxed mb-2">
                          {insight.suggestion}
                        </div>
                        <div className="flex gap-3 text-[10px] text-muted-foreground">
                          <span className="capitalize">{insight.mode}</span>
                          <button
                            onClick={() => {
                              const fId = insight.featureIds[0];
                              if (!fId) return;
                              setExpandedFeature(fId);
                              setTimeout(() => {
                                document
                                  .getElementById(`scorer-feature-${fId}`)
                                  ?.scrollIntoView({
                                    behavior: "smooth",
                                    block: "center",
                                  });
                              }, 100);
                            }}
                            className="text-purple-400 hover:underline"
                          >
                            {insight.featureIds.length} feature
                            {insight.featureIds.length !== 1 ? "s" : ""}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              {insights.length > insightsVisible && (
                <button
                  onClick={() =>
                    setInsightsVisible((v) => v + 10)
                  }
                  className="text-xs text-muted-foreground hover:text-foreground py-2"
                >
                  Load more ({insights.length - insightsVisible} remaining)
                </button>
              )}
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
                    agentLogs={agentStats[f.featureId] || null}
                    agentStatsLoading={agentStatsLoading === f.featureId}
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
  agentLogs,
  agentStatsLoading,
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
  agentLogs: AgentLogEntry[] | null;
  agentStatsLoading: boolean;
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
        id={`scorer-feature-${f.featureId}`}
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
              {/* Digest (only if content exists) */}
              {digest?.content && (
                <div className="p-4 border-b">
                  <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                    Digest
                  </div>
                  <div className="text-[11px] text-muted-foreground leading-relaxed p-3 bg-card rounded border-l-2 border-l-purple-500 whitespace-pre-wrap font-mono">
                    {digest.content}
                  </div>
                </div>
              )}

              {/* Agent stats summary for the feature */}
              {agentLogs && agentLogs.length > 0 && (
                <FeatureAgentSummary logs={agentLogs} />
              )}

              {/* Task cards (only if tasks exist) */}
              {f.tasks.length > 0 && (
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
                        agentLogs={agentLogs?.filter(
                          (l) => l.taskId === task.taskId
                        ) || null}
                        agentStatsLoading={agentStatsLoading}
                      />
                    ))}
                  </div>
                </div>
              )}

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
  agentLogs,
  agentStatsLoading,
}: {
  task: TaskMetrics;
  filesPlanned: string[];
  formatDuration: (min: number | null) => string;
  agentLogs: AgentLogEntry[] | null;
  agentStatsLoading: boolean;
}) {
  const [filesExpanded, setFilesExpanded] = useState(false);
  const [agentsExpanded, setAgentsExpanded] = useState(false);
  const plannedSet = new Set(filesPlanned);
  const correctionMessages = task.correctionMessages || [];
  const agentRuns = task.agentRuns || [];
  const statusColor =
    task.prStatus === "DONE"
      ? "bg-green-500/10 text-green-400"
      : "bg-blue-500/10 text-blue-400";

  const created = task.filesTouched.filter((f) => f.action === "create").length;
  const modified = task.filesTouched.length - created;

  const logsWithStats = agentLogs?.filter((l) => l.stats) || [];

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
        {agentRuns.length > 0 && (
          <span>
            {agentRuns.map((r) => `${r.agent}: ${r.count}`).join(", ")}
          </span>
        )}
      </div>

      {/* Description */}
      {task.taskDescription && (
        <div className="text-[10px] text-muted-foreground/70 mb-2 line-clamp-2">
          {task.taskDescription}
        </div>
      )}

      {/* Agent stat cards (collapsible) */}
      {(logsWithStats.length > 0 || agentStatsLoading) && (
        <div className="mb-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setAgentsExpanded(!agentsExpanded);
            }}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {agentsExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            <span>
              {logsWithStats.length} agent session{logsWithStats.length !== 1 ? "s" : ""}
            </span>
            {agentStatsLoading && (
              <Loader2 className="w-3 h-3 animate-spin ml-1" />
            )}
          </button>
          {agentsExpanded && (
            <div className="flex flex-col gap-2 mt-2">
              {logsWithStats.map((log) => (
                <AgentStatCard key={log.id} log={log} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Correction messages (collapsible) */}
      {correctionMessages.length > 0 && (
        <CorrectionMessages messages={correctionMessages} />
      )}

      {/* Files summary (collapsible) */}
      {task.filesTouched.length > 0 && (
        <div className="mb-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setFilesExpanded(!filesExpanded);
            }}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {filesExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            <span>
              {task.filesTouched.length} file{task.filesTouched.length !== 1 ? "s" : ""}
              {created > 0 && modified > 0
                ? ` (${created} created, ${modified} modified)`
                : created > 0
                  ? ` (${created} created)`
                  : ` (${modified} modified)`}
            </span>
          </button>
          {filesExpanded && (
            <div className="flex flex-wrap gap-1 mt-1.5">
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

function AgentStatCard({ log }: { log: AgentLogEntry }) {
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const stats = log.stats!;

  const topTools = Object.entries(stats.toolFrequency)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5);

  const topBash = Object.entries(stats.bashFrequency)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 4);

  const topShell = Object.entries(stats.developerShellFrequency)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 4);

  const formatSeconds = (s: number | null) => {
    if (s === null) return null;
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    const rem = s % 60;
    if (m < 60) return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
    const h = Math.floor(m / 60);
    return `${h}h ${m % 60}m`;
  };

  const durationStr = formatSeconds(stats.durationSeconds);

  return (
    <div className="border rounded p-2.5 bg-background text-[10px]">
      {/* Header */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className="font-semibold text-[11px]">{log.agentType}</span>
        <span className="text-muted-foreground">
          {stats.totalMessages} msgs
        </span>
        <span className="text-muted-foreground">
          ~{stats.estimatedTokens >= 1000
            ? `${Math.round(stats.estimatedTokens / 1000)}k`
            : stats.estimatedTokens}{" "}
          tok
        </span>
        {durationStr && (
          <span className="text-muted-foreground">{durationStr}</span>
        )}
        <span className="text-muted-foreground">
          {stats.totalToolCalls} tool call{stats.totalToolCalls !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Tool frequency */}
      {topTools.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {topTools.map(([name, count]) => (
            <span
              key={name}
              className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
            >
              {name}: {count}
            </span>
          ))}
        </div>
      )}

      {/* Bash / shell frequency */}
      {(topBash.length > 0 || topShell.length > 0) && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {topBash.map(([cmd, count]) => (
            <span
              key={`bash-${cmd}`}
              className="px-1.5 py-0.5 rounded bg-orange-500/5 text-orange-400/80"
            >
              {cmd}: {count}
            </span>
          ))}
          {topShell.map(([cmd, count]) => (
            <span
              key={`shell-${cmd}`}
              className="px-1.5 py-0.5 rounded bg-blue-500/5 text-blue-400/80"
            >
              {cmd}: {count}
            </span>
          ))}
        </div>
      )}

      {/* Conversation preview (collapsible) */}
      {stats.conversationPreview.length > 0 && (
        <div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setPreviewExpanded(!previewExpanded);
            }}
            className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {previewExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            conversation preview
          </button>
          {previewExpanded && (
            <div className="mt-1.5 max-h-48 overflow-y-auto border rounded p-2 bg-card font-mono text-[9px] leading-relaxed">
              {stats.conversationPreview.map((msg, i) => (
                <div
                  key={i}
                  className={
                    msg.role === "user"
                      ? "text-blue-400"
                      : "text-muted-foreground"
                  }
                >
                  [{msg.role === "assistant" ? "asst" : msg.role}]{" "}
                  {msg.text}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FeatureAgentSummary({ logs }: { logs: AgentLogEntry[] }) {
  const withStats = logs.filter((l) => l.stats);
  if (withStats.length === 0) return null;

  let totalTokens = 0;
  let totalToolCalls = 0;
  let totalDuration = 0;
  let hasDuration = false;

  for (const log of withStats) {
    const s = log.stats!;
    totalTokens += s.estimatedTokens;
    totalToolCalls += s.totalToolCalls;
    if (s.durationSeconds !== null) {
      totalDuration += s.durationSeconds;
      hasDuration = true;
    }
  }

  const formatTokens = (t: number) =>
    t >= 1000 ? `${Math.round(t / 1000)}k` : String(t);

  const formatDur = (s: number) => {
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m`;
    return `${Math.floor(m / 60)}h ${m % 60}m`;
  };

  return (
    <div className="px-4 pt-3 pb-1 border-b">
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
        <span className="text-[9px] font-semibold uppercase tracking-wider">
          Agent totals
        </span>
        <span>~{formatTokens(totalTokens)} tokens</span>
        <span>{totalToolCalls} tool calls</span>
        {hasDuration && <span>{formatDur(totalDuration)}</span>}
        <span>{withStats.length} session{withStats.length !== 1 ? "s" : ""}</span>
      </div>
    </div>
  );
}

function CorrectionMessages({ messages }: { messages: string[] }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mb-2">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setExpanded(!expanded);
        }}
        className="flex items-center gap-1 text-[10px] text-orange-400 hover:text-orange-300 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="w-3 h-3" />
        ) : (
          <ChevronRight className="w-3 h-3" />
        )}
        <span>
          {messages.length} correction{messages.length !== 1 ? "s" : ""}
        </span>
      </button>
      {expanded && (
        <div className="flex flex-col gap-1.5 mt-1.5 ml-4">
          {messages.map((msg, i) => (
            <div
              key={i}
              className="text-[10px] text-orange-400/80 bg-orange-500/5 rounded p-2 leading-relaxed border-l-2 border-l-orange-500/30"
            >
              {msg}
            </div>
          ))}
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
