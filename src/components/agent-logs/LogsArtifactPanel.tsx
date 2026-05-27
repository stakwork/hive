"use client";

import React, { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LogDetailContent } from "./LogDetailContent";
import type { ParsedMessage, AgentLogStats } from "@/lib/utils/agent-log-stats";

interface LogsArtifactPanelProps {
  logId: string;
}

export function LogsArtifactPanel({ logId }: LogsArtifactPanelProps) {
  const [conversation, setConversation] = useState<ParsedMessage[] | null>(null);
  const [stats, setStats] = useState<AgentLogStats | null>(null);
  const [rawContent, setRawContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!logId) return;

    const fetchStats = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/agent-logs/${logId}/stats`);
        if (!response.ok) {
          throw new Error(`Failed to fetch log: ${response.statusText}`);
        }
        const data = await response.json();
        if (data.conversation && Array.isArray(data.conversation) && data.conversation.length > 0) {
          setConversation(data.conversation);
          setStats(data.stats ?? null);
        } else {
          setRawContent(JSON.stringify(data, null, 2));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch log content");
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [logId]);

  const handleDownload = async () => {
    try {
      const res = await fetch(`/api/agent-logs/${logId}/content`);
      if (!res.ok) throw new Error("Failed to fetch log content");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `agent-log-${logId}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download failed:", err);
    }
  };

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex justify-end px-4 pt-3 pb-1 shrink-0">
        <Button variant="outline" size="sm" onClick={handleDownload} className="gap-1.5 h-7 text-xs">
          <Download className="h-3 w-3" />
          Download
        </Button>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        <LogDetailContent
          variant="modal"
          conversation={conversation}
          stats={stats}
          rawContent={rawContent}
          loading={loading}
          error={error}
        />
      </div>
    </div>
  );
}
