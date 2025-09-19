import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ErrorDisplay } from "@/components/ui/error-display";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useWorkspace } from "@/hooks/useWorkspace";
import { Repository } from "@/types";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, Loader2 } from "lucide-react";
import { redirect, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SwarmVisualization } from "./swarm-visualization";

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function nextIndexedName(base: string, pool: string[]) {
  const re = new RegExp(`^${escapeRegex(base)}(?:-(\\d+))?$`, "i");
  let max = -1;
  for (const name of pool) {
    const m = name.match(re);
    if (!m) continue;
    const idx = m[1] ? Number(m[1]) : 0; // plain "base" => 0
    if (idx > max) max = idx;
  }
  const next = max + 1;
  return next === 0 ? base : `${base}-${next}`;
}


export function ProjectNameSetupStep() {
  const [error, setError] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);

  const newNamesIsSettled = useRef(false);

  const router = useRouter();

  const [swarmIsLoading, setSwarmIsLoading] = useState<boolean>(false);

  const [projectName, setProjectName] = useState<string>("");
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [infoMessage, setInfoMessage] = useState<string>("");
  const [isLookingForAvailableName, setIsLookingForAvailableName] = useState<boolean>(false);
  const [hasWorkspaceConflict, setHasWorkspaceConflict] = useState<boolean>(false);
  const { refreshWorkspaces, workspaces } = useWorkspace();
  const [selectedRepo, setSelectedRepo] = useState<Repository | null>(null);
  const swarmId = useRef<string>("");
  const [workspaceSlug, setWorkspaceSlug] = useState<string>("");

  const [repositoryUrlDraft, setRepositoryUrlDraft] = useState<string>("");

  useEffect(() => {
    const draft = localStorage.getItem("repoUrl");
    if (draft) {
      setRepositoryUrlDraft(draft);
    }
  }, []);

  useEffect(() => {
    if (!selectedRepo || projectName) return;

    const base = selectedRepo.name.toLowerCase();
    const pool = workspaces.map(w => w.slug.toLowerCase());
    const nextName = nextIndexedName(base, pool)

    setProjectName(nextName);
  }, [selectedRepo, workspaces, setProjectName, projectName]);

  // Check for workspace slug conflicts using API
  useEffect(() => {
    if (!projectName.trim()) {
      setHasWorkspaceConflict(false);
      setInfoMessage("");
      return;
    }

    const checkSlugAvailability = async () => {
      try {
        const response = await fetch(`/api/workspaces/slug-availability?slug=${encodeURIComponent(projectName.trim().toLowerCase())}`);
        const data = await response.json();

        if (response.ok && data.success) {
          const isAvailable = data.data.isAvailable;
          setHasWorkspaceConflict(!isAvailable);

          if (!isAvailable) {
            setInfoMessage("A workspace with this name already exists. Please choose a different name.");
          } else {
            setInfoMessage("");
          }
        } else {
          console.error("Failed to check slug availability:", data.error);
        }
      } catch (error) {
        console.error("Error checking slug availability:", error);
      }
    };

    // Debounce the API call to avoid too many requests
    const timeoutId = setTimeout(checkSlugAvailability, 300);
    return () => clearTimeout(timeoutId);
  }, [projectName]);

  const handleCreateWorkspace = async () => {

    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: projectName.trim().toLowerCase(),
          description: '',
          slug: projectName.trim().toLowerCase(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create workspace");
      }

      if (data?.workspace?.slug && data?.workspace?.id) {
        setWorkspaceSlug(data.workspace.slug);
        setWorkspaceId(data.workspace.id);
        await refreshWorkspaces()
      }

    } catch (error) {
      setError(error instanceof Error ? error.message : "Unknown error");
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

    if (repositoryUrlDraft) {
      fetchRepositories();
    }

  }, [repositoryUrlDraft, setSelectedRepo]);

  useEffect(() => {
    const validateSlug = async () => {
      setIsLookingForAvailableName(true);
      const res = await fetch(`/api/workspaces/slug-availability?slug=${encodeURIComponent(projectName.trim().toLowerCase())}`);
      const data = await res.json();
      if (data.success) {
        if (!data.data.isAvailable) {
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
          newNamesIsSettled.current = true;
          setIsLookingForAvailableName(false);
          setInfoMessage("Available name found");
        }
      } else {
        setError(data.error);
      }
    }

    if (selectedRepo && projectName && !newNamesIsSettled.current) {
      validateSlug();
    }
  }, [selectedRepo, projectName, setProjectName, router, newNamesIsSettled]);

  useEffect(() => {

    const handleCreateSwarm = async () => {

      setSwarmIsLoading(true);
      try {

        const res = await fetch("/api/swarm", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workspaceId: workspaceId,
            name: projectName,
            repositoryName: selectedRepo?.name,
            repositoryUrl: selectedRepo?.html_url,
            repositoryDescription: selectedRepo?.description,
            repositoryDefaultBranch: selectedRepo?.default_branch,
          }),
        });

        const json = await res.json();
        if (!res.ok || !json.success) {
          throw new Error(json.message || "Failed to create swarm");
        }

        console.log(json);

        const { swarmId } = json.data;


        if (swarmId && selectedRepo?.html_url) {
          const servicesRes = await fetch(
            `/api/swarm/stakgraph/services?workspaceId=${encodeURIComponent(
              workspaceId,
            )}&swarmId=${encodeURIComponent(swarmId!)}&repo_url=${encodeURIComponent(selectedRepo?.html_url)}`,
          );

          const data = await servicesRes.json();

          console.log('services', data);

          const ingestRes = await fetch("/api/swarm/stakgraph/ingest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ workspaceId }),
          });

          if (!ingestRes.ok) {
            throw new Error(json.message || "Failed to ingest code");
          }

          const customerRes = await fetch("/api/stakwork/create-customer", {
            method: "POST",
            body: JSON.stringify({
              workspaceId,
            }),
          });

          if (!customerRes.ok) {
            throw new Error(json.message || "Failed to ingest code");
          }

          localStorage.removeItem("repoUrl");
          router.push(`/w/${projectName.trim()}`);
        }

      } catch (error) {
        setError(error instanceof Error ? error.message : "Unknown error");
        throw error;
      }
      finally {
        setSwarmIsLoading(false);
      }
    }

    if (!swarmId.current && projectName && workspaceSlug) {
      handleCreateSwarm();
    }
  }, [projectName, router, selectedRepo?.default_branch, selectedRepo?.description, selectedRepo?.html_url, selectedRepo?.name, swarmId, workspaceId, workspaceSlug]);

  const resetProgress = () => {
    localStorage.removeItem("repoUrl");
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
        <ErrorDisplay error={error} className="mb-4" />
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
          {!swarmIsLoading ? (
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



      <CardContent className="space-y-6">
        {swarmIsLoading ? <SwarmVisualization /> : (
          <>
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
                  {(isLookingForAvailableName || hasWorkspaceConflict) && (
                    <p className={`text-sm ${hasWorkspaceConflict ? 'text-red-500' : 'text-muted-foreground'}`}>
                      {infoMessage}
                      {isLookingForAvailableName && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
                    </p>
                  )}
                  <Input
                    id="graphDomain"
                    placeholder={isLookingForAvailableName ? "Looking for available name..." : "Enter your project name"}
                    value={isLookingForAvailableName ? "" : projectName}
                    className={`mt-2 ${hasWorkspaceConflict ? 'border-red-500 focus:border-red-600 focus:ring-red-500' : ''}`}
                    onChange={(e) => {
                      // Remove spaces and convert to lowercase
                      const value = e.target.value.replace(/\s+/g, '').toLowerCase();
                      setProjectName(value);
                    }}
                  />
                </div>

                <div className="flex justify-between pt-4">

                  <Button variant="outline" type="button" onClick={resetProgress}>
                    Reset
                  </Button>
                  <Button
                    disabled={swarmIsLoading || hasWorkspaceConflict}
                    className="px-8 bg-primary text-primary-foreground hover:bg-primary/90"
                    type="button"
                    onClick={handleCreateWorkspace}
                  >
                    Create
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </>
            )}
          </>
        )}

      </CardContent>

    </Card >
  );
}
