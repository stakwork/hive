import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { useWizardStore } from "@/stores/useWizardStore";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";

interface GraphInfrastructureStepProps {
  onNext: () => void;
}

export function GraphInfrastructureStep({
  onNext,
}: GraphInfrastructureStepProps) {
  const [error, setError] = useState<string>("");
  const swarmId = useWizardStore((s) => s.swarmId);

  const setCurrentStepStatus = useWizardStore((s) => s.setCurrentStepStatus);
  const currentStepStatus = useWizardStore((s) => s.currentStepStatus);
  const updateWizardProgress = useWizardStore((s) => s.updateWizardProgress);

  const isPending = currentStepStatus === "PENDING";


  const handleComplete = useCallback(async () => {
    try {
      await updateWizardProgress({
        wizardStep: "GRAPH_INFRASTRUCTURE",
        stepStatus: "COMPLETED",
        wizardData: {},
      });

      setCurrentStepStatus("COMPLETED");
      onNext();
    } catch (error) {
      setError(error as string);
      setCurrentStepStatus("FAILED");
      throw error;
    }
  }, [onNext, setCurrentStepStatus, updateWizardProgress]);

  // ✅ Polling with sequential behavior
  useEffect(() => {
    let isCancelled = false;

    const pollSwarm = async () => {
      try {
        const res = await fetch(`/api/swarm/poll?id=${swarmId}`);
        const data = await res.json();

        if (isCancelled) return;

        if (data.status === "ACTIVE") {
          await handleComplete();
        } else {
          setTimeout(pollSwarm, 3000);
        }
      } catch (err) {
        console.log(err);
        if (!isCancelled) {
          setCurrentStepStatus("FAILED");
        }
      }
    };

    if (swarmId) {
      pollSwarm();
    }

    return () => {
      isCancelled = true;
    };
  }, [swarmId, handleComplete, setCurrentStepStatus]);

  return (
    <Card className="max-w-2xl mx-auto bg-card text-card-foreground">
      <CardHeader className="text-center">
        {error && <div className="text-red-500">{error}</div>}
        <div className="flex items-center justify-center mx-auto mb-4">
          <svg
            width="64"
            height="64"
            viewBox="0 0 64 64"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <line
              x1="32"
              y1="12"
              x2="12"
              y2="32"
              stroke="#60A5FA"
              strokeWidth="2"
            />
            <line
              x1="32"
              y1="12"
              x2="52"
              y2="32"
              stroke="#60A5FA"
              strokeWidth="2"
            />
            <line
              x1="12"
              y1="32"
              x2="32"
              y2="52"
              stroke="#60A5FA"
              strokeWidth="2"
            />
            <line
              x1="52"
              y1="32"
              x2="32"
              y2="52"
              stroke="#60A5FA"
              strokeWidth="2"
            />
            <circle cx="32" cy="12" r="6" fill="#2563EB">
              <animate
                attributeName="r"
                values="6;8;6"
                dur="1.2s"
                repeatCount="indefinite"
              />
            </circle>
            <circle cx="12" cy="32" r="5" fill="#3B82F6">
              <animate
                attributeName="r"
                values="5;7;5"
                dur="1.2s"
                begin="0.3s"
                repeatCount="indefinite"
              />
            </circle>
            <circle cx="52" cy="32" r="5" fill="#3B82F6">
              <animate
                attributeName="r"
                values="5;7;5"
                dur="1.2s"
                begin="0.6s"
                repeatCount="indefinite"
              />
            </circle>
            <circle cx="32" cy="52" r="5" fill="#60A5FA">
              <animate
                attributeName="r"
                values="5;7;5"
                dur="1.2s"
                begin="0.9s"
                repeatCount="indefinite"
              />
            </circle>
          </svg>
        </div>
        <AnimatePresence mode="wait">
          {!isPending ? (
            <motion.div
              key="title-creating"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
            >
              <CardTitle className="text-2xl">
                Creating Graph Infrastructure
              </CardTitle>
              <CardDescription>
                Your graph infrastructure domain will be:
              </CardDescription>
            </motion.div>
          ) : (
            <motion.div
              key="title-swarm"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.3 }}
            >
              <CardTitle className="text-2xl">Setting up Swarm</CardTitle>
              <CardDescription>
                Your swarm is being set up. This may take a few minutes.
              </CardDescription>
            </motion.div>
          )}
        </AnimatePresence>
      </CardHeader>

    </Card>
  );
}
