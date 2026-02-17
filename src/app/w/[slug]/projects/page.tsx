"use client";

import React, { useState, useEffect } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useRouter } from "next/navigation";
import { Workflow, Plus, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

export default function ProjectsPage() {
  const { slug } = useWorkspace();
  const router = useRouter();
  const [projectId, setProjectId] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [validationState, setValidationState] = useState<"idle" | "valid" | "invalid">("idle");
  const [projectName, setProjectName] = useState("");

  const handleNewProject = () => {
    localStorage.setItem("task_mode", "project_debugger");
    router.push(`/w/${slug}/task/new`);
  };

  const validateProject = async (id: string) => {
    if (!id.trim()) {
      setValidationState("idle");
      setProjectName("");
      return;
    }

    setIsValidating(true);
    setValidationState("idle");

    try {
      const response = await fetch(`/api/stakwork/projects/${id}`);
      const data = await response.json();

      if (response.ok && data.success) {
        setValidationState("valid");
        setProjectName(data.data.project?.name || `Project ${id}`);
      } else {
        setValidationState("invalid");
        setProjectName("");
      }
    } catch (error) {
      setValidationState("invalid");
      setProjectName("");
    } finally {
      setIsValidating(false);
    }
  };

  const handleProjectIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setProjectId(value);
    
    // Reset validation state immediately
    if (!value.trim()) {
      setValidationState("idle");
      setProjectName("");
    }
  };

  // Debounce validation effect
  useEffect(() => {
    if (projectId.trim()) {
      const timeoutId = setTimeout(() => validateProject(projectId), 500);
      return () => clearTimeout(timeoutId);
    }
  }, [projectId]);

  const handleOpenProject = () => {
    if (validationState === "valid" && projectId.trim()) {
      localStorage.setItem("task_mode", "project_debugger");
      router.push(`/w/${slug}/task/new?projectId=${projectId}&projectName=${encodeURIComponent(projectName)}`);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        icon={Workflow}
        description="Debug and manage Stakwork projects"
        actions={
          <Button onClick={handleNewProject}>
            <Plus className="w-4 h-4 mr-2" />
            New Project
          </Button>
        }
      />

      <Card className="p-6 max-w-2xl">
        <div className="space-y-4">
          <div>
            <label htmlFor="project-id" className="block text-sm font-medium mb-2">
              Enter Project ID
            </label>
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Input
                  id="project-id"
                  type="text"
                  placeholder="e.g., 141652040"
                  value={projectId}
                  onChange={handleProjectIdChange}
                  className="pr-10"
                />
                {isValidating && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
                )}
                {!isValidating && validationState === "valid" && (
                  <CheckCircle2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-green-600" />
                )}
                {!isValidating && validationState === "invalid" && (
                  <AlertCircle className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-amber-600" />
                )}
              </div>
              <Button
                onClick={handleOpenProject}
                disabled={validationState !== "valid"}
              >
                Open
              </Button>
            </div>
          </div>

          {validationState === "valid" && projectName && (
            <div className="flex items-center gap-2 text-sm text-green-600">
              <CheckCircle2 className="h-4 w-4" />
              <span>{projectName}</span>
            </div>
          )}

          {validationState === "invalid" && (
            <div className="flex items-center gap-2 text-sm text-amber-600">
              <AlertCircle className="h-4 w-4" />
              <span>Project not found</span>
            </div>
          )}
        </div>
      </Card>

      <Card className="p-6 max-w-2xl">
        <div className="space-y-2">
          <h3 className="font-semibold text-sm">What is a Project?</h3>
          <p className="text-sm text-muted-foreground">
            Projects in Stakwork represent specific workflows with associated data and transitions. 
            Enter a project ID to debug and manage its execution.
          </p>
        </div>
      </Card>
    </div>
  );
}
