"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { Trash2, AlertTriangle } from "lucide-react";

interface DeleteWorkspaceProps {
  workspaceSlug: string;
  workspaceName: string;
}

export function DeleteWorkspace({
  workspaceSlug,
  workspaceName,
}: DeleteWorkspaceProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [confirmationText, setConfirmationText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const router = useRouter();
  const { toast } = useToast();

  const handleDelete = async () => {
    if (confirmationText !== workspaceName) {
      toast({
        title: "Confirmation failed",
        description:
          "Please type the workspace name exactly as shown to confirm deletion.",
        variant: "destructive",
      });
      return;
    }

    setIsDeleting(true);

    try {
      const response = await fetch(`/api/workspaces/${workspaceSlug}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to delete workspace");
      }

      toast({
        title: "Workspace deleted",
        description: "Your workspace has been permanently deleted.",
        variant: "default",
      });

      // Redirect to workspaces page after successful deletion
      router.push("/workspaces");
      router.refresh();
    } catch (error) {
      console.error("Error deleting workspace:", error);
      toast({
        title: "Error",
        description:
          error instanceof Error
            ? error.message
            : "Failed to delete workspace. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
      setIsOpen(false);
      setConfirmationText("");
    }
  };

  const canDelete = confirmationText === workspaceName;

  return (
    <>
      <Card className="border-destructive/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="w-5 h-5" />
            Delete Workspace
          </CardTitle>
          <CardDescription>
            Permanently delete this workspace and all its data. This action
            cannot be undone.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            onClick={() => setIsOpen(true)}
            className="w-full"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete Workspace
          </Button>
        </CardContent>
      </Card>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />
              Delete Workspace
            </DialogTitle>
            <DialogDescription>
              This action cannot be undone. This will permanently delete the
              workspace &ldquo;{workspaceName}&rdquo; and all of its data.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3">
              <p className="text-sm text-destructive">
                <strong>Warning:</strong> This action is irreversible. All data
                will be permanently lost.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmation">
                Type <strong>{workspaceName}</strong> to confirm:
              </Label>
              <Input
                id="confirmation"
                value={confirmationText}
                onChange={(e) => setConfirmationText(e.target.value)}
                placeholder={workspaceName}
                disabled={isDeleting}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsOpen(false);
                setConfirmationText("");
              }}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={!canDelete || isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete Workspace"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
