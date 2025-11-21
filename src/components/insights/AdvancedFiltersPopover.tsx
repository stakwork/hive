"use client";

import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { SlidersHorizontal, X } from "lucide-react";

interface AdvancedFiltersPopoverProps {
  ignoreDirs: string;
  setIgnoreDirs: (dirs: string) => void;
  repo: string;
  setRepo: (repo: string) => void;
  unitGlob: string;
  setUnitGlob: (glob: string) => void;
  integrationGlob: string;
  setIntegrationGlob: (glob: string) => void;
  e2eGlob: string;
  setE2eGlob: (glob: string) => void;
}

export function AdvancedFiltersPopover({
  ignoreDirs,
  setIgnoreDirs,
  repo,
  setRepo,
  unitGlob,
  setUnitGlob,
  integrationGlob,
  setIntegrationGlob,
  e2eGlob,
  setE2eGlob,
}: AdvancedFiltersPopoverProps) {
  const [open, setOpen] = useState(false);
  const [ignoreDirsInput, setIgnoreDirsInput] = useState(ignoreDirs);
  const [repoInput, setRepoInput] = useState(repo);
  const [unitGlobInput, setUnitGlobInput] = useState(unitGlob);
  const [integrationGlobInput, setIntegrationGlobInput] = useState(integrationGlob);
  const [e2eGlobInput, setE2eGlobInput] = useState(e2eGlob);

  // Sync inputs with store values
  useEffect(() => {
    setIgnoreDirsInput(ignoreDirs);
  }, [ignoreDirs]);

  useEffect(() => {
    setRepoInput(repo);
  }, [repo]);

  useEffect(() => {
    setUnitGlobInput(unitGlob);
  }, [unitGlob]);

  useEffect(() => {
    setIntegrationGlobInput(integrationGlob);
  }, [integrationGlob]);

  useEffect(() => {
    setE2eGlobInput(e2eGlob);
  }, [e2eGlob]);

  // Calculate active filter count
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (ignoreDirs && ignoreDirs.length > 0) count++;
    if (repo && repo.length > 0) count++;
    if (unitGlob && unitGlob.length > 0) count++;
    if (integrationGlob && integrationGlob.length > 0) count++;
    if (e2eGlob && e2eGlob.length > 0) count++;
    return count;
  }, [ignoreDirs, repo, unitGlob, integrationGlob, e2eGlob]);

  const handleApplyIgnoreDirs = () => {
    const cleaned = ignoreDirsInput
      .split(",")
      .map((dir) => dir.trim())
      .filter((dir) => dir.length > 0)
      .join(",");
    if (cleaned !== ignoreDirs) {
      setIgnoreDirs(cleaned);
    }
  };

  const handleApplyRepo = () => {
    const cleaned = repoInput
      .split(",")
      .map((r) => r.trim())
      .filter((r) => r.length > 0)
      .join(",");
    if (cleaned !== repo) {
      setRepo(cleaned);
    }
  };

  const handleApplyUnitGlob = () => {
    const cleaned = unitGlobInput.trim();
    if (cleaned !== unitGlob) {
      setUnitGlob(cleaned);
    }
  };

  const handleApplyIntegrationGlob = () => {
    const cleaned = integrationGlobInput.trim();
    if (cleaned !== integrationGlob) {
      setIntegrationGlob(cleaned);
    }
  };

  const handleApplyE2eGlob = () => {
    const cleaned = e2eGlobInput.trim();
    if (cleaned !== e2eGlob) {
      setE2eGlob(cleaned);
    }
  };

  const handleClearAll = () => {
    setIgnoreDirs("");
    setRepo("");
    setUnitGlob("");
    setIntegrationGlob("");
    setE2eGlob("");
    setIgnoreDirsInput("");
    setRepoInput("");
    setUnitGlobInput("");
    setIntegrationGlobInput("");
    setE2eGlobInput("");
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="relative">
          <SlidersHorizontal className="h-4 w-4" />
          <span>Advanced Filters</span>
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="ml-1.5 h-5 px-1.5 text-xs font-medium">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[440px] p-0" align="start" side="bottom">
        <div className="p-4 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
              <h4 className="font-semibold text-sm">Advanced Filters</h4>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={() => setOpen(false)} className="h-6 w-6">
              <X className="h-4 w-4" />
            </Button>
          </div>

          <Separator />

          {/* Repository Filter */}
          <div className="space-y-2">
            <Label htmlFor="repo-filter" className="text-xs font-medium text-muted-foreground">
              Repository
            </Label>
            <Input
              id="repo-filter"
              type="text"
              placeholder="all, /path/repo1, or /path/repo1,/path/repo2"
              value={repoInput}
              onChange={(e) => setRepoInput(e.target.value)}
              onBlur={handleApplyRepo}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleApplyRepo();
                  e.currentTarget.blur();
                }
              }}
              className="h-9 text-sm"
            />
          </div>

          {/* Ignore Directories */}
          <div className="space-y-2">
            <Label htmlFor="ignore-dirs" className="text-xs font-medium text-muted-foreground">
              Ignore Directories
            </Label>
            <Input
              id="ignore-dirs"
              type="text"
              placeholder="e.g. testing, examples"
              value={ignoreDirsInput}
              onChange={(e) => setIgnoreDirsInput(e.target.value)}
              onBlur={handleApplyIgnoreDirs}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  handleApplyIgnoreDirs();
                  e.currentTarget.blur();
                }
              }}
              className="h-9 text-sm"
            />
          </div>

          <Separator />

          {/* Test Pattern Filters */}
          <div className="space-y-3">
            <Label className="text-xs font-medium text-muted-foreground">Test Pattern Filters (glob)</Label>

            {/* Unit Tests */}
            <div className="space-y-1.5">
              <Label htmlFor="unit-glob" className="text-xs text-muted-foreground">
                Unit
              </Label>
              <Input
                id="unit-glob"
                type="text"
                placeholder="**/*.test.ts, **/*.spec.ts"
                value={unitGlobInput}
                onChange={(e) => setUnitGlobInput(e.target.value)}
                onBlur={handleApplyUnitGlob}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleApplyUnitGlob();
                    e.currentTarget.blur();
                  }
                }}
                className="h-8 text-xs font-mono"
              />
            </div>

            {/* Integration Tests */}
            <div className="space-y-1.5">
              <Label htmlFor="integration-glob" className="text-xs text-muted-foreground">
                Integration
              </Label>
              <Input
                id="integration-glob"
                type="text"
                placeholder="**/integration/*.test.ts"
                value={integrationGlobInput}
                onChange={(e) => setIntegrationGlobInput(e.target.value)}
                onBlur={handleApplyIntegrationGlob}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleApplyIntegrationGlob();
                    e.currentTarget.blur();
                  }
                }}
                className="h-8 text-xs font-mono"
              />
            </div>

            {/* E2E Tests */}
            <div className="space-y-1.5">
              <Label htmlFor="e2e-glob" className="text-xs text-muted-foreground">
                E2E
              </Label>
              <Input
                id="e2e-glob"
                type="text"
                placeholder="**/e2e/**/*.spec.ts"
                value={e2eGlobInput}
                onChange={(e) => setE2eGlobInput(e.target.value)}
                onBlur={handleApplyE2eGlob}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleApplyE2eGlob();
                    e.currentTarget.blur();
                  }
                }}
                className="h-8 text-xs font-mono"
              />
            </div>
          </div>

          <Separator />

          {/* Actions */}
          <div className="flex items-center justify-between pt-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClearAll}
              disabled={activeFilterCount === 0}
              className="text-xs h-8"
            >
              Clear All
            </Button>
            <Button variant="default" size="sm" onClick={() => setOpen(false)} className="text-xs h-8">
              Done
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
