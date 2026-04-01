"use client";

import { useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { AlertTriangle, Loader2 } from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useWorkspace } from "@/hooks/useWorkspace";
import { WORKSPACE_PERMISSION_LEVELS } from "@/lib/constants";
import { WorkspaceRole } from "@prisma/client";

interface WhiteboardMoveTarget {
  id: string;
  name: string;
  featureId: string | null;
}

interface MoveWhiteboardDialogProps {
  whiteboard: WhiteboardMoveTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMoved: (whiteboardId: string) => void;
}

export function MoveWhiteboardDialog({
  whiteboard,
  open,
  onOpenChange,
  onMoved,
}: MoveWhiteboardDialogProps) {
  const { id: currentWorkspaceId, workspaces } = useWorkspace();
  const [targetWorkspaceId, setTargetWorkspaceId] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const eligibleWorkspaces = workspaces.filter((ws) => {
    if (ws.id === currentWorkspaceId) return false;
    const role = ws.userRole as WorkspaceRole | undefined;
    if (!role) return false;
    return (
      WORKSPACE_PERMISSION_LEVELS[role] >=
      WORKSPACE_PERMISSION_LEVELS[WorkspaceRole.DEVELOPER]
    );
  });

  const handleMove = async () => {
    if (!whiteboard || !targetWorkspaceId) return;

    setLoading(true);
    try {
      const res = await fetch(`/api/whiteboards/${whiteboard.id}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetWorkspaceId }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error ?? "Failed to move whiteboard");
        return;
      }

      const destSlug = data.data?.slug as string;
      onMoved(whiteboard.id);
      onOpenChange(false);
      setTargetWorkspaceId("");

      toast.success("Whiteboard moved", {
        description: (
          <Link
            href={`/w/${destSlug}/whiteboards`}
            className="underline"
          >
            View in destination workspace →
          </Link>
        ),
      });
    } catch {
      toast.error("Failed to move whiteboard");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) setTargetWorkspaceId("");
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Move whiteboard</DialogTitle>
          <DialogDescription>
            Select a workspace to move{" "}
            <span className="font-medium">{whiteboard?.name}</span> to.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {whiteboard?.featureId && (
            <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <span>
                This whiteboard is linked to a feature. Moving it will remove
                that link.
              </span>
            </div>
          )}

          {eligibleWorkspaces.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You have no other workspaces with write access to move this
              whiteboard to.
            </p>
          ) : (
            <Select value={targetWorkspaceId} onValueChange={setTargetWorkspaceId}>
              <SelectTrigger>
                <SelectValue placeholder="Select destination workspace" />
              </SelectTrigger>
              <SelectContent>
                {eligibleWorkspaces.map((ws) => (
                  <SelectItem key={ws.id} value={ws.id}>
                    {ws.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleMove}
            disabled={loading || !targetWorkspaceId}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Move whiteboard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
