"use client";

import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Share2 } from "lucide-react";
import { toast } from "sonner";
import type { ParsedMessage, AgentLogStats } from "@/lib/utils/agent-log-stats";
import { LogDetailContent } from "./LogDetailContent";

interface LogDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  logId: string | null;
}

export function LogDetailDialog({ open, onOpenChange, logId }: LogDetailDialogProps) {
  const [conversation, setConversation] = useState<ParsedMessage[] | null>(null);
  const [stats, setStats] = useState<AgentLogStats | null>(null);
  const [rawContent, setRawContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !logId) {
      setConversation(null);
      setStats(null);
      setRawContent("");
      setError(null);
      return;
    }

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
  }, [open, logId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[900px] max-h-[80vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Agent Log Details</DialogTitle>
          <DialogDescription>
            {logId ? `Log ID: ${logId}` : "Viewing agent log content"}
          </DialogDescription>
        </DialogHeader>

        <LogDetailContent
          variant="modal"
          conversation={conversation}
          stats={stats}
          rawContent={rawContent}
          loading={loading}
          error={error}
        />

        <DialogFooter>
          <Button
            variant="outline"
            onClick={async () => {
              await navigator.clipboard.writeText(window.location.href);
              toast.success("Link copied to clipboard!");
            }}
          >
            <Share2 className="w-4 h-4 mr-2" />
            Share
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
