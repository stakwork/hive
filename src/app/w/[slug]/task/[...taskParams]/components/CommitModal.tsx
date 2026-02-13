"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { GitBranch, Loader2, Github } from "lucide-react";

interface CommitModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (commitMessage: string, branchName: string) => Promise<void>;
  initialCommitMessage: string;
  initialBranchName: string;
  isCommitting: boolean;
  isSubsequentCommit?: boolean;
}

export function CommitModal({
  isOpen,
  onClose,
  onConfirm,
  initialCommitMessage,
  initialBranchName,
  isCommitting,
  isSubsequentCommit = false,
}: CommitModalProps) {
  const [commitMessage, setCommitMessage] = useState(initialCommitMessage);
  const [branchName, setBranchName] = useState(initialBranchName);

  // Update local state when initial values change
  useEffect(() => {
    setCommitMessage(initialCommitMessage);
    setBranchName(initialBranchName);
  }, [initialCommitMessage, initialBranchName]);

  const handleConfirm = async () => {
    await onConfirm(commitMessage, branchName);
  };

  // For subsequent commits, validation should not require branch name
  const isValid = isSubsequentCommit 
    ? commitMessage.trim().length > 0
    : commitMessage.trim().length > 0 && branchName.trim().length > 0;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="w-5 h-5" />
            Push to GitHub
          </DialogTitle>
          <DialogDescription>Review details before pushing to your repository</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Branch Name - Hidden for subsequent commits */}
          {!isSubsequentCommit && (
            <div className="space-y-2">
              <Label htmlFor="branch-name" className="flex items-center gap-2 text-sm font-medium">
                <GitBranch className="w-4 h-4" />
                GitHub Branch
              </Label>
              <Input
                id="branch-name"
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                placeholder="feat/my-feature"
                className="font-mono text-sm"
                disabled={isCommitting}
              />
              <p className="text-xs text-muted-foreground">Your changes will be saved to this branch</p>
            </div>
          )}

          {/* Subsequent commit info */}
          {isSubsequentCommit && branchName && (
            <div className="rounded-md bg-muted p-3 text-sm">
              <p className="text-muted-foreground">
                Pushing to existing PR branch: <span className="font-mono text-foreground">{branchName}</span>
              </p>
            </div>
          )}

          {/* Change Description */}
          <div className="space-y-2">
            <Label htmlFor="commit-message" className="text-sm font-medium">
              Change Description
            </Label>
            <Textarea
              id="commit-message"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder="Describe your changes..."
              className="min-h-[120px] resize-none"
              disabled={isCommitting}
            />
            <p className="text-xs text-muted-foreground">Briefly explain what was added or updated</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button variant="outline" onClick={onClose} disabled={isCommitting}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isCommitting || !isValid}>
            {isCommitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Pushing...
              </>
            ) : (
              <>
                <GitBranch className="w-4 h-4 mr-2" />
                Push to GitHub
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
