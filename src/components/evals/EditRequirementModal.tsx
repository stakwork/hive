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
import { Switch } from "@/components/ui/switch";
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
  const [contested, setContested] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Pre-populate when modal opens or requirement changes
  useEffect(() => {
    if (open) {
      setName(String(requirement.properties?.name ?? ""));
      setReason(String(requirement.properties?.description ?? ""));
      setContested(Boolean(requirement.properties?.contested));
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

    // Always send the contested value (switch is always shown and pre-populated,
    // so the user's current toggle state is always intentional).
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
            contested,
          }),
        },
      );

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Request failed");
      }

      toast.success("Requirement updated");
      onUpdated();
      handleClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to update requirement",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const contestReason =
    typeof requirement.properties?.contest_reason === "string"
      ? requirement.properties.contest_reason
      : null;

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

          {/* Contested toggle — governs criterion definition, not historical runs */}
          <div className="rounded-md border p-3 space-y-2">
            {contestReason && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  Contest reason (agent-authored, read-only)
                </Label>
                <p
                  className="rounded bg-muted px-2 py-1.5 text-xs text-muted-foreground"
                  data-testid="contest-reason-display"
                >
                  {contestReason}
                </p>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label htmlFor="edit-req-contested" className="text-sm font-medium">
                  Contested
                </Label>
                <p className="text-xs text-muted-foreground">
                  Marks this criterion definition as suspect. Applies to subsequent
                  runs — historical run results are immutable snapshots and are not
                  affected.
                </p>
              </div>
              <Switch
                id="edit-req-contested"
                checked={contested}
                onCheckedChange={setContested}
                data-testid="contested-switch"
              />
            </div>
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
