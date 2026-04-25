"use client";

import React, { useEffect, useRef, useState } from "react";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  InitiativeDialog,
  type InitiativeForm,
} from "@/components/initiatives/InitiativeDialog";
import {
  MilestoneDialog,
  type MilestoneForm,
} from "@/components/initiatives/MilestoneDialog";
import { useReorderMilestones } from "@/hooks/useReorderMilestones";
import { formatRelativeOrDate } from "@/lib/date-utils";
import type { InitiativeResponse, MilestoneResponse } from "@/types/initiatives";
import { DndContext } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  ChevronRight,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";

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

// ─── Sortable Milestone Row ───────────────────────────────────────────────────

interface SortableMilestoneRowProps {
  milestone: MilestoneResponse;
  siblingSequences: number[]; // all sequences in the initiative, excluding this milestone's own
  githubLogin: string;
  initiativeId: string;
  onEdit: (m: MilestoneResponse) => void;
  onDelete: (m: MilestoneResponse) => void;
  onMilestoneUpdated: (m: MilestoneResponse) => void;
  onInsertBefore: (m: MilestoneResponse) => void;
  onInsertAfter: (m: MilestoneResponse) => void;
}

function SortableMilestoneRow({
  milestone,
  siblingSequences,
  githubLogin,
  initiativeId,
  onEdit,
  onDelete,
  onMilestoneUpdated,
  onInsertBefore,
  onInsertAfter,
}: SortableMilestoneRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: milestone.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Inline sequence editing state
  const [seqValue, setSeqValue] = useState(String(milestone.sequence));
  const [seqError, setSeqError] = useState<string | null>(null);
  const [seqFocused, setSeqFocused] = useState(false);
  const prevSeqRef = useRef(String(milestone.sequence));

  // Keep seqValue in sync when milestone prop changes (e.g. after drag reorder)
  useEffect(() => {
    if (!seqFocused) {
      setSeqValue(String(milestone.sequence));
      prevSeqRef.current = String(milestone.sequence);
    }
  }, [milestone.sequence, seqFocused]);

  const commitSequenceEdit = async () => {
    setSeqFocused(false);
    const newSeq = parseInt(seqValue, 10);
    if (isNaN(newSeq) || newSeq < 1) {
      setSeqValue(prevSeqRef.current);
      setSeqError(null);
      return;
    }
    if (newSeq === milestone.sequence) {
      setSeqError(null);
      return;
    }
    if (siblingSequences.includes(newSeq)) {
      setSeqError("Already in use");
      setSeqValue(prevSeqRef.current);
      return;
    }
    setSeqError(null);

    // Optimistic update
    onMilestoneUpdated({ ...milestone, sequence: newSeq });
    prevSeqRef.current = String(newSeq);

    try {
      const res = await fetch(
        `/api/orgs/${githubLogin}/initiatives/${initiativeId}/milestones/${milestone.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sequence: newSeq }),
        }
      );
      if (res.status === 409) {
        setSeqError("Already in use");
        onMilestoneUpdated({ ...milestone, sequence: milestone.sequence });
        setSeqValue(String(milestone.sequence));
        prevSeqRef.current = String(milestone.sequence);
        return;
      }
      if (!res.ok) throw new Error("Failed");
      const updated: MilestoneResponse = await res.json();
      onMilestoneUpdated(updated);
      prevSeqRef.current = String(updated.sequence);
    } catch {
      onMilestoneUpdated({ ...milestone, sequence: milestone.sequence });
      setSeqValue(String(milestone.sequence));
      prevSeqRef.current = String(milestone.sequence);
    }
  };

  return (
    <TableRow ref={setNodeRef} style={style} className="hover:bg-muted/30">
      {/* Drag handle */}
      <TableCell className="w-6 px-1">
        <button
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground p-0.5 touch-none"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      </TableCell>

      {/* Inline sequence edit */}
      <TableCell className="w-16">
        <div className="relative">
          <Input
            type="number"
            min={1}
            value={seqValue}
            onChange={(e) => {
              setSeqValue(e.target.value);
              setSeqError(null);
            }}
            onFocus={() => setSeqFocused(true)}
            onBlur={commitSequenceEdit}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur();
              } else if (e.key === "Escape") {
                setSeqValue(prevSeqRef.current);
                setSeqError(null);
                setSeqFocused(false);
                e.currentTarget.blur();
              }
            }}
            className={`h-6 w-12 text-xs font-mono px-1 ${
              seqFocused
                ? "border-border bg-background"
                : "border-transparent bg-transparent shadow-none"
            } ${seqError ? "border-destructive" : ""}`}
          />
          {seqError && (
            <span className="absolute -bottom-4 left-0 text-[10px] text-destructive whitespace-nowrap">
              {seqError}
            </span>
          )}
        </div>
      </TableCell>

      <TableCell className="text-sm font-medium">{milestone.name}</TableCell>
      <TableCell>
        <MilestoneStatusBadge status={milestone.status} />
      </TableCell>
      <TableCell>
        <DateCell value={milestone.dueDate} />
      </TableCell>
      <TableCell>
        <DateCell value={milestone.completedAt} />
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {milestone.assignee?.name ?? "—"}
      </TableCell>

      {/* Actions */}
      <TableCell>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onEdit(milestone)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-destructive hover:text-destructive"
            onClick={() => onDelete(milestone)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onInsertBefore(milestone)}>
                Insert Before
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onInsertAfter(milestone)}>
                Insert After
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  );
}

// ─── Nested Milestones sub-table ──────────────────────────────────────────────

interface MilestonesTableProps {
  initiative: InitiativeResponse;
  githubLogin: string;
  onMilestoneAdded: (initiativeId: string, milestone: MilestoneResponse) => void;
  onMilestoneUpdated: (initiativeId: string, milestone: MilestoneResponse) => void;
  onMilestoneDeleted: (initiativeId: string, updatedSiblings: MilestoneResponse[]) => void;
  onMilestonesReordered: (initiativeId: string, milestones: MilestoneResponse[]) => void;
}

function MilestonesTable({
  initiative,
  githubLogin,
  onMilestoneAdded,
  onMilestoneUpdated,
  onMilestoneDeleted,
  onMilestonesReordered,
}: MilestonesTableProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<MilestoneResponse | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MilestoneResponse | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Insert before/after state
  const [insertDialogOpen, setInsertDialogOpen] = useState(false);
  const [insertSequence, setInsertSequence] = useState<number | undefined>(undefined);
  // usedSequences for insert dialog reflects the shifted state (after making room)
  const [insertUsedSequences, setInsertUsedSequences] = useState<number[]>([]);

  const sorted = [...initiative.milestones].sort((a, b) => a.sequence - b.sequence);

  const baseUrl = `/api/orgs/${githubLogin}/initiatives/${initiative.id}/milestones`;
  const reorderUrl = `${baseUrl}/reorder`;

  const nextSequence = Math.max(0, ...initiative.milestones.map((m) => m.sequence)) + 1;

  const { sensors, milestoneIds, handleDragEnd, collisionDetection } = useReorderMilestones({
    milestones: sorted,
    initiativeId: initiative.id,
    githubLogin,
    onOptimisticUpdate: (reordered) => onMilestonesReordered(initiative.id, reordered),
  });

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
      const res = await fetch(`${baseUrl}/${deleteTarget.id}?renumber=true`, { method: "DELETE" });
      if (res.ok) {
        const data = await res.json();
        onMilestoneDeleted(initiative.id, data.milestones ?? []);
        setDeleteTarget(null);
      }
    } finally {
      setDeleting(false);
    }
  };

  const handleInsertBefore = async (m: MilestoneResponse) => {
    const insertPos = m.sequence;
    await shiftAndOpenInsert(insertPos);
  };

  const handleInsertAfter = async (m: MilestoneResponse) => {
    const insertPos = m.sequence + 1;
    await shiftAndOpenInsert(insertPos);
  };

  const shiftAndOpenInsert = async (insertPos: number) => {
    // Milestones that need to shift up (sequence >= insertPos)
    const toShift = sorted.filter((m) => m.sequence >= insertPos);

    if (toShift.length > 0) {
      const shifted = sorted.map((m) =>
        m.sequence >= insertPos ? { ...m, sequence: m.sequence + 1 } : m
      );

      // Optimistically update
      onMilestonesReordered(initiative.id, shifted);

      try {
        const res = await fetch(reorderUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            milestones: shifted.map((m) => ({ id: m.id, sequence: m.sequence })),
          }),
        });
        if (!res.ok) {
          // Revert
          onMilestonesReordered(initiative.id, sorted);
          return;
        }
        const updated: MilestoneResponse[] = await res.json();
        onMilestonesReordered(initiative.id, updated);
        // Build usedSequences from the updated list (insertPos is now free)
        setInsertUsedSequences(updated.map((m) => m.sequence));
      } catch {
        onMilestonesReordered(initiative.id, sorted);
        return;
      }
    } else {
      setInsertUsedSequences(sorted.map((m) => m.sequence));
    }

    setInsertSequence(insertPos);
    setInsertDialogOpen(true);
  };

  // usedSequences for add dialog: all existing sequences
  const addUsedSequences = sorted.map((m) => m.sequence);

  // usedSequences for edit dialog: all sequences except the current one being edited
  const editUsedSequences = editTarget
    ? sorted.filter((m) => m.id !== editTarget.id).map((m) => m.sequence)
    : [];

  return (
    <div className="pl-8 pr-2 pb-3">
      {sorted.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-6 px-1" />
              <TableHead className="w-16 text-xs">Seq</TableHead>
              <TableHead className="text-xs">Name</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-xs">Due Date</TableHead>
              <TableHead className="text-xs">Completed</TableHead>
              <TableHead className="text-xs">Assignee</TableHead>
              <TableHead className="w-28 text-xs" />
            </TableRow>
          </TableHeader>
          <DndContext
            sensors={sensors}
            collisionDetection={collisionDetection}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={milestoneIds} strategy={verticalListSortingStrategy}>
              <TableBody>
                {sorted.map((m) => (
                  <SortableMilestoneRow
                    key={m.id}
                    milestone={m}
                    siblingSequences={sorted.filter((s) => s.id !== m.id).map((s) => s.sequence)}
                    githubLogin={githubLogin}
                    initiativeId={initiative.id}
                    onEdit={setEditTarget}
                    onDelete={setDeleteTarget}
                    onMilestoneUpdated={(updated) => onMilestoneUpdated(initiative.id, updated)}
                    onInsertBefore={handleInsertBefore}
                    onInsertAfter={handleInsertAfter}
                  />
                ))}
              </TableBody>
            </SortableContext>
          </DndContext>
        </Table>
      ) : (
        <p className="text-sm text-muted-foreground py-2">No milestones yet.</p>
      )}

      <Button variant="outline" size="sm" className="mt-2" onClick={() => setAddOpen(true)}>
        <Plus className="h-3.5 w-3.5 mr-1" />
        Add Milestone
      </Button>

      {/* Add dialog */}
      <MilestoneDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        defaultSequence={nextSequence}
        usedSequences={addUsedSequences}
        onSave={handleAdd}
      />

      {/* Edit dialog */}
      <MilestoneDialog
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        initial={editTarget}
        usedSequences={editUsedSequences}
        onSave={handleEdit}
      />

      {/* Insert before/after dialog */}
      <MilestoneDialog
        open={insertDialogOpen}
        onClose={() => {
          setInsertDialogOpen(false);
          setInsertSequence(undefined);
        }}
        defaultSequence={insertSequence}
        usedSequences={insertUsedSequences}
        onSave={handleAdd}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Milestone</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.name}&quot;? This will unlink any
              features associated with this milestone. Remaining milestones will be automatically
              renumbered.
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
    setInitiatives((prev) =>
      prev.map((i) => (i.id === updated.id ? { ...updated, milestones: i.milestones } : i))
    );
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

  // Receives the full updated sibling list after ?renumber=true delete
  const handleMilestoneDeleted = (initiativeId: string, updatedSiblings: MilestoneResponse[]) => {
    setInitiatives((prev) =>
      prev.map((i) =>
        i.id === initiativeId ? { ...i, milestones: updatedSiblings } : i
      )
    );
  };

  const handleMilestonesReordered = (initiativeId: string, milestones: MilestoneResponse[]) => {
    setInitiatives((prev) =>
      prev.map((i) => (i.id === initiativeId ? { ...i, milestones } : i))
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
                  <React.Fragment key={initiative.id}>
                    <TableRow
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
                            onMilestonesReordered={handleMilestonesReordered}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </React.Fragment>
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
