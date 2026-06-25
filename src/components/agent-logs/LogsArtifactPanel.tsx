"use client";

import React, { useEffect, useMemo, useState } from "react";
import { formatInUserTz } from "@/lib/date-utils";
import { useUserTimezone } from "@/hooks/useUserTimezone";
import { useParams } from "next/navigation";
import { Download, Loader2, Sparkles, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { MessageBubble, StatsBar, unescapeLogString } from "./LogDetailContent";
import { AgentSessionCaptureModal } from "@/components/evals/AgentSessionCaptureModal";
import type { ParsedMessage, AgentLogStats } from "@/lib/utils/agent-log-stats";
import type { ConversationMessage } from "@/hooks/useStreamedAgentLog";
import type { AgentEventsStatus } from "@/hooks/useAgentEvents";

interface AgentLogItem {
  id: string;
  agent: string;
  createdAt?: string;
}

interface ScorerInsight {
  id: string;
  severity: string;
  pattern: string;
  description: string;
  suggestion: string;
  featureIds: string[];
  createdAt: string;
}

/** Synthetic id used for the provisional (streaming) tab */
const PROVISIONAL_ID = "__provisional__";
/** Synthetic id used for the insights tab */
const INSIGHTS_ID = "INSIGHTS";

interface LogsArtifactPanelProps {
  logs: AgentLogItem[];
  lastUpdated?: Record<string, number>;
  streamingLog?: { agent: string; conversation: ConversationMessage[]; status: AgentEventsStatus } | null;
  featureId?: string;
  isSuperAdmin?: boolean;
}

interface LogState {
  conversation: ParsedMessage[] | null;
  stats: AgentLogStats | null;
  rawContent: string;
  loading: boolean;
  error: string | null;
}

function formatAgentLabel(agent: string): string {
  const match = agent.match(/^(.+?)-agent\b/i);
  const prefix = match ? match[1] : agent;
  const titleCased = prefix
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
  return match ? `${titleCased} Agent` : titleCased;
}

const severityBorderColor = (sev: string) => {
  switch (sev) {
    case "HIGH": return "border-l-red-500";
    case "MEDIUM": return "border-l-orange-500";
    case "LOW": return "border-l-blue-500";
    default: return "border-l-muted";
  }
};

const sevBadgeColor = (sev: string) => {
  switch (sev) {
    case "HIGH": return "bg-red-500/10 text-red-400";
    case "MEDIUM": return "bg-orange-500/10 text-orange-400";
    case "LOW": return "bg-blue-500/10 text-blue-400";
    default: return "bg-muted text-muted-foreground";
  }
};

export function LogsArtifactPanel({
  logs,
  lastUpdated,
  streamingLog,
  featureId,
  isSuperAdmin,
}: LogsArtifactPanelProps) {
  const { timezone } = useUserTimezone();
  const params = useParams();
  const slug = params?.slug as string | undefined;
  const isStakwork = slug === "stakwork";

  const hasProvisional = !!streamingLog && streamingLog.status === "streaming";

  const defaultId = logs[logs.length - 1]?.id ?? (hasProvisional ? PROVISIONAL_ID : null);

  const [selectedId, setSelectedId] = useState<string | null>(() => defaultId);
  const [logStates, setLogStates] = useState<Record<string, LogState>>({});

  // Capture modal state (stakwork-only)
  const [captureOpen, setCaptureOpen] = useState(false);
  const [captureTurnIndex, setCaptureTurnIndex] = useState<number | undefined>(undefined);

  // Scorer insights state
  const [insights, setInsights] = useState<ScorerInsight[]>([]);
  const [effectivePrompt, setEffectivePrompt] = useState("");
  const [promptDraft, setPromptDraft] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showPromptEditor, setShowPromptEditor] = useState(false);
  const [expandedInsights, setExpandedInsights] = useState<Set<string>>(new Set());

  // Fetch insights on mount
  useEffect(() => {
    if (!featureId) return;
    fetch(`/api/scorer/insights/${featureId}`)
      .then((r) => r.json())
      .then((data) => {
        setInsights(data.insights ?? []);
        setEffectivePrompt(data.effectivePrompt ?? "");
      })
      .catch(() => {});
  }, [featureId]);

  useEffect(() => {
    if (selectedId === PROVISIONAL_ID) {
      if (!hasProvisional) {
        const canonical = streamingLog
          ? logs.find((l) => l.agent === streamingLog.agent)
          : null;
        setSelectedId(canonical?.id ?? logs[logs.length - 1]?.id ?? null);
      }
      return;
    }
    if (
      !selectedId ||
      (selectedId !== INSIGHTS_ID && !logs.some((l) => l.id === selectedId))
    ) {
      setSelectedId(hasProvisional ? PROVISIONAL_ID : (logs[logs.length - 1]?.id ?? null));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logs, selectedId, hasProvisional]);

  useEffect(() => {
    if (!selectedId || selectedId === INSIGHTS_ID) return;
    setLogStates((prev) => {
      const entry = prev[selectedId];
      if (!entry) return prev;
      const next = { ...prev };
      delete next[selectedId];
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId ? (lastUpdated?.[selectedId] ?? 0) : 0]);

  useEffect(() => {
    if (!selectedId || selectedId === INSIGHTS_ID || logStates[selectedId]) return;

    setLogStates((prev) => ({
      ...prev,
      [selectedId]: {
        conversation: null,
        stats: null,
        rawContent: "",
        loading: true,
        error: null,
      },
    }));

    const fetchStats = async () => {
      try {
        const response = await fetch(`/api/agent-logs/${selectedId}/stats`);
        if (!response.ok) {
          throw new Error(`Failed to fetch log: ${response.statusText}`);
        }
        const data = await response.json();
        const hasConversation =
          data.conversation && Array.isArray(data.conversation) && data.conversation.length > 0;
        setLogStates((prev) => ({
          ...prev,
          [selectedId]: {
            conversation: hasConversation ? data.conversation : null,
            stats: hasConversation ? (data.stats ?? null) : null,
            rawContent: hasConversation ? "" : JSON.stringify(data, null, 2),
            loading: false,
            error: null,
          },
        }));
      } catch (err) {
        setLogStates((prev) => ({
          ...prev,
          [selectedId]: {
            conversation: null,
            stats: null,
            rawContent: "",
            loading: false,
            error: err instanceof Error ? err.message : "Failed to fetch log content",
          },
        }));
      }
    };

    fetchStats();
  }, [selectedId, logStates]);

  const handleDownload = async () => {
    if (!selectedId || selectedId === INSIGHTS_ID) return;
    try {
      const res = await fetch(`/api/agent-logs/${selectedId}/content`);
      if (!res.ok) throw new Error("Failed to fetch log content");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `agent-log-${selectedId}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download failed:", err);
    }
  };

  const handleAnalyzeClick = () => {
    setPromptDraft(effectivePrompt);
    setShowPromptEditor((v) => !v);
  };

  const handleRunAnalysis = async () => {
    if (!featureId || isAnalyzing) return;
    setIsAnalyzing(true);
    try {
      const res = await fetch(`/api/scorer/analyze/${featureId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: promptDraft !== effectivePrompt ? promptDraft : undefined,
        }),
      });
      if (!res.ok) throw new Error("Analysis failed");
      const data = await res.json();
      setInsights(data.insights ?? []);
      setShowPromptEditor(false);
      setSelectedId(INSIGHTS_ID);
      toast.success(`Analysis complete: ${data.insightCount} insight(s) found`);
    } catch {
      toast.error("Analysis failed");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const toggleInsight = (id: string) => {
    setExpandedInsights((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const tabs = useMemo(() => {
    const base = logs.map((l) => ({ id: l.id, label: formatAgentLabel(l.agent), createdAt: l.createdAt, provisional: false }));
    const counts = base.reduce<Record<string, number>>((acc, t) => {
      acc[t.label] = (acc[t.label] ?? 0) + 1;
      return acc;
    }, {});
    const seen: Record<string, number> = {};
    const canonical = base.map((t) => {
      if (counts[t.label] <= 1) return t;
      seen[t.label] = (seen[t.label] ?? 0) + 1;
      return { ...t, label: `${t.label} ${seen[t.label]}` };
    });
    if (hasProvisional && streamingLog) {
      canonical.push({
        id: PROVISIONAL_ID,
        label: formatAgentLabel(streamingLog.agent),
        createdAt: undefined,
        provisional: true,
      });
    }
    return canonical;
  }, [logs, hasProvisional, streamingLog]);

  const isProvisionalSelected = selectedId === PROVISIONAL_ID;
  const isInsightsSelected = selectedId === INSIGHTS_ID;
  const current = !isProvisionalSelected && !isInsightsSelected && selectedId ? logStates[selectedId] : null;
  const hasContent = !!current && (current.conversation !== null || current.rawContent !== "");

  return (
    <div className="h-full overflow-auto p-4">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Agent logs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={selectedId === tab.id}
              onClick={() => setSelectedId(tab.id)}
              title={tab.createdAt ? formatInUserTz(new Date(tab.createdAt), timezone) : undefined}
              className={cn(
                "px-2.5 h-auto py-1 text-xs rounded-md transition-colors whitespace-nowrap border flex items-center gap-1.5",
                selectedId === tab.id
                  ? "bg-muted text-foreground border-border"
                  : "text-muted-foreground border-transparent hover:bg-muted/50 hover:text-foreground",
              )}
            >
              <span className="flex flex-col items-start leading-tight">
                <span>{tab.label}</span>
                {tab.createdAt && (
                  <span className="text-[10px] text-muted-foreground font-normal">
                    {new Date(tab.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
              </span>
              {tab.provisional && (
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse"
                  aria-label="streaming"
                />
              )}
            </button>
          ))}
          {insights.length > 0 && (
            <button
              role="tab"
              aria-selected={isInsightsSelected}
              onClick={() => setSelectedId(INSIGHTS_ID)}
              className={cn(
                "px-2.5 h-7 text-xs rounded-md transition-colors whitespace-nowrap border flex items-center gap-1.5",
                isInsightsSelected
                  ? "bg-muted text-foreground border-border"
                  : "text-muted-foreground border-transparent hover:bg-muted/50 hover:text-foreground",
              )}
            >
              Insights
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {isSuperAdmin && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleAnalyzeClick}
              disabled={isAnalyzing}
              className="gap-1.5 h-7 text-xs"
            >
              {isAnalyzing ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3" />
              )}
              Analyze
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleDownload}
            disabled={!selectedId || isProvisionalSelected || isInsightsSelected}
            className="gap-1.5 h-7 text-xs"
          >
            <Download className="h-3 w-3" />
            Download
          </Button>
        </div>
      </div>

      {/* Expandable prompt editor */}
      {showPromptEditor && isSuperAdmin && (
        <div className="border-b px-0 py-3 space-y-2 mb-3">
          <Textarea
            value={promptDraft}
            onChange={(e) => setPromptDraft(e.target.value)}
            disabled={isAnalyzing}
            rows={6}
            className="text-xs font-mono resize-none"
            placeholder="Enter analysis prompt..."
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleRunAnalysis} disabled={isAnalyzing}>
              {isAnalyzing ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  Running...
                </>
              ) : (
                "Run Analysis"
              )}
            </Button>
            <button
              onClick={() => setShowPromptEditor(false)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Insights tab content */}
      {isInsightsSelected && (
        <div className="space-y-2">
          {insights.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No insights yet. Click Analyze to run analysis.
            </p>
          ) : (
            insights.map((insight) => {
              const isExpanded = expandedInsights.has(insight.id);
              return (
                <div
                  key={insight.id}
                  className={cn(
                    "border border-border rounded-md border-l-[3px] overflow-hidden",
                    severityBorderColor(insight.severity),
                  )}
                >
                  <button
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/30 transition-colors"
                    onClick={() => toggleInsight(insight.id)}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                    )}
                    <span
                      className={cn(
                        "text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded shrink-0",
                        sevBadgeColor(insight.severity),
                      )}
                    >
                      {insight.severity}
                    </span>
                    <span className="text-xs font-semibold truncate">{insight.pattern}</span>
                  </button>
                  {isExpanded && (
                    <div className="px-3 pb-3 space-y-2">
                      <p className="text-[11px] text-muted-foreground">{insight.description}</p>
                      {insight.suggestion && (
                        <div className="bg-purple-500/5 text-purple-400 rounded p-2 text-[11px]">
                          {insight.suggestion}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Provisional (streaming) tab content */}
      {isProvisionalSelected && streamingLog && (
        <div className="space-y-3">
          {streamingLog.conversation.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {streamingLog.conversation.map((msg, i) => (
                <MessageBubble key={i} message={msg as ParsedMessage} />
              ))}
              <div className="flex items-center gap-2 pl-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Streaming…</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Canonical tab content */}
      {!isProvisionalSelected && !isInsightsSelected && (
        <>
          {current?.loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {current?.error && !current.loading && (
            <div className="text-center py-12">
              <p className="text-destructive text-sm">{current.error}</p>
            </div>
          )}

          {current && !current.loading && !current.error && hasContent && (
            <>
              {current.stats && <StatsBar stats={current.stats} />}
              {current.conversation ? (
                <div className="space-y-3">
                  {current.conversation.map((msg, i) => (
                    <MessageBubble
                      key={i}
                      message={msg}
                      onFlag={isStakwork && msg.role === "assistant" ? () => { setCaptureTurnIndex(i - 1); setCaptureOpen(true); } : undefined}
                    />
                  ))}
                </div>
              ) : (
                <pre className="whitespace-pre-wrap break-words font-mono text-sm">
                  {unescapeLogString(current.rawContent)}
                </pre>
              )}
            </>
          )}
        </>
      )}
      {isStakwork && selectedId && selectedId !== PROVISIONAL_ID && selectedId !== INSIGHTS_ID && (
        <AgentSessionCaptureModal
          open={captureOpen}
          onOpenChange={setCaptureOpen}
          slug={slug as string}
          logId={selectedId}
          turnIndex={captureTurnIndex}
        />
      )}
    </div>
  );
}
