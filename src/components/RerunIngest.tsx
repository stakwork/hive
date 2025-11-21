"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/use-toast";
import { Database, RefreshCw } from "lucide-react";

interface RerunIngestProps {
  readonly workspaceId: string;
  readonly workspaceName: string;
}

export function RerunIngest({
  workspaceId,
  workspaceName,
}: RerunIngestProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isIngesting, setIsIngesting] = useState(false);
  const { toast } = useToast();

  const handleRerunIngest = async () => {
    if (!workspaceId) {
      toast({
        title: "Error",
        description: "No workspace ID found",
        variant: "destructive",
      });
      return;
    }

    setIsIngesting(true);
    try {
      const response = await fetch("/api/swarm/stakgraph/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ workspaceId }),
      });

      let data;
      try {
        data = await response.json();
      } catch (parseError) {
        console.error("Failed to parse response as JSON:", parseError);
        throw new Error(`Server returned invalid response (${response.status})`);
      }

      if (response.ok) {
        toast({
          title: "Ingest Started",
          description: "Code ingestion has been started. This may take a few minutes.",
        });
        setIsOpen(false);
      } else if (response.status === 409) {
        // Handle duplicate ingest request
        toast({
          title: "Ingest Already in Progress",
          description: "A code ingestion is already running for this workspace. Please wait for it to complete before starting another one.",
          variant: "destructive",
        });
      } else {
        console.error("Ingest API error:", { status: response.status, data });
        toast({
          title: "Ingest Failed",
          description: data?.message || `Failed to start code ingestion (${response.status})`,
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Failed to start ingest:", error);
      const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred";
      toast({
        title: "Ingest Failed",
        description: `Network error: ${errorMessage}`,
        variant: "destructive",
      });
    } finally {
      setIsIngesting(false);
    }
  };

  return (
    <>
      <Card className="border-destructive/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <RefreshCw className="w-5 h-5" />
            Rerun Code Ingestion
          </CardTitle>
          <CardDescription>
            Re-ingest your codebase to update the graph database with the latest changes.
            This will refresh all analysis and recommendations.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            onClick={() => setIsOpen(true)}
          >
            <Database className="w-4 h-4 mr-2" />
            Rerun Ingest
          </Button>
        </CardContent>
      </Card>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="w-5 h-5" />
              Rerun Code Ingestion
            </DialogTitle>
            <DialogDescription>
              This will re-ingest the codebase for <strong>{workspaceName}</strong>.
              The process may take several minutes depending on the size of your repository.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsOpen(false)}
              disabled={isIngesting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRerunIngest}
              disabled={isIngesting}
            >
              <Database className="w-4 h-4 mr-2" />
              {isIngesting ? "Starting..." : "Start Ingestion"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}