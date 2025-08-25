import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useWizardStore } from "@/stores/useWizardStore";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef } from "react";

interface IngestCodeStepStepProps {
  onNext: () => void;
  onBack?: () => void;
}

export function IngestCodeStep({ onNext }: IngestCodeStepStepProps) {
  const swarmId = useWizardStore((s) => s.swarmId);
  const setCurrentStepStatus = useWizardStore((s) => s.setCurrentStepStatus);
  const currentStepStatus = useWizardStore((s) => s.currentStepStatus);
  const setIngestRefId = useWizardStore((s) => s.setIngestRefId);
  const updateWizardProgress = useWizardStore((s) => s.updateWizardProgress);
  const isPending = currentStepStatus === "PENDING";

  const ingestHasBeenSet = useRef(false);


  const handleIngestStart = useCallback(async () => {
    try {
      const res = await fetch("/api/swarm/stakgraph/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ swarmId }),
      });

      const { data } = await res.json();

      await updateWizardProgress({
        wizardStep: "INGEST_CODE",
        stepStatus: "PROCESSING",
        wizardData: {},
      });

      setIngestRefId(data.request_id);

      await updateWizardProgress({
        wizardStep: "INGEST_CODE",
        stepStatus: "COMPLETED",
        wizardData: {},
      });

      onNext();

    } catch (error) {
      console.error("Failed to ingest code:", error);
      setCurrentStepStatus("FAILED");
    }
  }, [swarmId, updateWizardProgress, setIngestRefId, onNext, setCurrentStepStatus]);

  useEffect(() => {

    const init = async () => {
      try {
        await handleIngestStart();
        onNext()
      } catch (error) {
        console.error("Failed to ingest code:", error);
        setCurrentStepStatus("FAILED");
      }
    }
    if (isPending && !ingestHasBeenSet.current) {
      ingestHasBeenSet.current = true;

      init();
    }
  }, [isPending, handleIngestStart, ingestHasBeenSet, setCurrentStepStatus, onNext]);

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
