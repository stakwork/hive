"use client";

/**
 * Shared create/edit dialog for `Milestone` rows. Used by:
 *   - The org `OrgInitiatives` table UI (the original consumer).
 *   - The org canvas `+` menu, which intercepts the "Milestone"
 *     option to open this dialog instead of dropping an authored node
 *     (see `src/app/org/[githubLogin]/connections/OrgCanvasBackground.tsx`).
 *
 * The dialog only handles the form. Saving — including which API
 * endpoint to call — is the caller's job. The caller also passes
 * `usedSequences` so the dialog can validate the sequence number
 * client-side before round-tripping.
 */
import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { MilestoneResponse } from "@/types/initiatives";

export interface MilestoneForm {
  name: string;
  description: string;
  status: MilestoneResponse["status"];
  sequence: string;
  dueDate: string;
  completedAt: string;
}

export const emptyMilestoneForm = (
  defaultSequence?: number,
): MilestoneForm => ({
  name: "",
  description: "",
  status: "NOT_STARTED",
  sequence: defaultSequence !== undefined ? String(defaultSequence) : "",
  dueDate: "",
  completedAt: "",
});

export function milestoneToForm(m: MilestoneResponse): MilestoneForm {
  const toDateInput = (v: string | null) =>
    v ? new Date(v).toISOString().split("T")[0] : "";
  return {
    name: m.name,
    description: m.description ?? "",
    status: m.status,
    sequence: String(m.sequence),
    dueDate: toDateInput(m.dueDate),
    completedAt: toDateInput(m.completedAt),
  };
}

export interface MilestoneDialogProps {
  open: boolean;
  onClose: () => void;
  /** When provided, the dialog opens in edit mode and pre-fills the form. */
  initial?: MilestoneResponse | null;
  /**
   * Pre-populate the sequence number on a fresh create. Typically the
   * caller passes `max(existingSequences) + 1` for "append" semantics
   * or a specific slot for "insert before/after."
   */
  defaultSequence?: number;
  /**
   * Sequence numbers already taken in this initiative (excluding the
   * one being edited, when in edit mode). Used for client-side
   * collision validation.
   */
  usedSequences: number[];
  /**
   * Caller-controlled save. Resolve with `{ error?: string }` —
   * non-empty `error` keeps the dialog open and surfaces the message.
   */
  onSave: (form: MilestoneForm) => Promise<{ error?: string }>;
}

export function MilestoneDialog({
  open,
  onClose,
  initial,
  defaultSequence,
  usedSequences,
  onSave,
}: MilestoneDialogProps) {
  const [form, setForm] = useState<MilestoneForm>(emptyMilestoneForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(
        initial ? milestoneToForm(initial) : emptyMilestoneForm(defaultSequence),
      );
      setError(null);
    }
  }, [open, initial, defaultSequence]);

  const set = <K extends keyof MilestoneForm>(
    key: K,
    value: MilestoneForm[K],
  ) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (key === "sequence") setError(null);
  };

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.sequence) return;

    const seqNum = parseInt(form.sequence, 10);
    if (usedSequences.includes(seqNum)) {
      setError("Sequence already in use — choose another number.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const result = await onSave(form);
      if (result.error) {
        setError(result.error);
      } else {
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  const hasSequenceError = !!error;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {initial ? "Edit Milestone" : "Add Milestone"}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="ms-name">Name *</Label>
            <Input
              id="ms-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Milestone name"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ms-desc">Description</Label>
            <Textarea
              id="ms-desc"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Optional description"
              rows={2}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) =>
                  set("status", v as MilestoneForm["status"])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NOT_STARTED">Not Started</SelectItem>
                  <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ms-seq">Sequence *</Label>
              <Input
                id="ms-seq"
                type="number"
                min={1}
                value={form.sequence}
                onChange={(e) => set("sequence", e.target.value)}
                placeholder="e.g. 1"
                className={hasSequenceError ? "border-destructive" : ""}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ms-due">Due Date</Label>
              <Input
                id="ms-due"
                type="date"
                value={form.dueDate}
                onChange={(e) => set("dueDate", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ms-completed">Date Completed</Label>
              <Input
                id="ms-completed"
                type="date"
                value={form.completedAt}
                onChange={(e) => set("completedAt", e.target.value)}
              />
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              !form.name.trim() ||
              !form.sequence ||
              hasSequenceError ||
              saving
            }
          >
            {saving ? "Saving…" : initial ? "Save Changes" : "Add Milestone"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
