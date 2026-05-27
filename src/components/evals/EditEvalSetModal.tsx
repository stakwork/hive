import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { JarvisNode } from "@/types/jarvis";

interface EditEvalSetModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  evalSet: JarvisNode;
  onUpdated: () => void;
}

export function EditEvalSetModal({
  open,
  onOpenChange,
  evalSet,
  onUpdated,
}: EditEvalSetModalProps) {
  const { slug } = useWorkspace();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Pre-populate when modal opens or evalSet changes
  useEffect(() => {
    if (open) {
      setName(String(evalSet.properties?.name ?? ""));
      setDescription(String(evalSet.properties?.description ?? ""));
    }
  }, [open, evalSet]);

  function handleClose() {
    onOpenChange(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);
    try {
      const res = await fetch(`/api/workspaces/${slug}/evals/${evalSet.ref_id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
        }),
      });

      if (!res.ok) {
        throw new Error("Request failed");
      }

      toast.success("Eval set updated");
      onUpdated();
      handleClose();
    } catch {
      toast.error("Failed to update eval set");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Eval Set</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="edit-eval-set-name">
              Name <span className="text-destructive">*</span>
            </label>
            <Input
              id="edit-eval-set-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Code Quality Evals"
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="edit-eval-set-description">
              Description
            </label>
            <Textarea
              id="edit-eval-set-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || submitting}>
              {submitting ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
