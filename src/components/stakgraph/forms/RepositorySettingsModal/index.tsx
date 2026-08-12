"use client";

import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Loader2, Database, FileText, Copy, Layers, RefreshCw, GitBranch, Filter } from "lucide-react";
import type { Repository } from "../../types";

export interface RepositorySyncSettings {
  codeIngestionEnabled: boolean;
  docsEnabled: boolean;
  mocksEnabled: boolean;
  embeddingsEnabled: boolean;
  triggerPodRepair: boolean;
  shallowClone: boolean;
  blobSizeLimit: string;
}

interface RepositorySettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  repository: Repository;
  isNewRepository: boolean;
  onSave: (settings: RepositorySyncSettings) => Promise<void>;
  loading?: boolean;
}

const BLOB_SIZE_LIMIT_REGEX = /^[1-9][0-9]*[kmg]?$/i;

function isValidBlobSizeLimit(value: string): boolean {
  return value === "" || BLOB_SIZE_LIMIT_REGEX.test(value);
}

export function RepositorySettingsModal({
  open,
  onOpenChange,
  repository,
  isNewRepository,
  onSave,
  loading = false,
}: RepositorySettingsModalProps) {
  const [settings, setSettings] = useState<RepositorySyncSettings>({
    codeIngestionEnabled: repository.codeIngestionEnabled ?? true,
    docsEnabled: repository.docsEnabled ?? true,
    mocksEnabled: repository.mocksEnabled ?? false,
    embeddingsEnabled: repository.embeddingsEnabled ?? true,
    triggerPodRepair: repository.triggerPodRepair ?? false,
    shallowClone: repository.shallowClone ?? false,
    blobSizeLimit: repository.blobSizeLimit ?? "",
  });
  const [isSaving, setIsSaving] = useState(false);

  // Reset settings when repository changes
  useEffect(() => {
    setSettings({
      codeIngestionEnabled: repository.codeIngestionEnabled ?? true,
      docsEnabled: repository.docsEnabled ?? true,
      mocksEnabled: repository.mocksEnabled ?? false,
      embeddingsEnabled: repository.embeddingsEnabled ?? true,
      triggerPodRepair: repository.triggerPodRepair ?? false,
      shallowClone: repository.shallowClone ?? false,
      blobSizeLimit: repository.blobSizeLimit ?? "",
    });
  }, [repository, isNewRepository]);

  const blobSizeLimitValid = isValidBlobSizeLimit(settings.blobSizeLimit);
  const canSave = blobSizeLimitValid;

  const handleSave = async () => {
    if (!canSave) return;
    setIsSaving(true);
    try {
      await onSave(settings);
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCodeIngestionChange = (enabled: boolean) => {
    setSettings((prev) => ({
      ...prev,
      codeIngestionEnabled: enabled,
      // When disabling code ingestion, also disable docs, mocks, and embeddings
      ...(enabled ? {} : { docsEnabled: false, mocksEnabled: false, embeddingsEnabled: false }),
    }));
  };

  const repoName = repository.name || repository.repositoryUrl?.split("/").pop() || "Repository";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Code Ingestion Settings</DialogTitle>
          <DialogDescription>
            Configure how <span className="font-medium">{repoName}</span> is processed
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <RefreshCw className="h-5 w-5 text-muted-foreground" />
              <div className="space-y-0.5">
                <Label htmlFor="trigger-pod-repair" className="text-sm font-medium">
                  Re-configure Pod Services
                </Label>
                <p className="text-xs text-muted-foreground">
                  Regenerate PM2/Docker files to include this repository
                </p>
              </div>
            </div>
            <Switch
              id="trigger-pod-repair"
              checked={settings.triggerPodRepair}
              onCheckedChange={(checked) =>
                setSettings((prev) => ({ ...prev, triggerPodRepair: checked }))
              }
              disabled={loading || isSaving}
            />
          </div>

          {/* Code Ingestion Toggle - Main toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Database className="h-5 w-5 text-muted-foreground" />
              <div className="space-y-0.5">
                <Label htmlFor="code-ingestion" className="text-sm font-medium">
                  Code Ingestion
                </Label>
                <p className="text-xs text-muted-foreground">
                  Sync code to stakgraph for AI analysis
                </p>
              </div>
            </div>
            <Switch
              id="code-ingestion"
              checked={settings.codeIngestionEnabled}
              onCheckedChange={handleCodeIngestionChange}
              disabled={loading || isSaving}
            />
          </div>

          {/* Sub-options - only shown when code ingestion is enabled */}
          {settings.codeIngestionEnabled && (
            <div className="ml-8 space-y-4 border-l-2 border-muted pl-4">
              {/* Docs Toggle */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <div className="space-y-0.5">
                    <Label htmlFor="docs-enabled" className="text-sm font-medium">
                      Generate Docs
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Auto-generate documentation on sync
                    </p>
                  </div>
                </div>
                <Switch
                  id="docs-enabled"
                  checked={settings.docsEnabled}
                  onCheckedChange={(checked) =>
                    setSettings((prev) => ({ ...prev, docsEnabled: checked }))
                  }
                  disabled={loading || isSaving}
                />
              </div>

              {/* Mocks Toggle */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Copy className="h-4 w-4 text-muted-foreground" />
                  <div className="space-y-0.5">
                    <Label htmlFor="mocks-enabled" className="text-sm font-medium">
                      Generate Mocks
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Take inventory of mocks on sync
                    </p>
                  </div>
                </div>
                <Switch
                  id="mocks-enabled"
                  checked={settings.mocksEnabled}
                  onCheckedChange={(checked) =>
                    setSettings((prev) => ({ ...prev, mocksEnabled: checked }))
                  }
                  disabled={loading || isSaving}
                />
              </div>

              {/* Embeddings Toggle */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Layers className="h-4 w-4 text-muted-foreground" />
                  <div className="space-y-0.5">
                    <Label htmlFor="embeddings-enabled" className="text-sm font-medium">
                      Generate Embeddings
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Generate code descriptions for semantic search
                    </p>
                  </div>
                </div>
                <Switch
                  id="embeddings-enabled"
                  checked={settings.embeddingsEnabled}
                  onCheckedChange={(checked) =>
                    setSettings((prev) => ({ ...prev, embeddingsEnabled: checked }))
                  }
                  disabled={loading || isSaving}
                />
              </div>

              {/* Shallow Clone Toggle */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <GitBranch className="h-4 w-4 text-muted-foreground" />
                  <div className="space-y-0.5">
                    <Label htmlFor="shallow-clone" className="text-sm font-medium">
                      Shallow Clone
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Fetch only the latest commit (--depth 1)
                    </p>
                  </div>
                </div>
                <Switch
                  id="shallow-clone"
                  checked={settings.shallowClone}
                  onCheckedChange={(checked) =>
                    setSettings((prev) => ({ ...prev, shallowClone: checked }))
                  }
                  disabled={loading || isSaving}
                />
              </div>

              {/* Per-file Size Limit Input */}
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <Filter className="h-4 w-4 text-muted-foreground" />
                  <div className="space-y-0.5">
                    <Label htmlFor="blob-size-limit" className="text-sm font-medium">
                      Per-file Size Limit
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Skip blobs larger than this (e.g. 1m, 500k). Leave empty for no limit.
                    </p>
                  </div>
                </div>
                <Input
                  id="blob-size-limit"
                  value={settings.blobSizeLimit}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, blobSizeLimit: e.target.value }))
                  }
                  placeholder="e.g. 1m"
                  disabled={loading || isSaving}
                  className={!blobSizeLimitValid ? "border-destructive focus-visible:ring-destructive" : ""}
                  aria-describedby={!blobSizeLimitValid ? "blob-size-limit-error" : undefined}
                />
                {!blobSizeLimitValid && (
                  <p id="blob-size-limit-error" className="text-xs text-destructive">
                    Invalid size format. Use a number followed by k, m, or g (e.g. 500k, 1m, 2g).
                  </p>
                )}
              </div>
            </div>
          )}

          {!settings.codeIngestionEnabled && (
            <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">
              With code ingestion disabled, this repository will still be cloned on pods but won&apos;t be indexed for AI analysis.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading || isSaving || !canSave}>
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : isNewRepository ? (
              "Continue"
            ) : (
              "Save Settings"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default RepositorySettingsModal;
