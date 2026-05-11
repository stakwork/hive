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
 *                                Two tabs: **Create new** + **Assign
 *                                existing** (the workspace canvas
 *                                doesn't auto-project features, so
 *                                "+ Feature" can mean either "make a
 *                                new feature here" or "pin one of my
 *                                workspace's existing features onto
 *                                this canvas"). The assign-existing
 *                                tab POSTs to the assigned-features
 *                                overlay endpoint instead of creating
 *                                a row.
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
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

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

/**
 * Payload for the "Assign existing" tab. Two flavors depending on which
 * canvas the dialog was opened from — the caller's `onAssign` handler
 * branches on `kind` to decide which DB mutation runs.
 *
 *   - `kind: "workspace-pin"` — canvas was a `ws:<id>` scope. The
 *     caller pins the feature onto that workspace canvas's
 *     `CanvasBlob.assignedFeatures` overlay; the Feature row itself
 *     is unchanged.
 *   - `kind: "initiative-attach"` — canvas was an `initiative:<id>`
 *     scope. The caller PATCHes `Feature.initiativeId` to attach the
 *     loose feature to this initiative; the canvas overlay isn't
 *     touched (the projector will emit the card on the next refresh).
 *
 * Both carry the picked `featureId`; the kind tag drives the mutation
 * shape and the fan-out helper. Keeping them in one type lets the
 * dialog be agnostic about which world it's in.
 */
export type FeatureAssignForm =
  | {
      kind: "workspace-pin";
      featureId: string;
      workspaceId: string;
    }
  | {
      kind: "initiative-attach";
      featureId: string;
      initiativeId: string;
    };

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
  /** Caller-controlled save for the Create-new path. Resolve to close the dialog. */
  onSave: (form: FeatureCreateForm) => Promise<void>;
  /**
   * Caller-controlled save for the Assign-existing path on a workspace
   * canvas. Only invoked when the user picks from the Assign-existing
   * tab; not used on root or initiative scopes (assign-existing isn't
   * meaningful there — features anchored to an initiative auto-render
   * on its sub-canvas via the projector). Optional so consumers that
   * never open the dialog on a workspace canvas don't have to wire
   * the second callback.
   */
  onAssign?: (form: FeatureAssignForm) => Promise<void>;
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
  onAssign,
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

  // ─── Tabs (workspace + initiative canvases) ─────────────────────────────────
  // The Assign-existing tab is meaningful on:
  //   - workspace canvas (pin onto `CanvasBlob.assignedFeatures`); OR
  //   - initiative canvas (attach via `Feature.initiativeId`).
  // Both paths require the caller to wire `onAssign`. On every other
  // scope (root, opaque) the tabs are hidden and the dialog renders
  // the original Create-new body verbatim.
  const showTabs =
    (scopeKind === "workspace" || scopeKind === "initiative") &&
    Boolean(onAssign);
  const [activeTab, setActiveTab] = useState<"create" | "assign">("create");
  /**
   * Default tab is always **Create new**, even when the Assign tab is
   * available. Reason: "+ Feature" reads naturally as "make me a new
   * one"; Assign-existing is the secondary path that surfaces when
   * the user already has the right feature elsewhere. Reset every
   * time the dialog re-opens so the second-time-around UX always
   * starts from Create.
   */
  useEffect(() => {
    if (!open) return;
    setActiveTab("create");
    // Clear any state the assign tab left behind from the previous
    // open so the second-time-around UX starts clean — particularly
    // the cached search query and selection.
    setAssignSelectedId("");
    setAssignSelectedTitle("");
    setAssignSearch("");
    setAssignWorkspaceFilter("");
    setAssignableFeatures([]);
    setAssignComboboxOpen(false);
  }, [open]);

  // Assign-tab state. Search-aware:
  //   - `assignSelectedId` / `assignSelectedTitle` — the currently
  //     picked feature (title cached so the combobox trigger shows
  //     the human label even after the candidate list is filtered
  //     down to a different slice).
  //   - `assignSearch` — what the user has typed in the combobox
  //     input. Server-side search kicks in at ≥3 chars; below that
  //     the empty-query list is what's shown (top N by `updatedAt`).
  //   - `assignWorkspaceFilter` — initiative-scope-only optional
  //     narrowing to a single workspace.
  //   - `assignableFeatures` — the latest fetched candidate list.
  //   - `assignLoading` — true while a fetch is in flight; flips to
  //     false on success/error/cancel.
  //   - `assignComboboxOpen` — local popover open state for the
  //     combobox trigger.
  const [assignSelectedId, setAssignSelectedId] = useState<string>("");
  const [assignSelectedTitle, setAssignSelectedTitle] = useState<string>("");
  const [assignSearch, setAssignSearch] = useState<string>("");
  /** "" = all workspaces in the org (initiative-scope filter only). */
  const [assignWorkspaceFilter, setAssignWorkspaceFilter] = useState<string>("");
  interface AssignableFeature {
    id: string;
    title: string;
    /** Workspace label, surfaced only on initiative scope where the list spans workspaces. */
    workspaceName?: string;
  }
  const [assignableFeatures, setAssignableFeatures] = useState<
    AssignableFeature[]
  >([]);
  const [assignLoading, setAssignLoading] = useState(false);
  const [assignComboboxOpen, setAssignComboboxOpen] = useState(false);

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

  // ─── Load assignable features for the Assign tab ───────────────────────────
  //
  // Server-side search with a 3-char gate, debounced 250ms. Two
  // flavors based on scope:
  //
  //   - **Workspace canvas**: list this workspace's features minus
  //     the ones already pinned in `Canvas.data.assignedFeatures`.
  //     `GET /api/features?workspaceId=...&search=...` + `GET
  //     ...canvas/assigned-features` in parallel; difference them
  //     client-side. The features route's `search` param does the
  //     server-side filtering.
  //
  //   - **Initiative canvas**: list loose features (no initiative,
  //     no milestone) across the org, optionally narrowed by a
  //     picked workspace filter and/or a typed query.
  //     `GET /api/orgs/[githubLogin]/initiatives/[initiativeId]/features?workspaceId=...&query=...`
  //     — the route handles the loose-feature filter + workspace IDOR
  //     check + the same 3-char query gate.
  //
  // **3-char gate.** When the typed query is between 1 and 2 chars,
  // we return early with an empty list — searching on 1 char is
  // noise (every feature title matches a vowel). The empty-query
  // path (query.length === 0) shows the top N by `updatedAt desc`,
  // which is the most useful default for "I'm looking for something
  // recent."
  //
  // **Debounce.** Each keystroke schedules a fetch 250ms in the
  // future; intermediate keystrokes cancel the prior schedule. The
  // `cancelled` ref pattern handles in-flight fetches whose response
  // arrives AFTER the next keystroke or after the dialog closes —
  // they self-discard.
  useEffect(() => {
    if (!open) return;
    if (!showTabs) return;
    const trimmedSearch = assignSearch.trim();
    // Bail on the 1-2 char in-between band — too noisy to be useful,
    // and lets the user see an explicit "keep typing" empty state.
    if (trimmedSearch.length > 0 && trimmedSearch.length < 3) {
      setAssignableFeatures([]);
      setAssignLoading(false);
      return;
    }

    let cancelled = false;
    setAssignLoading(true);

    const loadWorkspaceScope = async () => {
      if (!lockedWorkspaceId) return;
      const qs = new URLSearchParams({
        workspaceId: lockedWorkspaceId,
        limit: "100",
        sortBy: "updatedAt",
        sortOrder: "desc",
      });
      if (trimmedSearch.length >= 3) {
        qs.set("search", trimmedSearch);
      }
      const [featuresRes, assignedRes] = await Promise.all([
        fetch(`/api/features?${qs.toString()}`),
        fetch(
          `/api/orgs/${githubLogin}/canvas/assigned-features?ref=${encodeURIComponent(scope)}`,
        ),
      ]);
      if (cancelled) return;
      const featuresBody = featuresRes.ok ? await featuresRes.json() : null;
      const assignedBody = assignedRes.ok ? await assignedRes.json() : null;
      const rawFeatures: Array<{ id: string; title: string }> = Array.isArray(
        featuresBody?.data,
      )
        ? featuresBody.data
        : [];
      const pinned: string[] = Array.isArray(assignedBody?.featureIds)
        ? assignedBody.featureIds
        : [];
      const pinnedSet = new Set(pinned);
      const list: AssignableFeature[] = rawFeatures
        .filter((f) => !pinnedSet.has(f.id))
        .map((f) => ({ id: f.id, title: f.title }));
      setAssignableFeatures(list);
    };

    const loadInitiativeScope = async () => {
      if (!lockedInitiativeIdFromScope) return;
      const qs = new URLSearchParams();
      if (assignWorkspaceFilter) {
        qs.set("workspaceId", assignWorkspaceFilter);
      }
      if (trimmedSearch.length >= 3) {
        qs.set("query", trimmedSearch);
      }
      const url = `/api/orgs/${githubLogin}/initiatives/${lockedInitiativeIdFromScope}/features${qs.toString() ? `?${qs.toString()}` : ""}`;
      const res = await fetch(url);
      if (cancelled) return;
      const body = res.ok ? await res.json() : null;
      const raw: Array<{
        id: string;
        title: string;
        workspace?: { id: string; name: string } | null;
      }> = Array.isArray(body) ? body : [];
      const list: AssignableFeature[] = raw.map((f) => ({
        id: f.id,
        title: f.title,
        workspaceName: f.workspace?.name,
      }));
      setAssignableFeatures(list);
    };

    // Debounce the fetch by 250ms when the user is actively typing
    // (trimmedSearch >= 3). The empty-query path is fetched
    // immediately so the combobox opens with content already loaded
    // — there's no perceived typing latency on first open.
    const delay = trimmedSearch.length >= 3 ? 250 : 0;
    const timer = setTimeout(() => {
      const run = async () => {
        try {
          if (scopeKind === "workspace") {
            await loadWorkspaceScope();
          } else if (scopeKind === "initiative") {
            await loadInitiativeScope();
          }
        } catch (err) {
          // Non-fatal — empty list, no error chrome. Same end state
          // as "no candidates exist."
          console.error(
            "[CreateFeatureCanvasDialog] failed to load assignable features",
            err,
          );
          if (!cancelled) setAssignableFeatures([]);
        } finally {
          if (!cancelled) setAssignLoading(false);
        }
      };
      void run();
    }, delay);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    open,
    showTabs,
    scopeKind,
    githubLogin,
    lockedWorkspaceId,
    lockedInitiativeIdFromScope,
    scope,
    assignWorkspaceFilter,
    assignSearch,
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

  /** Whether the current Create-tab form is valid enough to submit. */
  const canSubmitCreate = useMemo(() => {
    if (!title.trim()) return false;
    if (!workspaceId) return false;
    if (scopeKind === "root" && !initiativeId) return false;
    return !saving;
  }, [title, workspaceId, initiativeId, scopeKind, saving]);

  /** Whether the Assign-tab form is valid enough to submit. */
  const canSubmitAssign = useMemo(() => {
    if (!showTabs) return false;
    if (!assignSelectedId) return false;
    // Each scope flavor needs its own anchor present: workspace needs
    // the locked workspace id (the pin's target canvas); initiative
    // needs the locked initiative id (the new value for
    // `Feature.initiativeId`). Reject early if the scope didn't lock
    // its required anchor — shouldn't happen given how `showTabs` is
    // gated, but defensive.
    if (scopeKind === "workspace" && !lockedWorkspaceId) return false;
    if (scopeKind === "initiative" && !lockedInitiativeIdFromScope) return false;
    return !saving;
  }, [
    showTabs,
    assignSelectedId,
    scopeKind,
    lockedWorkspaceId,
    lockedInitiativeIdFromScope,
    saving,
  ]);

  /** Active-tab-aware overall submit gate, driven by the dialog's footer. */
  const canSubmit =
    showTabs && activeTab === "assign" ? canSubmitAssign : canSubmitCreate;

  // ─── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!canSubmit) return;

    // Assign-existing branch. Two flavors:
    //   - workspace canvas → pin onto `Canvas.data.assignedFeatures`.
    //   - initiative canvas → PATCH `Feature.initiativeId`.
    // The dialog only emits the discriminated payload; the caller's
    // `onAssign` does the actual mutation (this keeps the dialog
    // unaware of REST routes — same pattern as `onSave`).
    if (showTabs && activeTab === "assign") {
      if (!onAssign) return;
      let payload: FeatureAssignForm | null = null;
      if (scopeKind === "workspace" && lockedWorkspaceId) {
        payload = {
          kind: "workspace-pin",
          featureId: assignSelectedId,
          workspaceId: lockedWorkspaceId,
        };
      } else if (scopeKind === "initiative" && lockedInitiativeIdFromScope) {
        payload = {
          kind: "initiative-attach",
          featureId: assignSelectedId,
          initiativeId: lockedInitiativeIdFromScope,
        };
      }
      if (!payload) return;
      setSaving(true);
      try {
        await onAssign(payload);
        onClose();
      } finally {
        setSaving(false);
      }
      return;
    }

    // Create-new branch (every scope, including workspace's Create tab).
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

  /** Create-new tab body. Extracted so the tabbed and non-tabbed
   *  renders share the exact same form. */
  const createBody = (
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
  );

  /**
   * Assign-existing tab body. Two flavors:
   *
   *   - **Workspace scope**: pin one of this workspace's existing
   *     features onto the canvas. Single dropdown; no extra filters.
   *   - **Initiative scope**: attach a loose feature (any workspace
   *     in the org, no current initiative, no current milestone) to
   *     this initiative. Two dropdowns: an optional workspace filter
   *     on top, the candidate feature dropdown underneath.
   *
   * Selecting saves through `onAssign` with the matching
   * `kind: "workspace-pin" | "initiative-attach"` payload — the
   * dialog stays unaware of the DB shape.
   */
  const assignBody = (
    <div className="grid gap-3 py-2">
      <div className="text-sm text-muted-foreground">
        {scopeKind === "workspace"
          ? "Pin one of this workspace's existing features onto the canvas. The feature's data is unchanged — only its visibility here."
          : "Attach a loose feature (one that isn't already under an initiative or milestone) to this initiative."}
      </div>

      {/* Initiative scope only: optional workspace filter. Empty value
          ("") means "show features from every workspace in the org",
          which is the most permissive default and matches what the
          user typed in the question they answered. */}
      {scopeKind === "initiative" && (
        <div className="grid gap-1.5">
          <Label>Workspace</Label>
          <Select
            value={assignWorkspaceFilter || "__all__"}
            onValueChange={(v) =>
              setAssignWorkspaceFilter(v === "__all__" ? "" : v)
            }
            disabled={workspaces.length === 0}
          >
            <SelectTrigger>
              <SelectValue placeholder="All workspaces" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All workspaces</SelectItem>
              {linkedWorkspaceIds.length > 0 && <SelectSeparator />}
              {sortedWorkspaces.map((w, i) => {
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
          <p className="text-xs text-muted-foreground">
            Optional — narrow the candidates to a single workspace, or
            leave as &quot;All workspaces&quot; to see every loose feature in
            the org.
          </p>
        </div>
      )}

      <div className="grid gap-1.5">
        <Label>Feature *</Label>
        {/*
         * Combobox (Popover + cmdk Command) instead of a plain Select.
         * Server-side search is wired through the load effect above —
         * typing into `<CommandInput>` updates `assignSearch` which
         * debounces a fetch with `?search=` (workspace) or `?query=`
         * (initiative). cmdk's built-in client-side filter is turned
         * OFF (`shouldFilter={false}`) so the server result is the
         * authoritative list; otherwise the client would also filter
         * the already-filtered server response and the user would see
         * a confusing "is this still loading?" empty state.
         */}
        <Popover
          open={assignComboboxOpen}
          onOpenChange={setAssignComboboxOpen}
        >
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-expanded={assignComboboxOpen}
              className={cn(
                "w-full justify-between font-normal",
                !assignSelectedId && "text-muted-foreground",
              )}
            >
              <span className="truncate">
                {assignSelectedTitle || "Select a feature…"}
              </span>
              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            className="w-[--radix-popover-trigger-width] p-0"
            align="start"
          >
            <Command shouldFilter={false}>
              <CommandInput
                placeholder="Search features…"
                value={assignSearch}
                onValueChange={setAssignSearch}
              />
              <CommandList>
                {/* Empty-state messaging branches on what the user
                    is currently doing: loading, typing-too-few-chars,
                    or no-results. Each is a distinct cue. */}
                <CommandEmpty>
                  {assignLoading
                    ? "Loading…"
                    : assignSearch.trim().length > 0 &&
                        assignSearch.trim().length < 3
                      ? "Type 3+ characters to search…"
                      : scopeKind === "workspace"
                        ? "No matching features in this workspace."
                        : "No matching loose features."}
                </CommandEmpty>
                <CommandGroup>
                  {assignableFeatures.map((f) => (
                    <CommandItem
                      key={f.id}
                      value={f.id}
                      onSelect={() => {
                        setAssignSelectedId(f.id);
                        setAssignSelectedTitle(f.title);
                        setAssignComboboxOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          assignSelectedId === f.id
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                      />
                      <span className="flex flex-1 items-center gap-2 truncate">
                        <span className="truncate">{f.title}</span>
                        {f.workspaceName && (
                          <span className="text-xs text-muted-foreground">
                            · {f.workspaceName}
                          </span>
                        )}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {showTabs && activeTab === "assign"
              ? scopeKind === "initiative"
                ? "Attach Feature"
                : "Add Feature"
              : "Create Feature"}
          </DialogTitle>
          {contextLine && (
            <DialogDescription>{contextLine}</DialogDescription>
          )}
        </DialogHeader>

        {showTabs ? (
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "create" | "assign")}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="create">Create new</TabsTrigger>
              <TabsTrigger value="assign">Assign existing</TabsTrigger>
            </TabsList>
            <TabsContent value="create">{createBody}</TabsContent>
            <TabsContent value="assign">{assignBody}</TabsContent>
          </Tabs>
        ) : (
          createBody
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {(() => {
              const isAssign = showTabs && activeTab === "assign";
              if (!isAssign) {
                return saving ? "Creating…" : "Create Feature";
              }
              // Distinct verbs for the two assign flavors so the
              // button reads correctly with the corresponding tab title.
              if (scopeKind === "initiative") {
                return saving ? "Attaching…" : "Attach Feature";
              }
              return saving ? "Adding…" : "Add Feature";
            })()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
