"use client";

import { useState, useEffect } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

interface CreateFeatureModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLaunchPlan: (title: string, description: string) => Promise<void>;
  onLaunchTask: (title: string, description: string) => Promise<void>;
  isLaunching: boolean;
  extractedData: { title: string; description: string } | null;
  isExtracting: boolean;
  extractError: string | null;
  onRetryExtract: () => void;
}

export function CreateFeatureModal({
  open,
  onOpenChange,
  onLaunchPlan,
  onLaunchTask,
  isLaunching,
  extractedData,
  isExtracting,
  extractError,
  onRetryExtract,
}: CreateFeatureModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  // Populate editable fields when extraction completes
  useEffect(() => {
    if (extractedData) {
      setTitle(extractedData.title);
      setDescription(extractedData.description);
    }
  }, [extractedData]);

  // Reset local fields when modal closes
  useEffect(() => {
    if (!open) {
      setTitle("");
      setDescription("");
    }
  }, [open]);

  const handleClose = () => {
    if (!isLaunching) {
      onOpenChange(false);
    }
  };

  const canLaunch = !isExtracting && !extractError && !!extractedData && title.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[525px] z-100">
        <DialogHeader>
          <DialogTitle>Generate Plan</DialogTitle>
          <DialogDescription>
            {isExtracting
              ? "Extracting details from your conversation…"
              : extractError
              ? "There was a problem extracting the details. You can retry or close."
              : "Review and edit the extracted title and description, then choose how to launch."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Title field */}
          <div className="grid gap-2">
            <Label htmlFor="feature-title">Title</Label>
            {isExtracting ? (
              <Skeleton className="h-8 w-full" />
            ) : (
              <Input
                id="feature-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={isLaunching || !!extractError}
                placeholder="Plan title"
              />
            )}
          </div>

          {/* Description field */}
          <div className="grid gap-2">
            <Label htmlFor="feature-description">Description</Label>
            {isExtracting ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <Textarea
                id="feature-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                disabled={isLaunching || !!extractError}
                placeholder="Brief description for the feature"
                rows={4}
                className="resize-none"
              />
            )}
          </div>

          {/* Error state */}
          {extractError && (
            <div className="flex items-center justify-between rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <span>{extractError}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onRetryExtract}
                className="ml-2 text-destructive hover:text-destructive"
              >
                Retry
              </Button>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row items-center justify-between sm:justify-between">
          {/* Cancel — left side */}
          <Button
            type="button"
            variant="outline"
            onClick={handleClose}
            disabled={isLaunching}
          >
            Cancel
          </Button>

          {/* Split-button CTA — right side */}
          <div className="flex items-center">
            <Button
              type="button"
              disabled={!canLaunch || isLaunching}
              className="rounded-r-none"
              onClick={() => onLaunchPlan(title.trim(), description.trim())}
            >
              {isLaunching ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Launching…
                </>
              ) : (
                "Launch Plan Mode"
              )}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  disabled={!canLaunch || isLaunching}
                  className="rounded-l-none border-l border-primary-foreground/20 px-2"
                  aria-label="More launch options"
                >
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="z-[200]">
                <DropdownMenuItem
                  onClick={() => onLaunchTask(title.trim(), description.trim())}
                >
                  Launch as Task
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
