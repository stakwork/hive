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
import { TagInput } from "@/components/ui/tag-input";
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
  const [description, setDescription] = useState("");
  const [promptSnippet, setPromptSnippet] = useState("");
  const [positiveCases, setPositiveCases] = useState<string[]>([]);
  const [negativeCases, setNegativeCases] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function handleClose() {
    setName("");
    setDescription("");
    setPromptSnippet("");
    setPositiveCases([]);
    setNegativeCases([]);
    setErrors({});
    onOpenChange(false);
  }

  function validate() {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "Name is required";
    if (!promptSnippet.trim()) next.promptSnippet = "Prompt snippet is required";
    if (positiveCases.length === 0) next.positiveCases = "At least one positive case is required";
    if (negativeCases.length === 0) next.negativeCases = "At least one negative case is required";
    return { next, posLines: positiveCases, negLines: negativeCases };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { next, posLines, negLines } = validate();
    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const res = await fetch(`/api/workspaces/${slug}/evals/${evalSetId}/requirements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || undefined,
          prompt_snippet: promptSnippet.trim(),
          positive_cases: posLines,
          negative_cases: negLines,
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
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Requirement</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="req-name">
              Name <span className="text-destructive">*</span>
            </label>
            <Input
              id="req-name"
              value={name}
              onChange={(e) => { setName(e.target.value); setErrors((p) => ({ ...p, name: "" })); }}
              placeholder="e.g. Correct auth handling"
            />
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="req-description">
              Description
            </label>
            <Textarea
              id="req-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description..."
              rows={2}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="req-prompt">
              Prompt Snippet <span className="text-destructive">*</span>
            </label>
            <Textarea
              id="req-prompt"
              value={promptSnippet}
              onChange={(e) => { setPromptSnippet(e.target.value); setErrors((p) => ({ ...p, promptSnippet: "" })); }}
              placeholder="The portion of the prompt being evaluated..."
              rows={3}
            />
            {errors.promptSnippet && <p className="text-xs text-destructive">{errors.promptSnippet}</p>}
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="req-positive">
              Positive Cases <span className="text-destructive">*</span>
            </label>
            <TagInput
              id="req-positive"
              items={positiveCases}
              onChange={(items) => { setPositiveCases(items); setErrors((p) => ({ ...p, positiveCases: "" })); }}
              placeholder="The agent correctly..."
              error={errors.positiveCases}
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="req-negative">
              Negative Cases <span className="text-destructive">*</span>
            </label>
            <TagInput
              id="req-negative"
              items={negativeCases}
              onChange={(items) => { setNegativeCases(items); setErrors((p) => ({ ...p, negativeCases: "" })); }}
              placeholder="The agent fails to..."
              error={errors.negativeCases}
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
