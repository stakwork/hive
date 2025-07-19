
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect, useCallback, useRef } from "react";
import { useWizardStore } from "@/stores/useWizardStore";
import { sanitizeWorkspaceName } from "@/utils/repositoryParser";

interface IngestCodeStepStepProps {
  onNext: () => void;
  onBack: () => void;
}

export function IngestCodeStep({

  onNext,
  onBack,
}: IngestCodeStepStepProps) {
  const swarmId = useWizardStore((s) => s.swarmId);
  const workspaceId = useWizardStore((s) => s.workspaceId);
  const setCurrentStepStatus = useWizardStore((s) => s.setCurrentStepStatus);
  const currentStepStatus = useWizardStore((s) => s.currentStepStatus);

  const setServices = useWizardStore((s) => s.setServices);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const isProcessing = currentStepStatus === "PROCESSING";
  const isPending = currentStepStatus === "PENDING";

  const handleIngestStart = useCallback(async () => {
    setCurrentStepStatus("PROCESSING");

    try {
      const res = await fetch("/api/swarm/stakgraph/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ swarmId }),
      });

      const data = await res.json();
      console.log("response from handleIngestStart", data);
    } catch (error) {
      console.error("Failed to ingest code:", error);
      setCurrentStepStatus("FAILED");
    }
  }, [swarmId, setCurrentStepStatus]);

  const handleComplete = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setCurrentStepStatus("COMPLETED");
    onNext();
  }, [onNext, setCurrentStepStatus]);

  const startPollingServices = useCallback(() => {
    if (pollIntervalRef.current) {

      return; // avoid multiple intervals
    }

    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/swarm/stakgraph/services?workspaceId=${encodeURIComponent(
            workspaceId
          )}&swarmId=${encodeURIComponent(swarmId!)}`
        );
        const data = await res.json();

        if (data.success || data.status === "ACTIVE") {
          console.log("poll success", data);
          setServices(data.data)
          handleComplete();
        } else {
          console.log("polling response (not ready):", data);
        }
      } catch (error) {
        console.error("Polling error:", error);
        setCurrentStepStatus("FAILED");
        if (pollIntervalRef.current) {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      }
    }, 3000);
  }, [workspaceId, swarmId, handleComplete, setCurrentStepStatus]);

  useEffect(() => {
    if (isProcessing && swarmId && workspaceId) {
      startPollingServices();
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [isProcessing, swarmId, workspaceId, startPollingServices]);

  useEffect(() => {
    handleIngestStart();
  }, [handleIngestStart]);


  return (
    <Card className="max-w-2xl mx-auto bg-card text-card-foreground">
      <CardHeader className="text-center">
        <div className="flex items-center justify-center mx-auto mb-4">
          <svg width="80" height="64" viewBox="0 0 80 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="40" cy="32" r="12" fill="#E0E7FF" />
            <circle cx="40" cy="32" r="5" fill="#60A5FA">
              <animate attributeName="r" values="5;7;5" dur="1.2s" repeatCount="indefinite" />
            </circle>
            <circle cx="64" cy="20" r="4" fill="#2563EB">
              <animate attributeName="r" values="4;6;4" dur="1.2s" begin="0.3s" repeatCount="indefinite" />
            </circle>
            <circle cx="64" cy="44" r="4" fill="#2563EB">
              <animate attributeName="r" values="4;6;4" dur="1.2s" begin="0.6s" repeatCount="indefinite" />
            </circle>
            <circle cx="16" cy="20" r="4" fill="#2563EB">
              <animate attributeName="r" values="4;6;4" dur="1.2s" begin="0.9s" repeatCount="indefinite" />
            </circle>
            <circle cx="16" cy="44" r="4" fill="#2563EB">
              <animate attributeName="r" values="4;6;4" dur="1.2s" begin="1.2s" repeatCount="indefinite" />
            </circle>
            <line x1="40" y1="32" x2="64" y2="20" stroke="#60A5FA" strokeWidth="2">
              <animate attributeName="stroke" values="#60A5FA;#2563EB;#60A5FA" dur="1.2s" repeatCount="indefinite" />
            </line>
            <line x1="40" y1="32" x2="64" y2="44" stroke="#60A5FA" strokeWidth="2">
              <animate attributeName="stroke" values="#60A5FA;#2563EB;#60A5FA" dur="1.2s" begin="0.3s" repeatCount="indefinite" />
            </line>
            <line x1="40" y1="32" x2="16" y2="20" stroke="#60A5FA" strokeWidth="2">
              <animate attributeName="stroke" values="#60A5FA;#2563EB;#60A5FA" dur="1.2s" begin="0.6s" repeatCount="indefinite" />
            </line>
            <line x1="40" y1="32" x2="16" y2="44" stroke="#60A5FA" strokeWidth="2">
              <animate attributeName="stroke" values="#60A5FA;#2563EB;#60A5FA" dur="1.2s" begin="0.9s" repeatCount="indefinite" />
            </line>
            <line x1="16" y1="20" x2="16" y2="44" stroke="#60A5FA" strokeWidth="2" opacity="0.5" />
            <line x1="64" y1="20" x2="64" y2="44" stroke="#60A5FA" strokeWidth="2" opacity="0.5" />
          </svg>
        </div>
        <AnimatePresence mode="wait">
          {!isPending ? (
            <motion.div key="title-ingest" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }}>
              <CardTitle className="text-2xl">Ingest Code</CardTitle>
              <CardDescription>We will now ingest your codebase. This may take a few minutes.</CardDescription>
            </motion.div>
          ) : (
            <motion.div key="title-ingest-pending" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} transition={{ duration: 0.3 }}>
              <CardTitle className="text-2xl">Ingesting Code</CardTitle>
              <CardDescription>Your codebase is being ingested. Please wait...</CardDescription>
            </motion.div>
          )}
        </AnimatePresence>
      </CardHeader>
    </Card>
  );
}
