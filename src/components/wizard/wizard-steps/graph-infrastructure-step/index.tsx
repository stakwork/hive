// No hooks needed
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { useWizardStore } from "@/stores/useWizardStore";
import { sanitizeWorkspaceName } from "@/utils/repositoryParser";

interface GraphInfrastructureStepProps {
  onNext: () => void;
  onBack: () => void;
}

export function GraphInfrastructureStep({
  onNext,
  onBack,
}: GraphInfrastructureStepProps) {
  const swarmId = useWizardStore((s) => s.swarmId);
  const swarmName = useWizardStore((s) => s.swarmName);
  const projectName = useWizardStore((s) => s.projectName);
  const graphDomain = sanitizeWorkspaceName(projectName);
  const setCurrentStepStatus = useWizardStore((s) => s.setCurrentStepStatus);
  const currentStepStatus = useWizardStore((s) => s.currentStepStatus);
  const createSwarm = useWizardStore((s) => s.createSwarm);

  const isPending = currentStepStatus === "PENDING";


  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const handleCreate = async () => {
    try {
      await createSwarm();
    } catch (error) {
      setCurrentStepStatus('FAILED');
      throw error;
    }
  };

  const handleComplete = useCallback(() => {
    setCurrentStepStatus('COMPLETED');
    onNext();
  }, [onNext, setCurrentStepStatus]);

  // Swarm polling effect
  useEffect(() => {
    if (swarmId) {
      pollIntervalRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/swarm/poll?id=${swarmId}`);
          const data = await res.json();
          if (data.status === 'ACTIVE') {
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
            }
            handleComplete()
          }
        } catch {
          setCurrentStepStatus('FAILED');
          if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        }
      }, 3000);
      return () => {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      };
    }
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [swarmId, handleComplete]);



  return (
    <Card className="max-w-2xl mx-auto bg-card text-card-foreground">
      <CardHeader className="text-center">
        <div className="flex items-center justify-center mx-auto mb-4">
          {/* Animated Knowledge Graph SVG */}
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            {/* Edges */}
            <line x1="32" y1="12" x2="12" y2="32" stroke="#60A5FA" strokeWidth="2" />
            <line x1="32" y1="12" x2="52" y2="32" stroke="#60A5FA" strokeWidth="2" />
            <line x1="12" y1="32" x2="32" y2="52" stroke="#60A5FA" strokeWidth="2" />
            <line x1="52" y1="32" x2="32" y2="52" stroke="#60A5FA" strokeWidth="2" />
            {/* Nodes with animation */}
            <circle cx="32" cy="12" r="6" fill="#2563EB">
              <animate attributeName="r" values="6;8;6" dur="1.2s" repeatCount="indefinite" />
            </circle>
            <circle cx="12" cy="32" r="5" fill="#3B82F6">
              <animate attributeName="r" values="5;7;5" dur="1.2s" begin="0.3s" repeatCount="indefinite" />
            </circle>
            <circle cx="52" cy="32" r="5" fill="#3B82F6">
              <animate attributeName="r" values="5;7;5" dur="1.2s" begin="0.6s" repeatCount="indefinite" />
            </circle>
            <circle cx="32" cy="52" r="5" fill="#60A5FA">
              <animate attributeName="r" values="5;7;5" dur="1.2s" begin="0.9s" repeatCount="indefinite" />
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
              <CardTitle className="text-2xl">Creating Graph Infrastructure</CardTitle>
              <CardDescription>Your graph infrastructure domain will be:</CardDescription>
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
              <CardDescription>Your swarm is being set up. This may take a few minutes.</CardDescription>
            </motion.div>
          )}
        </AnimatePresence>
      </CardHeader>
      <CardContent className="space-y-6">
        <div>
          <Label htmlFor="graphDomain" className="text-sm font-medium text-foreground">
            Graph Domain
          </Label>
          <Input
            id="graphDomain"
            value={swarmName || `${graphDomain}.sphinx.chat`}
            readOnly
            tabIndex={-1}
            className="mt-2 bg-muted cursor-not-allowed select-all focus:outline-none focus:ring-0 hover:bg-muted"
            style={{ pointerEvents: 'none' }}
          />
        </div>
        <div className="flex justify-between pt-4">


          {!swarmId && (
            <>
              <Button variant="outline" type="button" onClick={onBack}>
                Back
              </Button>
              <Button className="px-8 bg-primary text-primary-foreground hover:bg-primary/90" type="button" onClick={handleCreate}>
                Create
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </>
          )}
          {swarmId && (
            <div className="flex flex-col items-end gap-2 w-full">
              <Button
                className={`mt-2 ml-auto px-8 bg-muted text-muted-foreground`}
                type="button"
                disabled
              >
                Generating Swarm...
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}