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
import { Label } from "@/components/ui/label";
import { useWorkspace } from "@/hooks/useWorkspace";
import type { JarvisNode } from "@/types/jarvis";

interface EditRequirementModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  evalSetId: string;
  requirement: JarvisNode;
  onUpdated: () => void;
}

export function EditRequirementModal({
  open,
  onOpenChange,
  evalSetId,
  requirement,
  onUpdated,
}: EditRequirementModalProps) {
  const { slug } = useWorkspace();
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Pre-populate when modal opens or requirement changes
  useEffect(() => {
    if (open) {
      setName(String(requirement.properties?.name ?? ""));
      setReason(String(requirement.properties?.description ?? ""));
      setError("");
    }
  }, [open, requirement]);

  function handleClose() {
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

    // Preserve any legacy prompt_snippet / example cases on the node so editing
    // name + reason doesn't wipe data created before the simplified form.
    const props = requirement.properties ?? {};
    const promptSnippet =
      typeof props.prompt_snippet === "string" ? props.prompt_snippet : undefined;
    const desirableCases = Array.isArray(props.desirable_cases)
      ? props.desirable_cases
      : undefined;
    const undesirableCases = Array.isArray(props.undesirable_cases)
      ? props.undesirable_cases
      : undefined;

    try {
      const res = await fetch(
        `/api/workspaces/${slug}/evals/${evalSetId}/requirements/${requirement.ref_id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            description: reason.trim() || undefined,
            prompt_snippet: promptSnippet,
            desirable_cases: desirableCases,
            undesirable_cases: undesirableCases,
          }),
        },
      );

      if (!res.ok) throw new Error("Request failed");

      toast.success("Requirement updated");
      onUpdated();
      handleClose();
    } catch {
      toast.error("Failed to update requirement");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Requirement</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-req-name">
              Requirement <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="edit-req-name"
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
            <Label htmlFor="edit-req-reason">Reason</Label>
            <Input
              id="edit-req-reason"
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
              {submitting ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
