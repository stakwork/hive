"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MessageBubble, StatsBar, unescapeLogString } from "./LogDetailContent";
import type { ParsedMessage, AgentLogStats } from "@/lib/utils/agent-log-stats";

interface AgentLogItem {
  id: string;
  agent: string;
}

interface LogsArtifactPanelProps {
  logs: AgentLogItem[];
  featureId: string;
}

interface LogState {
  conversation: ParsedMessage[] | null;
  stats: AgentLogStats | null;
  rawContent: string;
  loading: boolean;
  error: string | null;
}

function formatAgentLabel(agent: string, featureId: string): string {
  // "test-agent-cmpp75an00001l8049l77y5el" → "Test Agent"
  const stripped = agent.endsWith(`-${featureId}`) ? agent.slice(0, -(featureId.length + 1)) : agent;
  return stripped
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function LogsArtifactPanel({ logs, featureId }: LogsArtifactPanelProps) {
  // Default to the latest (rightmost — parent already sorts ascending by timestamp)
  const [selectedId, setSelectedId] = useState<string | null>(
    () => logs[logs.length - 1]?.id ?? null,
  );
  const [logStates, setLogStates] = useState<Record<string, LogState>>({});

  // Keep selection in sync if logs array changes
  useEffect(() => {
    if (!selectedId || !logs.some((l) => l.id === selectedId)) {
      setSelectedId(logs[logs.length - 1]?.id ?? null);
    }
  }, [logs, selectedId]);

  // Fetch stats for the selected log if we don't have them cached yet
  useEffect(() => {
    if (!selectedId || logStates[selectedId]) return;

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
    if (!selectedId) return;
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

  const tabs = useMemo(
    () => logs.map((l) => ({ id: l.id, label: formatAgentLabel(l.agent, featureId) })),
    [logs, featureId],
  );

  const current = selectedId ? logStates[selectedId] : null;
  const hasContent = !!current && (current.conversation !== null || current.rawContent !== "");

  return (
    <div className="h-full overflow-auto p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Agent logs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={selectedId === tab.id}
              onClick={() => setSelectedId(tab.id)}
              className={cn(
                "px-2.5 h-7 text-xs rounded-md transition-colors whitespace-nowrap border",
                selectedId === tab.id
                  ? "bg-muted text-foreground border-border"
                  : "text-muted-foreground border-transparent hover:bg-muted/50 hover:text-foreground",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleDownload}
          disabled={!selectedId}
          className="gap-1.5 h-7 text-xs shrink-0"
        >
          <Download className="h-3 w-3" />
          Download
        </Button>
      </div>

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
                <MessageBubble key={i} message={msg} />
              ))}
            </div>
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-sm">
              {unescapeLogString(current.rawContent)}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
