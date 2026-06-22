import { useState } from "react";
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
import { Label } from "@/components/ui/label";
import { useWorkspace } from "@/hooks/useWorkspace";

interface CreateRequirementModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  evalSetId: string;
  order: number;
  onCreated: () => void;
}

export function CreateRequirementModal({
  open,
  onOpenChange,
  evalSetId,
  order,
  onCreated,
}: CreateRequirementModalProps) {
  const { slug } = useWorkspace();
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function handleClose() {
    setName("");
    setReason("");
    setError("");
    onOpenChange(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Requirement is required");
      return;
    }
    setError("");
    setSubmitting(true);
    try {
      const res = await fetch(`/api/workspaces/${slug}/evals/${evalSetId}/requirements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: reason.trim() || undefined,
          order,
        }),
      });

      if (!res.ok) throw new Error("Request failed");

      toast.success("Requirement added");
      onCreated();
      handleClose();
    } catch {
      toast.error("Failed to add requirement");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Requirement</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="req-name">
              Requirement <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="req-name"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError("");
              }}
              placeholder="What should the agent always do?"
              rows={2}
              autoFocus
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="req-reason">Reason</Label>
            <Input
              id="req-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why does this matter?"
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={handleClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Adding..." : "Add Requirement"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
