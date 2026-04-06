"use client";

import React, { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, FileText, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "sonner";
import { LogDetailContent } from "@/components/agent-logs/LogDetailContent";
import type { ParsedMessage, AgentLogStats } from "@/lib/utils/agent-log-stats";

export default function AgentLogDetailPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;
  const logId = params.logId as string;

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
        console.error("Error fetching log stats:", err);
        setError(err instanceof Error ? err.message : "Failed to fetch log content");
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [logId]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push(`/w/${slug}/agent-logs`)}
          >
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <PageHeader icon={FileText} title="Agent Log Details" />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            await navigator.clipboard.writeText(window.location.href);
            toast.success("Link copied to clipboard!");
          }}
        >
          <Share2 className="w-4 h-4 mr-2" />
          Share
        </Button>
      </div>

      <LogDetailContent
        variant="page"
        conversation={conversation}
        stats={stats}
        rawContent={rawContent}
        loading={loading}
        error={error}
      />
    </div>
  );
}
