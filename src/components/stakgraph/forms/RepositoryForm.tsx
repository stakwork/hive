import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus, CheckCircle, XCircle, Loader2, AlertTriangle } from "lucide-react";
import { RepositoryData, Repository, FormSectionProps } from "../types";
import { useRepositoryPermissions } from "@/hooks/useRepositoryPermissions";
import { useState, useEffect } from "react";

interface RepositoryPermissionStatus {
  [index: number]: {
    checking: boolean;
    hasAccess: boolean | null;
    error: string | null;
  };
}

export default function RepositoryForm({ data, errors, loading, onChange }: FormSectionProps<RepositoryData>) {
  const {
    permissions,
    loading: permissionLoading,
    error: permissionError,
    checkPermissions,
  } = useRepositoryPermissions();
  const [permissionStatus, setPermissionStatus] = useState<RepositoryPermissionStatus>({});
  const [checkingIndex, setCheckingIndex] = useState<number | null>(null);

  useEffect(() => {
    if (checkingIndex !== null && !permissionLoading) {
      setPermissionStatus((prev) => {
        const status = { ...prev };
        status[checkingIndex] = {
          checking: false,
          hasAccess: permissionError ? false : (permissions?.hasAccess ?? null),
          error: permissionError,
        };
        return status;
      });
      setCheckingIndex(null);
    }
  }, [permissions, permissionLoading, permissionError, checkingIndex]);

  const handleAddRepository = () => {
    const newRepo: Repository = {
      repositoryUrl: "",
      branch: "main",
      name: "",
    };
    onChange({
      repositories: [...data.repositories, newRepo],
    });
  };

  const handleRemoveRepository = (index: number) => {
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
  };

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

    await checkPermissions(url);
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
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleRemoveRepository(index)}
                disabled={loading || data.repositories.length <= 1}
                className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
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
              {permissionStatus[index]?.error && (
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
    </div>
  );
}
