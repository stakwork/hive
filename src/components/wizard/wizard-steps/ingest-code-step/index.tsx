import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useCallback, useRef } from "react";
import { useWizardStore } from "@/stores/useWizardStore";

interface IngestCodeStepStepProps {
  onNext: () => void;
  onBack?: () => void;
}

export function IngestCodeStep({ onNext }: IngestCodeStepStepProps) {
  const swarmId = useWizardStore((s) => s.swarmId);
  const workspaceId = useWizardStore((s) => s.workspaceId);
  const setCurrentStepStatus = useWizardStore((s) => s.setCurrentStepStatus);
  const currentStepStatus = useWizardStore((s) => s.currentStepStatus);
  const setIngestRefId = useWizardStore((s) => s.setIngestRefId);
  const setServices = useWizardStore((s) => s.setServices);
  const updateWizardProgress = useWizardStore((s) => s.updateWizardProgress);
  const ingestRefId = useWizardStore((s) => s.ingestRefId);
  const isPending = currentStepStatus === "PENDING";

  const ingestHasBeenSet = useRef(false);

  const pollTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleIngestStart = useCallback(async () => {
    try {
      const res = await fetch("/api/swarm/stakgraph/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ swarmId }),
      });

      const { data } = await res.json();

      updateWizardProgress({
        wizardStep: "INGEST_CODE",
        stepStatus: "PROCESSING",
        wizardData: {},
      });

      setIngestRefId(data.request_id);
    } catch (error) {
      console.error("Failed to ingest code:", error);
      setCurrentStepStatus("FAILED");
    }
  }, [swarmId, setIngestRefId, setCurrentStepStatus, updateWizardProgress]);

  const handleServices = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/swarm/stakgraph/services?workspaceId=${encodeURIComponent(
          workspaceId,
        )}&swarmId=${encodeURIComponent(swarmId!)}`,
      );
      const data = await res.json();

      if (data.success || data.status === "ACTIVE") {
        setServices(data.data.services);
      } else {
        console.log("polling response (not ready):", data);
      }
    } catch (error) {
      console.error("Polling error:", error);
      setCurrentStepStatus("FAILED");
    }
  }, [workspaceId, swarmId, setServices, setCurrentStepStatus]);

  useEffect(() => {
    if (!ingestRefId) return;

    let isCancelled = false;

    const getIngestStatus = async () => {
      if (isCancelled) return;

      try {
        const res = await fetch(
          `/api/swarm/stakgraph/status?id=${ingestRefId}&swarmId=${swarmId}&workspaceId=${workspaceId}`,
        );
        const { apiResult } = await res.json();
        const { data } = apiResult;

        console.log("Ingest status:", data);

        if (data.status === "Complete") {
          await handleServices();
          await updateWizardProgress({
            wizardStep: "INGEST_CODE",
            stepStatus: "COMPLETED",
            wizardData: {},
          });
          setCurrentStepStatus("COMPLETED");
          onNext();
        } else {
          pollTimeoutRef.current = setTimeout(getIngestStatus, 3000);
        }
      } catch (error) {
        console.error("Failed to get ingest status:", error);
        setCurrentStepStatus("FAILED");
      }
    };

    getIngestStatus();

    return () => {
      isCancelled = true;
      if (pollTimeoutRef.current) {
        clearTimeout(pollTimeoutRef.current);
        pollTimeoutRef.current = null;
      }
    };
  }, [
    ingestRefId,
    swarmId,
    workspaceId,
    handleServices,
    setCurrentStepStatus,
    onNext,
    updateWizardProgress,
  ]);

  useEffect(() => {
    if (isPending && !ingestHasBeenSet.current) {
      handleIngestStart();
      ingestHasBeenSet.current = true;
    }
  }, [isPending, handleIngestStart, ingestHasBeenSet]);

  return (
    <Card className="max-w-2xl mx-auto bg-card text-card-foreground">
      <CardHeader className="text-center">
        <div className="flex items-center justify-center mx-auto mb-4">
          {/* SVG loader here */}
        </div>
        <AnimatePresence mode="wait">
          {!isPending ? (
            <motion.div
              key="title-ingest"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
            >
              <CardTitle className="text-2xl">Ingest Code</CardTitle>
              <CardDescription>
                We will now ingest your codebase. This may take a few minutes.
              </CardDescription>
            </motion.div>
          ) : (
            <motion.div
              key="title-ingest-pending"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
            >
              <CardTitle className="text-2xl">Ingesting Code</CardTitle>
              <CardDescription>
                Your codebase is being ingested. Please wait...
              </CardDescription>
            </motion.div>
          )}
        </AnimatePresence>
      </CardHeader>
    </Card>
  );
}
