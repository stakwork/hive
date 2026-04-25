"use client";

import { useEffect, useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { formatRelativeOrDate } from "@/lib/date-utils";
import type { InitiativeResponse, MilestoneResponse } from "@/types/initiatives";
import { ChevronDown, ChevronRight, Link2, Pencil, Plus, Trash2, X } from "lucide-react";
import { LinkFeatureModal } from "./LinkFeatureModal";

// ─── Badge helpers ────────────────────────────────────────────────────────────

function InitiativeStatusBadge({ status }: { status: InitiativeResponse["status"] }) {
  const map: Record<InitiativeResponse["status"], { label: string; className: string }> = {
    DRAFT: { label: "Draft", className: "bg-muted text-muted-foreground" },
    ACTIVE: { label: "Active", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
    COMPLETED: { label: "Completed", className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
    ARCHIVED: { label: "Archived", className: "bg-muted/50 text-muted-foreground/60" },
  };
  const { label, className } = map[status];
  return <Badge className={`${className} border-0 text-xs font-medium`}>{label}</Badge>;
}

function MilestoneStatusBadge({ status }: { status: MilestoneResponse["status"] }) {
  const map: Record<MilestoneResponse["status"], { label: string; className: string }> = {
    NOT_STARTED: { label: "Not Started", className: "bg-muted text-muted-foreground" },
    IN_PROGRESS: { label: "In Progress", className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
    COMPLETED: { label: "Completed", className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  };
  const { label, className } = map[status];
  return <Badge className={`${className} border-0 text-xs font-medium`}>{label}</Badge>;
}

// ─── Date formatter helper ────────────────────────────────────────────────────

function DateCell({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-muted-foreground/50">—</span>;
  return <span className="text-sm">{formatRelativeOrDate(value)}</span>;
}

// ─── Initiative form state ────────────────────────────────────────────────────

interface InitiativeForm {
  name: string;
  description: string;
  status: InitiativeResponse["status"];
  startDate: string;
  targetDate: string;
  completedAt: string;
}

const emptyInitiativeForm = (): InitiativeForm => ({
  name: "",
  description: "",
  status: "DRAFT",
  startDate: "",
  targetDate: "",
  completedAt: "",
});

function initiativeToForm(i: InitiativeResponse): InitiativeForm {
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

// ─── Milestone form state ─────────────────────────────────────────────────────

interface MilestoneForm {
  name: string;
  description: string;
  status: MilestoneResponse["status"];
  sequence: string;
  dueDate: string;
  completedAt: string;
}

const emptyMilestoneForm = (): MilestoneForm => ({
  name: "",
  description: "",
  status: "NOT_STARTED",
  sequence: "",
  dueDate: "",
  completedAt: "",
});

function milestoneToForm(m: MilestoneResponse): MilestoneForm {
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

// ─── Initiative Dialog ────────────────────────────────────────────────────────

interface InitiativeDialogProps {
  open: boolean;
  onClose: () => void;
  initial?: InitiativeResponse | null;
  onSave: (form: InitiativeForm) => Promise<void>;
}

function InitiativeDialog({ open, onClose, initial, onSave }: InitiativeDialogProps) {
  const [form, setForm] = useState<InitiativeForm>(emptyInitiativeForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm(initial ? initiativeToForm(initial) : emptyInitiativeForm());
  }, [open, initial]);

  const set = <K extends keyof InitiativeForm>(key: K, value: InitiativeForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

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
          <DialogTitle>{initial ? "Edit Initiative" : "Create Initiative"}</DialogTitle>
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
            <Select value={form.status} onValueChange={(v) => set("status", v as InitiativeForm["status"])}>
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
          <Button onClick={handleSubmit} disabled={!form.name.trim() || saving}>
            {saving ? "Saving…" : initial ? "Save Changes" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Milestone Dialog ─────────────────────────────────────────────────────────

interface MilestoneDialogProps {
  open: boolean;
  onClose: () => void;
  initial?: MilestoneResponse | null;
  onSave: (form: MilestoneForm) => Promise<{ error?: string }>;
}

function MilestoneDialog({ open, onClose, initial, onSave }: MilestoneDialogProps) {
  const [form, setForm] = useState<MilestoneForm>(emptyMilestoneForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(initial ? milestoneToForm(initial) : emptyMilestoneForm());
      setError(null);
    }
  }, [open, initial]);

  const set = <K extends keyof MilestoneForm>(key: K, value: MilestoneForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.sequence) return;
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

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Milestone" : "Add Milestone"}</DialogTitle>
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
              <Select value={form.status} onValueChange={(v) => set("status", v as MilestoneForm["status"])}>
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
                placeholder="e.g. 10"
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
            disabled={!form.name.trim() || !form.sequence || saving}
          >
            {saving ? "Saving…" : initial ? "Save Changes" : "Add Milestone"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Nested Milestones sub-table ──────────────────────────────────────────────

interface MilestonesTableProps {
  initiative: InitiativeResponse;
  githubLogin: string;
  onMilestoneAdded: (initiativeId: string, milestone: MilestoneResponse) => void;
  onMilestoneUpdated: (initiativeId: string, milestone: MilestoneResponse) => void;
  onMilestoneDeleted: (initiativeId: string, milestoneId: string) => void;
}

function MilestonesTable({
  initiative,
  githubLogin,
  onMilestoneAdded,
  onMilestoneUpdated,
  onMilestoneDeleted,
}: MilestonesTableProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<MilestoneResponse | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MilestoneResponse | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [linkTarget, setLinkTarget] = useState<MilestoneResponse | null>(null);

  const baseUrl = `/api/orgs/${githubLogin}/initiatives/${initiative.id}/milestones`;

  const handleUnlink = async (m: MilestoneResponse) => {
    const res = await fetch(`${baseUrl}/${m.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ featureId: null }),
    });
    if (res.ok) {
      const updated: MilestoneResponse = await res.json();
      onMilestoneUpdated(initiative.id, updated);
    }
  };

  const handleAdd = async (form: MilestoneForm): Promise<{ error?: string }> => {
    const body: Record<string, unknown> = {
      name: form.name,
      description: form.description || undefined,
      status: form.status,
      sequence: parseInt(form.sequence, 10),
      dueDate: form.dueDate || undefined,
      completedAt: form.completedAt || undefined,
    };
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 409) return { error: "A milestone with that sequence already exists in this initiative." };
    if (!res.ok) return { error: "Failed to create milestone." };
    const created: MilestoneResponse = await res.json();
    onMilestoneAdded(initiative.id, created);
    return {};
  };

  const handleEdit = async (form: MilestoneForm): Promise<{ error?: string }> => {
    if (!editTarget) return {};
    const body: Record<string, unknown> = {
      name: form.name,
      description: form.description || undefined,
      status: form.status,
      sequence: parseInt(form.sequence, 10),
      dueDate: form.dueDate || undefined,
      completedAt: form.completedAt || undefined,
    };
    const res = await fetch(`${baseUrl}/${editTarget.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 409) return { error: "A milestone with that sequence already exists in this initiative." };
    if (!res.ok) return { error: "Failed to update milestone." };
    const updated: MilestoneResponse = await res.json();
    onMilestoneUpdated(initiative.id, updated);
    return {};
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`${baseUrl}/${deleteTarget.id}`, { method: "DELETE" });
      if (res.ok) {
        onMilestoneDeleted(initiative.id, deleteTarget.id);
        setDeleteTarget(null);
      }
    } finally {
      setDeleting(false);
    }
  };

  const sorted = [...initiative.milestones].sort((a, b) => a.sequence - b.sequence);

  return (
    <div className="pl-8 pr-2 pb-3">
      {sorted.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-12 text-xs">Seq</TableHead>
              <TableHead className="text-xs">Name</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-xs">Due Date</TableHead>
              <TableHead className="text-xs">Completed</TableHead>
              <TableHead className="text-xs">Assignee</TableHead>
              <TableHead className="w-20 text-xs" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((m) => (
              <TableRow key={m.id} className="hover:bg-muted/30">
                <TableCell className="text-xs font-mono text-muted-foreground">{m.sequence}</TableCell>
                <TableCell className="text-sm font-medium">{m.name}</TableCell>
                <TableCell>
                  <MilestoneStatusBadge status={m.status} />
                </TableCell>
                <TableCell>
                  <DateCell value={m.dueDate} />
                </TableCell>
                <TableCell>
                  <DateCell value={m.completedAt} />
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {m.assignee?.name ?? "—"}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1 flex-wrap">
                    {m.feature ? (
                      <div className="flex items-center gap-1 rounded-md bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 px-2 py-0.5 text-xs">
                        <span className="text-blue-900 dark:text-blue-100 font-medium max-w-[120px] truncate">
                          {m.feature.title}
                        </span>
                        <span className="text-blue-600 dark:text-blue-400 mx-0.5">·</span>
                        <span className="text-blue-700 dark:text-blue-300 max-w-[80px] truncate">
                          {m.feature.workspace.name}
                        </span>
                        <button
                          className="ml-1 text-blue-500 hover:text-blue-700"
                          title="Unlink feature"
                          onClick={() => handleUnlink(m)}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-foreground"
                        title="Link feature"
                        onClick={() => setLinkTarget(m)}
                      >
                        <Link2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setEditTarget(m)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(m)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground py-2">No milestones yet.</p>
      )}

      <Button variant="outline" size="sm" className="mt-2" onClick={() => setAddOpen(true)}>
        <Plus className="h-3.5 w-3.5 mr-1" />
        Add Milestone
      </Button>

      <MilestoneDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSave={handleAdd}
      />
      <MilestoneDialog
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        initial={editTarget}
        onSave={handleEdit}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Milestone</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.name}&quot;? This will unlink any
              features associated with this milestone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <LinkFeatureModal
        open={!!linkTarget}
        onClose={() => setLinkTarget(null)}
        githubLogin={githubLogin}
        initiativeId={initiative.id}
        milestoneId={linkTarget?.id ?? ""}
        onLinked={(updated) => {
          onMilestoneUpdated(initiative.id, updated);
          setLinkTarget(null);
        }}
      />
    </div>
  );
}

// ─── Main OrgInitiatives component ───────────────────────────────────────────

interface OrgInitiativesProps {
  githubLogin: string;
}

export function OrgInitiatives({ githubLogin }: OrgInitiativesProps) {
  const [initiatives, setInitiatives] = useState<InitiativeResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Initiative dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<InitiativeResponse | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InitiativeResponse | null>(null);
  const [deleting, setDeleting] = useState(false);

  const baseUrl = `/api/orgs/${githubLogin}/initiatives`;

  useEffect(() => {
    fetch(baseUrl)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: InitiativeResponse[]) => setInitiatives(data))
      .catch(() => setError("Failed to load initiatives."))
      .finally(() => setLoading(false));
  }, [baseUrl]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ── Initiative CRUD ──────────────────────────────────────────────────────

  const handleCreateInitiative = async (form: InitiativeForm) => {
    const body: Record<string, unknown> = {
      name: form.name,
      description: form.description || undefined,
      status: form.status,
      startDate: form.startDate || undefined,
      targetDate: form.targetDate || undefined,
      completedAt: form.completedAt || undefined,
    };
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Failed to create initiative");
    const created: InitiativeResponse = await res.json();
    setInitiatives((prev) => [created, ...prev]);
  };

  const handleEditInitiative = async (form: InitiativeForm) => {
    if (!editTarget) return;
    const body: Record<string, unknown> = {
      name: form.name,
      description: form.description || undefined,
      status: form.status,
      startDate: form.startDate || undefined,
      targetDate: form.targetDate || undefined,
      completedAt: form.completedAt || undefined,
    };
    const res = await fetch(`${baseUrl}/${editTarget.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("Failed to update initiative");
    const updated: InitiativeResponse = await res.json();
    setInitiatives((prev) => prev.map((i) => (i.id === updated.id ? { ...updated, milestones: i.milestones } : i)));
  };

  const handleDeleteInitiative = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const res = await fetch(`${baseUrl}/${deleteTarget.id}`, { method: "DELETE" });
      if (res.ok) {
        setInitiatives((prev) => prev.filter((i) => i.id !== deleteTarget.id));
        setDeleteTarget(null);
      }
    } finally {
      setDeleting(false);
    }
  };

  // ── Milestone callbacks ──────────────────────────────────────────────────

  const handleMilestoneAdded = (initiativeId: string, milestone: MilestoneResponse) => {
    setInitiatives((prev) =>
      prev.map((i) =>
        i.id === initiativeId ? { ...i, milestones: [...i.milestones, milestone] } : i
      )
    );
  };

  const handleMilestoneUpdated = (initiativeId: string, milestone: MilestoneResponse) => {
    setInitiatives((prev) =>
      prev.map((i) =>
        i.id === initiativeId
          ? { ...i, milestones: i.milestones.map((m) => (m.id === milestone.id ? milestone : m)) }
          : i
      )
    );
  };

  const handleMilestoneDeleted = (initiativeId: string, milestoneId: string) => {
    setInitiatives((prev) =>
      prev.map((i) =>
        i.id === initiativeId
          ? { ...i, milestones: i.milestones.filter((m) => m.id !== milestoneId) }
          : i
      )
    );
  };

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-destructive py-8 text-center">{error}</p>;
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium text-muted-foreground">
          {initiatives.length} initiative{initiatives.length !== 1 ? "s" : ""}
        </h2>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Create Initiative
        </Button>
      </div>

      {/* Empty state */}
      {initiatives.length === 0 ? (
        <div className="text-center py-16 border rounded-lg border-dashed">
          <p className="text-muted-foreground text-sm">No initiatives yet.</p>
          <p className="text-muted-foreground/60 text-xs mt-1">
            Create an initiative to start planning strategic goals.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-8" />
                <TableHead>Name</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Assignee</TableHead>
                <TableHead>Start Date</TableHead>
                <TableHead>Target Date</TableHead>
                <TableHead>Completed</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {initiatives.map((initiative) => {
                const expanded = expandedIds.has(initiative.id);
                return (
                  <>
                    <TableRow
                      key={initiative.id}
                      className="cursor-pointer hover:bg-muted/40"
                      onClick={() => toggleExpand(initiative.id)}
                    >
                      <TableCell className="py-3">
                        {expanded ? (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium py-3">
                        <div className="flex items-center gap-2">
                          <span>{initiative.name}</span>
                          {initiative.milestones.length > 0 && (
                            <span className="text-xs text-muted-foreground bg-muted rounded-full px-1.5 py-0.5">
                              {initiative.milestones.length}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <InitiativeStatusBadge status={initiative.status} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {initiative.assignee?.name ?? "—"}
                      </TableCell>
                      <TableCell>
                        <DateCell value={initiative.startDate} />
                      </TableCell>
                      <TableCell>
                        <DateCell value={initiative.targetDate} />
                      </TableCell>
                      <TableCell>
                        <DateCell value={initiative.completedAt} />
                      </TableCell>
                      <TableCell>
                        <div
                          className="flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setEditTarget(initiative)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => setDeleteTarget(initiative)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>

                    {expanded && (
                      <TableRow key={`${initiative.id}-milestones`} className="hover:bg-transparent">
                        <TableCell colSpan={8} className="p-0 bg-muted/20">
                          <MilestonesTable
                            initiative={initiative}
                            githubLogin={githubLogin}
                            onMilestoneAdded={handleMilestoneAdded}
                            onMilestoneUpdated={handleMilestoneUpdated}
                            onMilestoneDeleted={handleMilestoneDeleted}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Initiative dialogs */}
      <InitiativeDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSave={handleCreateInitiative}
      />
      <InitiativeDialog
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        initial={editTarget}
        onSave={handleEditInitiative}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Initiative</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete &quot;{deleteTarget?.name}&quot; and all its milestones.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteInitiative}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
