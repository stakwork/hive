"use client";

/**
 * Shared create/edit dialog for `Initiative` rows. Used by:
 *   - The org `OrgInitiatives` table UI (the original consumer).
 *   - The org canvas `+` menu, which intercepts the "Initiative"
 *     option to open this dialog instead of dropping an authored node
 *     (see `src/app/org/[githubLogin]/connections/OrgCanvasBackground.tsx`).
 *
 * The dialog only handles the form. Saving — including which API
 * endpoint to call (POST vs PATCH) — is the caller's job. That keeps
 * the dialog reusable for "create" and "edit" without baking in
 * routing knowledge.
 */
import { useEffect, useState } from "react";
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
import type { InitiativeResponse } from "@/types/initiatives";

export interface InitiativeForm {
  name: string;
  description: string;
  status: InitiativeResponse["status"];
  startDate: string;
  targetDate: string;
  completedAt: string;
}

export const emptyInitiativeForm = (): InitiativeForm => ({
  name: "",
  description: "",
  status: "DRAFT",
  startDate: "",
  targetDate: "",
  completedAt: "",
});

export function initiativeToForm(i: InitiativeResponse): InitiativeForm {
  const toDateInput = (v: string | null) =>
    v ? new Date(v).toISOString().split("T")[0] : "";
  return {
    name: i.name,
    description: i.description ?? "",
    status: i.status,
    startDate: toDateInput(i.startDate),
    targetDate: toDateInput(i.targetDate),
    completedAt: toDateInput(i.completedAt),
  };
}

export interface InitiativeDialogProps {
  open: boolean;
  onClose: () => void;
  /** When provided, the dialog opens in edit mode and pre-fills the form. */
  initial?: InitiativeResponse | null;
  /** Caller-controlled save. Resolve to close the dialog. */
  onSave: (form: InitiativeForm) => Promise<void>;
}

export function InitiativeDialog({
  open,
  onClose,
  initial,
  onSave,
}: InitiativeDialogProps) {
  const [form, setForm] = useState<InitiativeForm>(emptyInitiativeForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(initial ? initiativeToForm(initial) : emptyInitiativeForm());
  }, [open, initial]);

  const set = <K extends keyof InitiativeForm>(
    key: K,
    value: InitiativeForm[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {initial ? "Edit Initiative" : "Create Initiative"}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="ini-name">Name *</Label>
            <Input
              id="ini-name"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Initiative name"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ini-desc">Description</Label>
            <Textarea
              id="ini-desc"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Optional description"
              rows={3}
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Status</Label>
            <Select
              value={form.status}
              onValueChange={(v) =>
                set("status", v as InitiativeForm["status"])
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="DRAFT">Draft</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
                <SelectItem value="ARCHIVED">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ini-start">Start Date</Label>
              <Input
                id="ini-start"
                type="date"
                value={form.startDate}
                onChange={(e) => set("startDate", e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ini-target">Target Date</Label>
              <Input
                id="ini-target"
                type="date"
                value={form.targetDate}
                onChange={(e) => set("targetDate", e.target.value)}
              />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ini-completed">Date Completed</Label>
            <Input
              id="ini-completed"
              type="date"
              value={form.completedAt}
              onChange={(e) => set("completedAt", e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!form.name.trim() || saving}
          >
            {saving ? "Saving…" : initial ? "Save Changes" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
