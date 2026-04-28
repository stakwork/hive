"use client";

/**
 * "Create Feature" dialog used by the org canvas. Two entry points
 * converge on this one component:
 *
 *   1. The `+` menu pick on a `feature` category (intercepted in
 *      `OrgCanvasBackground.handleNodeAdd`, like initiative/milestone).
 *   2. The right-click "Promote to Feature" menu item on `note` nodes
 *      (the note's text pre-fills title + description).
 *
 * The dialog resolves a coherent `(workspaceId, initiativeId,
 * milestoneId)` triple per scope, following the "most specific place
 * wins" rule:
 *
 *   - Root (`""`)              → user picks workspace + initiative.
 *   - Workspace (`ws:<id>`)    → workspace locked; no initiative.
 *   - Initiative (`init:<id>`) → initiative locked; user picks workspace.
 *   - Milestone (`ms:<id>`)    → milestone + initiative locked
 *                                (initiative is derived from the
 *                                milestone server-side); user picks
 *                                workspace.
 *
 * The "edge-aware" workspace picker: when the dialog runs on an
 * initiative or milestone scope, we read the root canvas's edges and
 * surface workspaces the user has visually linked to the parent
 * initiative (via a root-level `ws:<x> ↔ initiative:<y>` edge). Linked
 * workspaces float to the top of the dropdown with the first one
 * preselected. No edges → flat alphabetical list, no preselection.
 *
 * The dialog only owns the form. Saving (the actual POST + canvas
 * refetch) is the caller's job — same pattern as InitiativeDialog /
 * MilestoneDialog.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface FeatureCreateForm {
  title: string;
  brief: string;
  workspaceId: string;
  /** Null when the dialog is on workspace scope (loose feature). */
  initiativeId: string | null;
  /** Null on every scope except milestone. */
  milestoneId: string | null;
}

interface WorkspaceOption {
  id: string;
  name: string;
}

interface InitiativeOption {
  id: string;
  name: string;
}

export interface CreateFeatureCanvasDialogProps {
  open: boolean;
  onClose: () => void;
  /** Org slug; used to fetch workspaces / initiatives / root canvas. */
  githubLogin: string;
  /**
   * Canvas ref the user is currently on. The dialog inspects the
   * prefix to decide which fields are locked. `""` = root, `ws:<id>` =
   * workspace, `initiative:<id>` = initiative timeline, `milestone:<id>`
   * = milestone sub-canvas.
   */
  scope: string;
  /**
   * Optional pre-fill from a "Promote to Feature" trigger on a note.
   * Title is truncated to ~80 chars; description gets the full text.
   */
  prefill?: { title?: string; brief?: string };
  /** Caller-controlled save. Resolve to close the dialog. */
  onSave: (form: FeatureCreateForm) => Promise<void>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Read the root canvas blob to discover which workspaces the user has
 * visually linked to a given initiative via a `ws:<x> ↔ initiative:<y>`
 * edge. Order preserved from the edges array so users get a stable
 * "first linked" experience.
 *
 * Returns a list of workspace ids — empty if no edges, unauthorized,
 * or fetch failed (silent fallback to flat workspace list).
 */
async function fetchLinkedWorkspaceIds(
  githubLogin: string,
  initiativeId: string,
): Promise<string[]> {
  try {
    const res = await fetch(`/api/orgs/${githubLogin}/canvas`);
    if (!res.ok) return [];
    const body = await res.json();
    const edges: Array<{ fromNode?: string; toNode?: string }> = Array.isArray(
      body?.data?.edges,
    )
      ? body.data.edges
      : [];
    const target = `initiative:${initiativeId}`;
    const linked: string[] = [];
    for (const e of edges) {
      const from = e.fromNode ?? "";
      const to = e.toNode ?? "";
      // Match either direction; either endpoint may be the workspace.
      const wsId =
        from.startsWith("ws:") && to === target
          ? from.slice("ws:".length)
          : to.startsWith("ws:") && from === target
          ? to.slice("ws:".length)
          : null;
      if (wsId && !linked.includes(wsId)) linked.push(wsId);
    }
    return linked;
  } catch {
    return [];
  }
}

/**
 * Resolve the parent initiativeId for a milestone scope. The milestone
 * route's GET returns the parent initiativeId via the milestone payload.
 */
async function fetchMilestoneParent(
  githubLogin: string,
  milestoneId: string,
): Promise<{ initiativeId: string; name: string } | null> {
  // We don't have a single-milestone GET endpoint, but the initiatives
  // list includes nested milestones. One round-trip is fine for an
  // already-rare path (creating a feature directly from a milestone
  // sub-canvas, with no chat-extracted prefill).
  try {
    const res = await fetch(`/api/orgs/${githubLogin}/initiatives`);
    if (!res.ok) return null;
    const body = await res.json();
    const initiatives: Array<{
      id: string;
      milestones?: Array<{ id: string; name: string }>;
    }> = Array.isArray(body) ? body : [];
    for (const i of initiatives) {
      const m = i.milestones?.find((x) => x.id === milestoneId);
      if (m) return { initiativeId: i.id, name: m.name };
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

const TITLE_MAX = 80;

export function CreateFeatureCanvasDialog({
  open,
  onClose,
  githubLogin,
  scope,
  prefill,
  onSave,
}: CreateFeatureCanvasDialogProps) {
  const scopeKind = useMemo<
    "root" | "workspace" | "initiative" | "milestone" | "other"
  >(() => {
    if (scope === "") return "root";
    if (scope.startsWith("ws:")) return "workspace";
    if (scope.startsWith("initiative:")) return "initiative";
    if (scope.startsWith("milestone:")) return "milestone";
    return "other";
  }, [scope]);

  const lockedWorkspaceId =
    scopeKind === "workspace" ? scope.slice("ws:".length) : null;
  const lockedInitiativeIdFromScope =
    scopeKind === "initiative" ? scope.slice("initiative:".length) : null;
  const lockedMilestoneId =
    scopeKind === "milestone" ? scope.slice("milestone:".length) : null;

  // ─── Form state ─────────────────────────────────────────────────────────────

  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [workspaceId, setWorkspaceId] = useState<string>("");
  const [initiativeId, setInitiativeId] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // ─── Loaded options ─────────────────────────────────────────────────────────

  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [initiatives, setInitiatives] = useState<InitiativeOption[]>([]);
  const [linkedWorkspaceIds, setLinkedWorkspaceIds] = useState<string[]>([]);
  /** Resolved milestone-side state when `scopeKind === "milestone"`. */
  const [milestoneParent, setMilestoneParent] = useState<{
    initiativeId: string;
    name: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  // ─── Reset on open / scope change ───────────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    setTitle((prefill?.title ?? "").slice(0, TITLE_MAX));
    setBrief(prefill?.brief ?? "");
    setInitiativeId("");
    setWorkspaceId(lockedWorkspaceId ?? "");
    setLinkedWorkspaceIds([]);
    setMilestoneParent(null);
  }, [open, prefill?.title, prefill?.brief, lockedWorkspaceId]);

  // ─── Load workspaces + initiatives + edges ─────────────────────────────────

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setLoading(true);

    const load = async () => {
      const wsPromise = fetch(`/api/orgs/${githubLogin}/workspaces`)
        .then((r) => (r.ok ? r.json() : []))
        .catch(() => []);

      // Initiatives are needed on root (picker) and milestone scope
      // (to resolve the milestone's parent name for display). Skip on
      // workspace scope to save a round-trip.
      const wantInitiatives =
        scopeKind === "root" || scopeKind === "milestone";
      const initPromise = wantInitiatives
        ? fetch(`/api/orgs/${githubLogin}/initiatives`)
            .then((r) => (r.ok ? r.json() : []))
            .catch(() => [])
        : Promise.resolve([]);

      const [wsList, initList] = await Promise.all([wsPromise, initPromise]);
      if (cancelled) return;

      const normalizedWs: WorkspaceOption[] = Array.isArray(wsList)
        ? wsList.map((w: { id: string; name: string }) => ({
            id: w.id,
            name: w.name,
          }))
        : [];
      setWorkspaces(normalizedWs);

      const normalizedInits: InitiativeOption[] = Array.isArray(initList)
        ? initList.map((i: { id: string; name: string }) => ({
            id: i.id,
            name: i.name,
          }))
        : [];
      setInitiatives(normalizedInits);

      // Resolve milestone parent (initiativeId + display name) so we
      // can lock the initiative server-side and load edge hints.
      let effectiveInitiativeId: string | null = null;
      if (scopeKind === "milestone" && lockedMilestoneId) {
        const parent = await fetchMilestoneParent(
          githubLogin,
          lockedMilestoneId,
        );
        if (cancelled) return;
        if (parent) {
          setMilestoneParent(parent);
          effectiveInitiativeId = parent.initiativeId;
        }
      } else if (scopeKind === "initiative") {
        effectiveInitiativeId = lockedInitiativeIdFromScope;
      }

      // Edge-aware workspace pre-selection. Only meaningful when the
      // dialog has an initiative anchor (initiative/milestone scopes).
      if (effectiveInitiativeId && !lockedWorkspaceId) {
        const linked = await fetchLinkedWorkspaceIds(
          githubLogin,
          effectiveInitiativeId,
        );
        if (cancelled) return;
        // Filter against the live workspace list — an edge to a
        // since-deleted workspace shouldn't preselect a phantom id.
        const liveSet = new Set(normalizedWs.map((w) => w.id));
        const validLinked = linked.filter((id) => liveSet.has(id));
        setLinkedWorkspaceIds(validLinked);
        if (validLinked.length > 0) {
          setWorkspaceId(validLinked[0]);
        }
      }

      setLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [
    open,
    githubLogin,
    scopeKind,
    lockedMilestoneId,
    lockedInitiativeIdFromScope,
    lockedWorkspaceId,
  ]);

  // ─── Derived ────────────────────────────────────────────────────────────────

  /** Workspaces sorted: linked first (in edge order), then the rest alphabetically. */
  const sortedWorkspaces = useMemo<WorkspaceOption[]>(() => {
    const linkedIdx = new Map(linkedWorkspaceIds.map((id, i) => [id, i]));
    const linked = linkedWorkspaceIds
      .map((id) => workspaces.find((w) => w.id === id))
      .filter((w): w is WorkspaceOption => Boolean(w));
    const rest = workspaces
      .filter((w) => !linkedIdx.has(w.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    return [...linked, ...rest];
  }, [workspaces, linkedWorkspaceIds]);

  /** Whether the current form is valid enough to submit. */
  const canSubmit = useMemo(() => {
    if (!title.trim()) return false;
    if (!workspaceId) return false;
    if (scopeKind === "root" && !initiativeId) return false;
    return !saving;
  }, [title, workspaceId, initiativeId, scopeKind, saving]);

  // ─── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!canSubmit) return;
    // Resolve the (workspaceId, initiativeId, milestoneId) triple from
    // the locked-vs-picked sources. The service-side validator
    // (`createFeature` in services/roadmap) re-derives initiativeId
    // from milestoneId when both are set, so the milestone-scope path
    // can omit initiativeId — but we send what we have for clarity.
    const resolvedInitiativeId: string | null =
      scopeKind === "root"
        ? initiativeId || null
        : scopeKind === "initiative"
        ? lockedInitiativeIdFromScope
        : scopeKind === "milestone"
        ? milestoneParent?.initiativeId ?? null
        : null;

    const resolvedMilestoneId: string | null =
      scopeKind === "milestone" ? lockedMilestoneId : null;

    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        brief: brief.trim(),
        workspaceId,
        initiativeId: resolvedInitiativeId,
        milestoneId: resolvedMilestoneId,
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  /** Locked-field summary line shown above the picker, so the user
   *  knows what context the new feature will be created under. */
  const contextLine = (() => {
    if (scopeKind === "workspace") {
      const ws = workspaces.find((w) => w.id === lockedWorkspaceId);
      return ws ? `Workspace: ${ws.name}` : null;
    }
    if (scopeKind === "initiative") {
      const init = initiatives.find(
        (i) => i.id === lockedInitiativeIdFromScope,
      );
      return init ? `Initiative: ${init.name}` : null;
    }
    if (scopeKind === "milestone" && milestoneParent) {
      return `Milestone: ${milestoneParent.name}`;
    }
    return null;
  })();

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Create Feature</DialogTitle>
          {contextLine && (
            <DialogDescription>{contextLine}</DialogDescription>
          )}
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="feat-title">Title *</Label>
            <Input
              id="feat-title"
              value={title}
              onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
              placeholder="Feature title"
              autoFocus
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="feat-brief">Description</Label>
            <Textarea
              id="feat-brief"
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="Optional description"
              rows={3}
            />
          </div>

          {/* Initiative picker — root scope only. On initiative/milestone
              scopes the initiative is locked and shown in the context
              line above; on workspace scope it's not applicable. */}
          {scopeKind === "root" && (
            <div className="grid gap-1.5">
              <Label>Initiative *</Label>
              <Select
                value={initiativeId}
                onValueChange={setInitiativeId}
                disabled={loading || initiatives.length === 0}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      loading
                        ? "Loading…"
                        : initiatives.length === 0
                        ? "No initiatives — create one first"
                        : "Select an initiative"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {initiatives.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Workspace picker — locked on workspace scope, picker
              everywhere else. The picker surfaces edge-linked
              workspaces (`ws ↔ initiative:<X>` on root) at the top
              when the dialog has an initiative anchor. */}
          {scopeKind !== "workspace" && (
            <div className="grid gap-1.5">
              <Label>Workspace *</Label>
              <Select
                value={workspaceId}
                onValueChange={setWorkspaceId}
                disabled={loading || workspaces.length === 0}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      loading
                        ? "Loading…"
                        : workspaces.length === 0
                        ? "No workspaces"
                        : "Select a workspace"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {sortedWorkspaces.map((w, i) => {
                    // Visual divider between linked (top) and other
                    // workspaces. Only when both groups exist.
                    const isLastLinked =
                      linkedWorkspaceIds.length > 0 &&
                      i === linkedWorkspaceIds.length - 1 &&
                      sortedWorkspaces.length > linkedWorkspaceIds.length;
                    return (
                      <React.Fragment key={w.id}>
                        <SelectItem value={w.id}>
                          {linkedWorkspaceIds.includes(w.id) ? (
                            <span>
                              <span aria-hidden className="mr-2">
                                ★
                              </span>
                              {w.name}
                            </span>
                          ) : (
                            w.name
                          )}
                        </SelectItem>
                        {isLastLinked && <SelectSeparator />}
                      </React.Fragment>
                    );
                  })}
                </SelectContent>
              </Select>
              {linkedWorkspaceIds.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Starred workspaces are linked to this initiative on the
                  canvas.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {saving ? "Creating…" : "Create Feature"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
