import { useToast } from "@/components/ui/use-toast";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useEffect, useRef, useState } from "react";

export function useIngestStatus() {
  const { workspace, id: workspaceId, updateWorkspace } = useWorkspace();
  const { toast } = useToast();
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const isRequestPendingRef = useRef(false);
  const [ingestError, setIngestError] = useState(false);
  const [isIngesting, setIsIngesting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>("Ingesting your codebase...");

  const ingestRefId = workspace?.ingestRefId;
  console.log(workspace?.repositories);
  const codeIsSynced = workspace?.repositories.every((repo) => repo.status === "SYNCED");

  useEffect(() => {
    if (codeIsSynced || !ingestRefId || !workspaceId || ingestError) {
      // Clear any existing polling
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
      setIsIngesting(false);
      return;
    }

    // Prevent multiple intervals
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }

    setIsIngesting(true);

    const getIngestStatus = async () => {
      if (isRequestPendingRef.current) return;

      isRequestPendingRef.current = true;
      try {
        console.log("getting ingest status");
        const res = await fetch(`/api/swarm/stakgraph/ingest?id=${ingestRefId}&workspaceId=${workspaceId}`);
        const { apiResult } = await res.json();
        const { data } = apiResult;

        if (!apiResult.ok) {
          setIngestError(true);
          setIsIngesting(false);
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
          return;
        }

        if (data?.status === "Complete") {
          updateWorkspace({
            repositories: workspace?.repositories.map((repo) => ({
              ...repo,
              status: "SYNCED",
            })),
          });
          setIsIngesting(false);
          setStatusMessage("Ingesting your codebase...");
          // Stop polling
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
          return;
        } else if (data?.status === "Failed") {
          console.log("Ingestion failed");
          toast({
            title: "Code Ingestion Failed",
            description: "There was an error ingesting your codebase. Please try again.",
            variant: "destructive",
          });
          setIngestError(true);
          setIsIngesting(false);
          // Stop polling on failure
          if (pollingIntervalRef.current) {
            clearInterval(pollingIntervalRef.current);
            pollingIntervalRef.current = null;
          }
          return;
        }
        // If still in progress, update the status message
        if (data?.update?.message) {
          setStatusMessage(data.update.message);
        }
      } catch (error) {
        console.error("Failed to get ingest status:", error);
        setIngestError(true);
        setIsIngesting(false);
        // Don't retry on error, let the interval handle it
      } finally {
        isRequestPendingRef.current = false;
      }
    };

    // Use setInterval for consistent polling
    pollingIntervalRef.current = setInterval(getIngestStatus, 5000);

    // Call once immediately
    getIngestStatus();

    return () => {
      setIsIngesting(false);
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [ingestRefId, workspaceId, codeIsSynced, ingestError, updateWorkspace, workspace?.repositories, toast]);

  return { ingestError, isIngesting, statusMessage };
}
