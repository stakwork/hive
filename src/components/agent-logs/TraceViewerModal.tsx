"use client";

import { useState, useEffect } from "react";
import { ExternalLink, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AgentLogRecord } from "@/types/agent-logs";

type IframeState = "loading" | "ready" | "error";

const formatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

interface TraceViewerModalProps {
  open: boolean;
  log: AgentLogRecord | null;
  onOpenChange: (open: boolean) => void;
}

export function TraceViewerModal({ open, log, onOpenChange }: TraceViewerModalProps) {
  const [iframeState, setIframeState] = useState<IframeState>("loading");

  // Reset iframe state whenever the modal opens or the log changes
  useEffect(() => {
    if (open) {
      setIframeState("loading");
    }
  }, [open, log?.id]);

  if (!log?.phoenixTraceUrl) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[95vw] h-[90vh] flex flex-col p-0">
        <DialogHeader className="flex flex-row items-center justify-between px-4 py-3 border-b shrink-0">
          <div>
            <DialogTitle>{log.agent}</DialogTitle>
            <p className="text-xs text-muted-foreground">
              {formatter.format(new Date(log.createdAt))}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={log.phoenixTraceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              Open in Phoenix <ExternalLink className="h-3 w-3" />
            </a>
            <Button variant="ghost" size="icon" onClick={() => onOpenChange(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="relative flex-1 overflow-hidden">
          {iframeState === "loading" && (
            <div className="absolute inset-0 flex items-center justify-center bg-background z-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}
          {iframeState === "error" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-muted-foreground z-10">
              <p className="text-sm">Unable to load Phoenix trace.</p>
              <a
                href={log.phoenixTraceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs underline"
              >
                Open in Phoenix ↗
              </a>
            </div>
          )}
          <iframe
            src={log.phoenixTraceUrl}
            className="w-full h-full border-0"
            onLoad={() => setIframeState("ready")}
            onError={() => setIframeState("error")}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
