import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trash2, Plus, CheckCircle, XCircle, Loader2, AlertTriangle, Settings } from "lucide-react";
import { RepositoryData, Repository, FormSectionProps } from "../types";
import { useRepositoryPermissions } from "@/hooks/useRepositoryPermissions";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useState, useEffect, useCallback } from "react";
import { RepositorySettingsModal, type RepositorySyncSettings } from "./RepositorySettingsModal";
import { toast } from "sonner";

interface RepositoryPermissionStatus {
  [index: number]: {
    checking: boolean;
    hasAccess: boolean | null;
    error: string | null;
  };
}

interface SettingsModalStateOpen {
  index: number;
  isNew: boolean;
}

type SettingsModalState = SettingsModalStateOpen | null;

export default function RepositoryForm({
  data,
  errors,
  loading,
  onChange,
}: FormSectionProps<RepositoryData>) {
  const { slug: workspaceSlug } = useWorkspace();
  const {
    permissions,
    loading: permissionLoading,
    error: permissionError,
    message: permissionMessage,
    checkPermissions,
  } = useRepositoryPermissions();
  const [permissionStatus, setPermissionStatus] = useState<RepositoryPermissionStatus>({});
  const [checkingIndex, setCheckingIndex] = useState<number | null>(null);
  
  // State for confirmation dialog
  const [repoToRemove, setRepoToRemove] = useState<number | null>(null);
  
  // State for settings modal
  const [settingsModal, setSettingsModal] = useState<SettingsModalState>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  
  // Track which repos should show settings modal after verify
  const [pendingSettingsIndex, setPendingSettingsIndex] = useState<number | null>(null);

  useEffect(() => {
    if (checkingIndex !== null && !permissionLoading) {
      const wasChecking = checkingIndex;
      setPermissionStatus((prev) => {
        const status = { ...prev };
        status[wasChecking] = {
          checking: false,
          hasAccess: permissionError ? false : (permissions?.hasAccess ?? null),
          error: permissionError,
        };
        return status;
      });
      setCheckingIndex(null);
      
      // If verification succeeded, update branch to the real default branch
      if (!permissionError && permissions?.hasAccess && permissions.repository?.default_branch) {
        const updatedRepos = [...data.repositories];
        updatedRepos[wasChecking] = {
          ...updatedRepos[wasChecking],
          branch: permissions.repository.default_branch,
        };
        onChange({ repositories: updatedRepos });
      }

      // If verification succeeded and this is a new repo, show settings modal
      if (!permissionError && permissions?.hasAccess && pendingSettingsIndex === wasChecking) {
        const repo = data.repositories[wasChecking];
        // Only show modal for repos without an id (new repos)
        if (repo && !repo.id) {
          setSettingsModal({ index: wasChecking, isNew: true });
        }
      }
      setPendingSettingsIndex(null);
    }
  }, [permissions, permissionLoading, permissionError, checkingIndex, pendingSettingsIndex, data.repositories, onChange]);

  const handleAddRepository = () => {
    // Additional repos added via the form default to all sync options disabled
    const newRepo: Repository = {
      repositoryUrl: "",
      branch: "main",
      name: "",
      codeIngestionEnabled: false,
      docsEnabled: false,
      mocksEnabled: false,
      embeddingsEnabled: false,
    };
    onChange({
      repositories: [...data.repositories, newRepo],
    });
  };

  const handleRemoveRepository = useCallback((index: number) => {
    if (data.repositories.length <= 1) return;

    const updatedRepos = data.repositories.filter((_, i) => i !== index);
    const newStatus = { ...permissionStatus };
    delete newStatus[index];

    Object.keys(newStatus).forEach((key) => {
      const numKey = parseInt(key);
      if (numKey > index) {
        newStatus[numKey - 1] = newStatus[numKey];
        delete newStatus[numKey];
      }
    });

    setPermissionStatus(newStatus);
    onChange({ repositories: updatedRepos });
    setRepoToRemove(null);
  }, [data.repositories, permissionStatus, onChange]);

  const handleRepositoryChange = (index: number, field: keyof Repository, value: string) => {
    const updatedRepos = [...data.repositories];
    updatedRepos[index] = { ...updatedRepos[index], [field]: value };
    
    // Auto-infer repository name from URL when URL changes
    if (field === "repositoryUrl" && value) {
      const match = value.match(/\/([^/]+?)(?:\.git)?$/);
      const inferredName = match?.[1]?.replace(/\.git$/i, "") || "";
      updatedRepos[index].name = inferredName;
    }
    
    onChange({ repositories: updatedRepos });

    if (field === "repositoryUrl") {
      const status = { ...permissionStatus };
      status[index] = { checking: false, hasAccess: null, error: null };
      setPermissionStatus(status);
    }
  };

  const handleCheckPermission = async (index: number, url: string) => {
    if (!url || !url.includes("github.com")) return;

    setCheckingIndex(index);
    const status = { ...permissionStatus };
    status[index] = { checking: true, hasAccess: null, error: null };
    setPermissionStatus(status);
    
    // Mark this index to show settings modal after successful verification (for new repos only)
    const repo = data.repositories[index];
    if (!repo.id) {
      setPendingSettingsIndex(index);
    }

    await checkPermissions(url, workspaceSlug);
  };

  const handleSettingsSave = async (settings: RepositorySyncSettings) => {
    if (settingsModal === null) return;
    
    const { index, isNew } = settingsModal;
    const repo = data.repositories[index];
    
    if (isNew) {
      // For new repos, just update local state - will be saved with main form
      const updatedRepos = [...data.repositories];
      updatedRepos[index] = {
        ...updatedRepos[index],
        ...settings,
        triggerPodRepair: settings.triggerPodRepair, // Capture pod repair flag
      };
      onChange({ repositories: updatedRepos });
    } else {
      // For existing repos, save directly to API
      if (!repo.id) return;
      
      setSavingSettings(true);
      try {
        const response = await fetch(`/api/repositories/${repo.id}/settings`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(settings),
        });
        
        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.message || "Failed to save settings");
        }
        
        // Update local state to reflect saved changes
        const updatedRepos = [...data.repositories];
        updatedRepos[index] = {
          ...updatedRepos[index],
          ...settings,
        };
        onChange({ repositories: updatedRepos });
        
        toast.success("Settings saved", {
          description: "Repository sync settings have been updated",
        });
      } catch (error) {
        console.error("Failed to save repository settings:", error);
        toast.error("Failed to save settings", {
          description: error instanceof Error ? error.message : "Please try again",
        });
        throw error; // Re-throw to prevent modal from closing
      } finally {
        setSavingSettings(false);
      }
    }
  };

  const openSettingsModal = (index: number) => {
    const repo = data.repositories[index];
    setSettingsModal({
      index,
      isNew: !repo.id,
    });
  };

  const getPermissionBadge = (index: number) => {
    const status = permissionStatus[index];
    if (!status) return null;

    if (status.checking) {
      return (
        <Badge variant="secondary" className="ml-2">
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          Checking...
        </Badge>
      );
    }

    if (status.error === 'org_mismatch') {
      return (
        <Badge variant="destructive" className="ml-2">
          <XCircle className="h-3 w-3 mr-1" />
          Wrong Organization
        </Badge>
      );
    }

    if (status.error) {
      return (
        <Badge variant="destructive" className="ml-2">
          <XCircle className="h-3 w-3 mr-1" />
          No Access
        </Badge>
      );
    }

    if (status.hasAccess === true) {
      return (
        <Badge variant="default" className="ml-2 bg-green-600 hover:bg-green-700">
          <CheckCircle className="h-3 w-3 mr-1" />
          Access Verified
        </Badge>
      );
    }

    if (status.hasAccess === false) {
      return (
        <Badge variant="destructive" className="ml-2">
          <XCircle className="h-3 w-3 mr-1" />
          Access Denied
        </Badge>
      );
    }

    return null;
  };

  const getRepoDisplayName = (repo: Repository, index: number) => {
    return repo.name || repo.repositoryUrl?.split("/").pop() || `Repository ${index + 1}`;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Repositories</h3>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleAddRepository}
          disabled={loading}
          className="flex items-center gap-2"
        >
          <Plus className="h-4 w-4" />
          Add Repository
        </Button>
      </div>

      <div className="space-y-4">
        {data.repositories.map((repo, index) => (
          <div key={index} className="border rounded-lg p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center">
                <span className="text-sm font-medium text-muted-foreground">Repository {index + 1}</span>
                {getPermissionBadge(index)}
              </div>
              <div className="flex items-center gap-1">
                {/* Settings gear icon - only show if repo has URL */}
                {repo.repositoryUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => openSettingsModal(index)}
                    disabled={loading}
                    className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                    title="Code ingestion settings"
                  >
                    <Settings className="h-4 w-4" />
                  </Button>
                )}
                {/* Delete button */}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setRepoToRemove(index)}
                  disabled={loading || data.repositories.length <= 1}
                  className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`repo-url-${index}`}>Repository URL</Label>
              <div className="flex gap-2">
                <Input
                  id={`repo-url-${index}`}
                  type="url"
                  placeholder="https://github.com/username/repository"
                  value={repo.repositoryUrl}
                  onChange={(e) => handleRepositoryChange(index, "repositoryUrl", e.target.value)}
                  className={errors.repositoryUrl ? "border-destructive" : ""}
                  disabled={loading}
                />
                {repo.repositoryUrl && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleCheckPermission(index, repo.repositoryUrl)}
                    disabled={loading || permissionStatus[index]?.checking}
                  >
                    {permissionStatus[index]?.checking ? <Loader2 className="h-4 w-4 animate-spin" /> : "Verify"}
                  </Button>
                )}
              </div>
              {index === 0 && errors.repositoryUrl && (
                <p className="text-sm text-destructive">{errors.repositoryUrl}</p>
              )}
              {checkingIndex === index && permissionError === 'org_mismatch' && permissionMessage && (
                <p className="text-xs text-destructive mt-1">{permissionMessage}</p>
              )}
              {permissionStatus[index]?.error && permissionStatus[index]?.error !== 'org_mismatch' && (
                <div className="flex items-start gap-2 text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/30 p-2 rounded">
                  <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <span>{permissionStatus[index].error}</span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor={`repo-branch-${index}`}>Branch</Label>
              <Input
                id={`repo-branch-${index}`}
                type="text"
                placeholder="main"
                value={repo.branch}
                onChange={(e) => handleRepositoryChange(index, "branch", e.target.value)}
                className={errors.defaultBranch ? "border-destructive" : ""}
                disabled={loading}
              />
              {index === 0 && errors.defaultBranch && (
                <p className="text-sm text-destructive">{errors.defaultBranch}</p>
              )}
            </div>

            {/* Show sync config summary for repos with settings configured */}
            {repo.repositoryUrl && (repo.codeIngestionEnabled !== undefined) && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
                <span>Ingestion:</span>
                  {repo.codeIngestionEnabled ? (
                  <Badge variant="secondary" className="text-xs py-0 h-5">
                    {[
                      repo.docsEnabled && "Docs",
                      repo.mocksEnabled && "Mocks",
                      repo.embeddingsEnabled && "Embeddings",
                    ].filter(Boolean).join(", ") || "Code only"}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs py-0 h-5">
                    Disabled
                  </Badge>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {data.repositories.length === 0 && (
        <div className="text-center py-8 border-2 border-dashed rounded-lg">
          <p className="text-sm text-muted-foreground mb-3">No repositories added</p>
          <Button type="button" variant="outline" size="sm" onClick={handleAddRepository} disabled={loading}>
            <Plus className="h-4 w-4 mr-2" />
            Add Your First Repository
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        At least one repository is required. Add multiple repositories to include them in your workspace.
      </p>

      {/* Remove Repository Confirmation Dialog */}
      <AlertDialog open={repoToRemove !== null} onOpenChange={(open) => !open && setRepoToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Repository</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to remove{" "}
              <span className="font-medium">
                {repoToRemove !== null ? getRepoDisplayName(data.repositories[repoToRemove], repoToRemove) : "this repository"}
              </span>
              ? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => repoToRemove !== null && handleRemoveRepository(repoToRemove)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Repository Settings Modal */}
      {settingsModal !== null && (
        <RepositorySettingsModal
          open={true}
          onOpenChange={(open) => !open && setSettingsModal(null)}
          repository={data.repositories[settingsModal.index]}
          isNewRepository={settingsModal.isNew}
          onSave={handleSettingsSave}
          loading={savingSettings}
        />
      )}
    </div>
  );
}
