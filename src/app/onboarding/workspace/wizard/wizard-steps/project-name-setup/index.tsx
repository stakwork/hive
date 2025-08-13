import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWizardStore } from "@/stores/useWizardStore";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Loader2 } from "lucide-react";
import { redirect, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { SwarmVisualization } from "./swarm-visualization";


export function ProjectNameSetupStep() {
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const swarmId = useWizardStore((s) => s.swarmId);

  const router = useRouter();

  const setCurrentStepStatus = useWizardStore((s) => s.setCurrentStepStatus);
  const currentStepStatus = useWizardStore((s) => s.currentStepStatus);
  const swarmIsLoading = useWizardStore((s) => s.swarmIsLoading);
  const repositoryUrlDraft = useWizardStore((s) => s.repositoryUrlDraft);
  const setWorkspaceId = useWizardStore((s) => s.setWorkspaceId);
  const setHasKey = useWizardStore((s) => s.setHasKey);
  const workspaceSlug = useWizardStore((s) => s.workspaceSlug);
  const workspaceId = useWizardStore((s) => s.workspaceId);
  const createSwarm = useWizardStore((s) => s.createSwarm);
  const selectedRepo = useWizardStore((s) => s.selectedRepo);
  const setWorkspaceSlug = useWizardStore((s) => s.setWorkspaceSlug);
  const projectName = useWizardStore((s) => s.projectName);
  const setProjectName = useWizardStore((s) => s.setProjectName);
  const setSelectedRepo = useWizardStore((s) => s.setSelectedRepo);
  const resetWizard = useWizardStore((s) => s.resetWizard);
  const [infoMessage, setInfoMessage] = useState<string>("");
  const [isLookingForAvailableName, setIsLookingForAvailableName] = useState<boolean>(false);
  const { refreshWorkspaces } = useWorkspace();
  const isPending = currentStepStatus === "PENDING";

  useEffect(() => {
    if (selectedRepo) {
      setProjectName(selectedRepo.name);
    }
  }, [selectedRepo, setProjectName]);

  const handleCreate = async () => {

    setCurrentStepStatus("PENDING");
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: projectName.trim(),
          description: '',
          slug: projectName.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create workspace");
      }

      if (data?.workspace?.slug && data?.workspace?.id) {
        setWorkspaceSlug(data.workspace.slug);
        setWorkspaceId(data.workspace.id);
        setHasKey(data.workspace.hasKey);
        refreshWorkspaces()
      }

    } catch (error) {
      setError(error instanceof Error ? error.message : "Unknown error");
      setCurrentStepStatus("FAILED");
      throw error;
    }
  };

  useEffect(() => {
    const fetchRepositories = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(`/api/github/repository?repoUrl=${repositoryUrlDraft}`);
        console.log('response', response)
        const { data, error } = await response.json();
        if (response.ok) {
          if (data) {
            setSelectedRepo(data);
          }
        } else {
          const message = error;
          const err = new Error(message) as Error
          throw err;
        }
      } catch (error) {
        setError(error instanceof Error ? error.message : "Unknown error");
      } finally {
        setIsLoading(false);
      }
    };

    fetchRepositories();
  }, [repositoryUrlDraft, setSelectedRepo]);

  useEffect(() => {
    const validateUri = async () => {
      setIsLookingForAvailableName(true);
      const res = await fetch(`/api/swarm/validate?uri=${projectName}.sphinx.chat`);
      const data = await res.json();
      if (data.success) {
        if (data.data.domain_exists || data.data.swarm_name_exist) {
          setInfoMessage("Looking for available project name...");
          const nameEnding = projectName.split("-").pop() || '';
          const nameHasNumber = /^-?\d+$/.test(nameEnding);

          let newProjectName = '';
          if (nameHasNumber) {
            newProjectName = projectName.replace(nameEnding, `${parseInt(nameEnding) + 1}`);
          } else {
            newProjectName = `${projectName}-1`;
          }

          setProjectName(newProjectName);
        } else {
          setIsLookingForAvailableName(false);
          setInfoMessage("Available name found");
        }
      } else {
        setError(data.message);
      }
    }

    if (selectedRepo && projectName) {
      validateUri();
    }
  }, [workspaceSlug, workspaceId, selectedRepo, projectName, setProjectName, router]);

  useEffect(() => {

    const handleCreateSwarm = async () => {
      try {
        await createSwarm();
        localStorage.removeItem("repoUrl");
        router.push(`/w/${projectName.trim()}/code-graph`);
      } catch (error) {
        setError(error instanceof Error ? error.message : "Unknown error");
        setCurrentStepStatus("FAILED");
        throw error;
      }
    }

    if (!swarmId && workspaceSlug && workspaceId && projectName) {
      handleCreateSwarm();
    }
  }, [createSwarm, projectName, router, setCurrentStepStatus, swarmId, workspaceId, workspaceSlug]);

  const resetProgress = () => {
    localStorage.removeItem("repoUrl");
    resetWizard();
    redirect("/");
  }


  return isLoading ? (
    <div className="flex justify-center items-center h-full">
      <Loader2 className="w-8 h-8 animate-spin" />
      <p className="text-muted-foreground">
        Syncing repository...
      </p>
    </div>
  ) : (
    <Card className="max-w-2xl mx-auto bg-card text-card-foreground">
      <CardHeader className="text-center">
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
                Your project name will be:
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
              <CardTitle className="text-2xl">{swarmIsLoading ? "Your swarm is being set up. This may take a few minutes." : "Setting up your new Project name"}</CardTitle>
            </motion.div>
          )}
        </AnimatePresence>
      </CardHeader>

      {swarmIsLoading ? <SwarmVisualization /> : (

        <CardContent className="space-y-6">
          {error ? (
            <>
              <div className="flex justify-center items-center text-red-500">{error}</div>
              <Button className="mt-2 m-auto px-8 bg-muted text-muted-foreground" variant="outline" type="button" onClick={resetProgress}>
                Reset
              </Button>
            </>
          ) : (
            <>
              <div>
                <Label
                  htmlFor="graphDomain"
                  className="text-sm font-medium text-foreground"
                >
                  Graph Domain
                </Label>
                {isLookingForAvailableName && <p className="text-sm text-muted-foreground">
                  {infoMessage}
                  <Loader2 className="w-4 h-4 animate-spin" />
                </p>}
                <Input
                  id="graphDomain"
                  placeholder={isLookingForAvailableName ? "Looking for available name..." : "Enter your project name"}
                  value={isLookingForAvailableName ? "" : projectName}
                  readOnly
                  tabIndex={-1}
                  className="mt-2 bg-muted cursor-not-allowed select-all focus:outline-none focus:ring-0 hover:bg-muted"
                  style={{ pointerEvents: "none" }}
                />
              </div>

              <div className="flex justify-between pt-4">
                {!swarmId ? (
                  <>

                    <Button variant="outline" type="button" onClick={resetProgress}>
                      Reset
                    </Button>
                    <Button
                      disabled={swarmIsLoading}
                      className="px-8 bg-primary text-primary-foreground hover:bg-primary/90"
                      type="button"
                      onClick={handleCreate}
                    >
                      Create
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </>
                ) : (
                  <div className="flex flex-col items-end gap-2 w-full">
                    <Button
                      className="mt-2 ml-auto px-8 bg-muted text-muted-foreground"
                      type="button"
                      disabled
                    >
                      Generating Swarm...
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      )}

    </Card>
  );
}
