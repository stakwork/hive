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
 * The dialog resolves a coherent `(workspaceId, initiativeId)` pair
 * per scope, following the "most specific place wins" rule. New
 * features are never created with a `milestoneId` from this dialog —
 * milestones are not drillable scopes, and milestone membership is
 * established afterward by drawing an edge from the feature card to a
 * milestone card on the initiative canvas (intercepted as a DB write
 * in `OrgCanvasBackground`).
 *
 *   - Root (`""`)              → user picks workspace + initiative.
 *   - Workspace (`ws:<id>`)    → workspace locked; no initiative.
 *   - Initiative (`init:<id>`) → initiative locked; user picks workspace.
 *
 * The "edge-aware" workspace picker: when the dialog runs on an
 * initiative scope, we read the root canvas's edges and surface
 * workspaces the user has visually linked to the parent initiative
 * (via a root-level `ws:<x> ↔ initiative:<y>` edge). Linked workspaces
 * float to the top of the dropdown with the first one preselected.
 * No edges → flat alphabetical list, no preselection.
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
  /**
   * Always null today — the dialog never sets a milestone at create
   * time. Kept on the form shape so the consumer's submit body still
   * compiles; downstream code conditionally adds `milestoneId` to the
   * POST body only when truthy. Milestone membership is established
   * post-creation by drawing an edge on the initiative canvas.
   */
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
   * workspace, `initiative:<id>` = initiative timeline. There is no
   * milestone scope — milestones live on the initiative canvas as
   * non-drillable cards.
   */
  scope: string;
  /**
   * Optional pre-fill from a "Promote to Feature" trigger on a note.
   * Title is truncated to ~80 chars; description gets the full text.
   */
  prefill?: { title?: string; brief?: string };
  /**
   * Optional id of the canvas node that triggered the dialog (typically
   * a `note` from the right-click "Promote to Feature" path). When set,
   * the dialog inspects edges incident to this node on the source
   * canvas and uses them to pre-select fields the scope hasn't already
   * locked: a `note ↔ initiative:<x>` edge pre-selects initiative `<x>`
   * on root scope; a `note ↔ ws:<y>` edge pre-selects workspace `<y>`
   * on any scope where the workspace isn't locked.
   *
   * The intuition: if the user has visually linked a note to an
   * initiative or workspace, promoting that note should treat the
   * link as an explicit "this belongs to that thing" hint.
   */
  sourceNodeId?: string;
  /** Caller-controlled save. Resolve to close the dialog. */
  onSave: (form: FeatureCreateForm) => Promise<void>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fetch a canvas blob's edges. Returns `[]` on any failure so callers
 * fall back to the no-pre-selection default cleanly.
 */
async function fetchCanvasEdges(
  githubLogin: string,
  canvasRef: string,
): Promise<Array<{ fromNode?: string; toNode?: string }>> {
  try {
    const url = canvasRef
      ? `/api/orgs/${githubLogin}/canvas/${encodeURIComponent(canvasRef)}`
      : `/api/orgs/${githubLogin}/canvas`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const body = await res.json();
    return Array.isArray(body?.data?.edges) ? body.data.edges : [];
  } catch {
    return [];
  }
}

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
  const edges = await fetchCanvasEdges(githubLogin, "");
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
}

/**
 * Read the source canvas's edges to find live entities the source
 * node (typically a `note`) is connected to. Used by the
 * Promote-to-Feature path so the dialog can pre-select fields the
 * user has already implicitly chosen by drawing edges.
 *
 * Returned ids are de-duped and ordered by edge appearance (first
 * edge wins on ties — same stability rule as `fetchLinkedWorkspaceIds`).
 *
 * Both arrays are returned so the caller can decide which apply per
 * scope (e.g. workspace ids are useful on every scope where workspace
 * isn't locked; initiative ids only matter on root).
 */
async function fetchSourceNodeLinks(
  githubLogin: string,
  sourceCanvasRef: string,
  sourceNodeId: string,
): Promise<{ initiativeIds: string[]; workspaceIds: string[] }> {
  const edges = await fetchCanvasEdges(githubLogin, sourceCanvasRef);
  const initiativeIds: string[] = [];
  const workspaceIds: string[] = [];
  for (const e of edges) {
    const from = e.fromNode ?? "";
    const to = e.toNode ?? "";
    // Pull out whichever endpoint is the OTHER node — i.e. the live
    // entity the source is linked to. Skip edges where the source
    // doesn't appear as either endpoint.
    let other: string | null = null;
    if (from === sourceNodeId) other = to;
    else if (to === sourceNodeId) other = from;
    if (!other) continue;
    if (other.startsWith("initiative:")) {
      const id = other.slice("initiative:".length);
      if (id && !initiativeIds.includes(id)) initiativeIds.push(id);
    } else if (other.startsWith("ws:")) {
      const id = other.slice("ws:".length);
      if (id && !workspaceIds.includes(id)) workspaceIds.push(id);
    }
  }
  return { initiativeIds, workspaceIds };
}

// ─── Component ────────────────────────────────────────────────────────────────

const TITLE_MAX = 80;

export function CreateFeatureCanvasDialog({
  open,
  onClose,
  githubLogin,
  scope,
  prefill,
  sourceNodeId,
  onSave,
}: CreateFeatureCanvasDialogProps) {
  const scopeKind = useMemo<
    "root" | "workspace" | "initiative" | "other"
  >(() => {
    if (scope === "") return "root";
    if (scope.startsWith("ws:")) return "workspace";
    if (scope.startsWith("initiative:")) return "initiative";
    return "other";
  }, [scope]);

  const lockedWorkspaceId =
    scopeKind === "workspace" ? scope.slice("ws:".length) : null;
  const lockedInitiativeIdFromScope =
    scopeKind === "initiative" ? scope.slice("initiative:".length) : null;

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
  const [loading, setLoading] = useState(false);

  // ─── Reset on open / scope change ───────────────────────────────────────────

  useEffect(() => {
    if (!open) return;
    setTitle((prefill?.title ?? "").slice(0, TITLE_MAX));
    setBrief(prefill?.brief ?? "");
    setInitiativeId("");
    setWorkspaceId(lockedWorkspaceId ?? "");
    setLinkedWorkspaceIds([]);
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

      // Initiatives are needed on root (picker) and on initiative
      // scope (so the locked context line can show the initiative's
      // name, not just the prefixed ref). Skip on workspace scope.
      const wantInitiatives = scopeKind === "root" || scopeKind === "initiative";
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

      // Effective initiative id used for edge-hint lookups below.
      // Locked by scope on initiative canvases; user-picked on root
      // (and re-evaluated below when source-incident edges hint at one).
      let effectiveInitiativeId: string | null =
        scopeKind === "initiative" ? lockedInitiativeIdFromScope : null;

      // Source-incident edges (Promote-to-Feature path). The source
      // node — typically a `note` — may already be edged to live
      // entities on its canvas; treat those edges as explicit
      // "this belongs to that thing" hints.
      //   - `note ↔ initiative:<x>` on root → pre-select initiative `<x>`.
      //   - `note ↔ ws:<y>` on any scope → pre-select workspace `<y>`.
      // Pre-selections are silent suggestions; user can change them
      // before saving.
      let sourceWorkspaceIds: string[] = [];
      if (sourceNodeId) {
        const links = await fetchSourceNodeLinks(
          githubLogin,
          scope,
          sourceNodeId,
        );
        if (cancelled) return;
        sourceWorkspaceIds = links.workspaceIds;
        // On root scope, an edge from the source note to an
        // initiative pre-selects that initiative AND feeds the
        // existing initiative-anchored workspace lookup so the user
        // gets a coherent default for both fields in one go.
        if (scopeKind === "root" && links.initiativeIds.length > 0) {
          const liveInit = new Set(normalizedInits.map((i) => i.id));
          const firstValidInit = links.initiativeIds.find((id) =>
            liveInit.has(id),
          );
          if (firstValidInit) {
            setInitiativeId(firstValidInit);
            effectiveInitiativeId = firstValidInit;
          }
        }
      }

      // Edge-aware workspace pre-selection. Two sources, in priority
      // order:
      //   1. Workspaces directly edged to the source note (highest
      //      specificity — the user pointed at "this workspace" with
      //      a deliberate annotation).
      //   2. Workspaces edged to the dialog's effective initiative
      //      on the root canvas (next best — the user said "this
      //      initiative involves these workspaces"; pick the first).
      // Skipped when the workspace is locked by scope.
      if (!lockedWorkspaceId) {
        const liveSet = new Set(normalizedWs.map((w) => w.id));
        const validSourceWs = sourceWorkspaceIds.filter((id) => liveSet.has(id));

        let initiativeWs: string[] = [];
        if (effectiveInitiativeId) {
          const linked = await fetchLinkedWorkspaceIds(
            githubLogin,
            effectiveInitiativeId,
          );
          if (cancelled) return;
          initiativeWs = linked.filter((id) => liveSet.has(id));
        }

        // De-dupe across the two sources, source-incident first so
        // direct annotations win the "starred" treatment in the UI.
        const seen = new Set<string>();
        const merged: string[] = [];
        for (const id of [...validSourceWs, ...initiativeWs]) {
          if (seen.has(id)) continue;
          seen.add(id);
          merged.push(id);
        }
        setLinkedWorkspaceIds(merged);
        if (merged.length > 0) {
          setWorkspaceId(merged[0]);
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
    scope,
    scopeKind,
    lockedInitiativeIdFromScope,
    lockedWorkspaceId,
    sourceNodeId,
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
    // Resolve the (workspaceId, initiativeId) pair from the
    // locked-vs-picked sources. Milestone is always null at create
    // time (see comment on `FeatureCreateForm.milestoneId`).
    const resolvedInitiativeId: string | null =
      scopeKind === "root"
        ? initiativeId || null
        : scopeKind === "initiative"
        ? lockedInitiativeIdFromScope
        : null;

    setSaving(true);
    try {
      await onSave({
        title: title.trim(),
        brief: brief.trim(),
        workspaceId,
        initiativeId: resolvedInitiativeId,
        milestoneId: null,
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
