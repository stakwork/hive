"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2 } from "lucide-react";

interface LogDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  logId: string | null;
  blobUrl: string | null;
}

export function LogDetailDialog({
  open,
  onOpenChange,
  logId,
  blobUrl,
}: LogDetailDialogProps) {
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !blobUrl) {
      setContent("");
      setError(null);
      return;
    }

    const fetchContent = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(blobUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch log: ${response.statusText}`);
        }
        const text = await response.text();
        setContent(text);
      } catch (err) {
        console.error("Error fetching blob content:", err);
        setError(
          err instanceof Error ? err.message : "Failed to fetch log content"
        );
      } finally {
        setLoading(false);
      }
    };

    fetchContent();
  }, [open, blobUrl]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[80vh]">
        <DialogHeader>
          <DialogTitle>Agent Log Details</DialogTitle>
          <DialogDescription>
            {logId ? `Log ID: ${logId}` : "Viewing agent log content"}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && !loading && (
            <div className="text-center py-12">
              <p className="text-destructive text-sm">{error}</p>
            </div>
          )}

          {!loading && !error && content && (
            <ScrollArea className="h-[400px] w-full rounded-md border p-4">
              <pre className="whitespace-pre-wrap font-mono text-sm">
                {content}
              </pre>
            </ScrollArea>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
