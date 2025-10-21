"use client";

import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { GitBranch, MessageSquare, Loader2 } from "lucide-react";

interface CommitModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (commitMessage: string, branchName: string) => Promise<void>;
  initialCommitMessage: string;
  initialBranchName: string;
  isCommitting: boolean;
}

export function CommitModal({
  isOpen,
  onClose,
  onConfirm,
  initialCommitMessage,
  initialBranchName,
  isCommitting,
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

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="w-5 h-5" />
            Commit Changes
          </DialogTitle>
          <DialogDescription>Review and edit the AI-generated commit message and branch name</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Branch Name */}
          <div className="space-y-2">
            <Label htmlFor="branch-name" className="flex items-center gap-2 text-sm font-medium">
              <GitBranch className="w-4 h-4" />
              Branch Name
            </Label>
            <Input
              id="branch-name"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder="feat/my-feature"
              className="font-mono text-sm"
              disabled={isCommitting}
            />
            <p className="text-xs text-muted-foreground">Follow convention: category/brief-description</p>
          </div>

          {/* Commit Message */}
          <div className="space-y-2">
            <Label htmlFor="commit-message" className="flex items-center gap-2 text-sm font-medium">
              <MessageSquare className="w-4 h-4" />
              Commit Message
            </Label>
            <Textarea
              id="commit-message"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder="Describe your changes..."
              className="min-h-[120px] resize-none"
              disabled={isCommitting}
            />
            <p className="text-xs text-muted-foreground">Write a clear, concise description of the changes</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button variant="outline" onClick={onClose} disabled={isCommitting}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={isCommitting || !commitMessage.trim() || !branchName.trim()}>
            {isCommitting ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Committing...
              </>
            ) : (
              <>
                <GitBranch className="w-4 h-4 mr-2" />
                Commit & Push
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
