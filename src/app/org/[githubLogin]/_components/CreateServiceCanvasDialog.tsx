"use client";

/**
 * "Create Service" dialog. Opens when the user picks `+ Service` from
 * the canvas add-node menu on a workspace sub-canvas. Two fields:
 *
 *   1. **Name** — the user's free-text label for the service. Lands in
 *      `node.text` (the canvas's title slot). Required, but defaults to
 *      the picked platform's `label` so hitting Enter immediately is a
 *      valid path (the user gets a card titled "Vercel" without typing).
 *
 *   2. **Platform** — a searchable grid of brand icons sourced from
 *      `@/lib/platforms`. The chosen `Platform.id` lands in
 *      `node.customData.kind` — the canonical integration dispatch key
 *      (a future "click this service to see Vercel deploys" flow reads
 *      exactly this field). Required; defaults to `"cloud"` so the card
 *      always has a glyph even if the user just slams Enter.
 *
 * The dialog only owns the form and the search UX. Saving (the actual
 * `addNode` mutation on the canvas) is the caller's job — same pattern
 * as `InitiativeDialog` / `MilestoneDialog` / `CreateFeatureCanvasDialog`.
 *
 * No DB write happens — `service` is a pure authored node (id stays a
 * normal authored cuid, not `service:<x>`). The library handles the
 * canvas write through `OrgCanvasBackground.handleNodeAdd` after this
 * dialog resolves.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { NodeIcon } from "system-canvas-react/primitives";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PLATFORM_ICONS, PLATFORMS, type Platform } from "@/lib/platforms";

/**
 * Default platform id when the user opens the dialog. The `cloud` entry
 * is one of the registry's generic-primitive platforms (line glyph from
 * the lib's built-in icon set), chosen because it carries no brand
 * baggage — picking "cloud" doesn't suggest AWS over GCP, so it's
 * neutral default UX. Hitting Enter immediately on the default dialog
 * state produces a card labeled "Cloud" with the cloud silhouette.
 */
const DEFAULT_KIND = "cloud";

/**
 * Submission shape returned to the caller. Caller stitches these into
 * a `CanvasNode` (with id, x/y, width/height from `OrgCanvasBackground`)
 * before calling `addNode`.
 */
export interface CreateServiceFormResult {
  /** User's free-text name. Lands in `node.text`. */
  name: string;
  /** Platform id; the slug from `@/lib/platforms`. Lands in `customData.kind`. */
  kind: string;
}

export interface CreateServiceCanvasDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (form: CreateServiceFormResult) => void | Promise<void>;
}

export function CreateServiceCanvasDialog({
  open,
  onClose,
  onSave,
}: CreateServiceCanvasDialogProps) {
  // Form state. Reset every time the dialog opens so a previous
  // half-typed name doesn't bleed into the next add-flow.
  const [name, setName] = useState("");
  const [kind, setKind] = useState(DEFAULT_KIND);
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setKind(DEFAULT_KIND);
      setQuery("");
      setSubmitting(false);
      // Focus the name field on open. The platform picker defaults to
      // a sane "cloud" glyph + the picked platform's label as the
      // placeholder, so the user only needs to type a name (and pick a
      // platform afterward if they want something specific). Tab from
      // here lands in the search input. Delay one frame so it runs
      // after the dialog mounts and the Radix focus trap settles.
      setTimeout(() => nameRef.current?.focus(), 0);
    }
  }, [open]);

  /**
   * Filter platforms by `query`. Matches `label` and `aliases` (case-
   * insensitive substring). Empty query shows the full list in source
   * order. We deliberately don't sort by "popularity" or recency today —
   * source order is a curated grouping (frontend / AWS / databases / ...)
   * which is easier to scan than an alphabetized soup.
   */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return PLATFORMS;
    return PLATFORMS.filter((p) => {
      if (p.label.toLowerCase().includes(q)) return true;
      if (p.id.includes(q)) return true;
      if (p.aliases?.some((a) => a.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [query]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (submitting) return;
    // If the user didn't type a name, use the picked platform's label.
    // "Vercel" / "Postgres" / "Stripe" are all valid card titles, and
    // it means hitting Enter immediately on the default dialog state
    // produces a "Cloud" card — sensible no-input behavior.
    const trimmed = name.trim();
    const platform = PLATFORM_LOOKUP[kind];
    const finalName = trimmed || platform?.label || "Service";
    setSubmitting(true);
    try {
      await onSave({ name: finalName, kind });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add service</DialogTitle>
          <DialogDescription>
            Pick a platform and give it a name. The icon and platform key
            are stored on the node so future integrations can light up.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name field */}
          <div className="space-y-2">
            <Label htmlFor="service-name">Name</Label>
            <Input
              id="service-name"
              ref={nameRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={PLATFORM_LOOKUP[kind]?.label ?? "Service"}
              autoComplete="off"
            />
          </div>

          {/* Platform picker */}
          <div className="space-y-2">
            <Label>Platform</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search Vercel, EC2, Postgres..."
                className="pl-9"
                autoComplete="off"
              />
            </div>
            <PlatformGrid
              platforms={filtered}
              selected={kind}
              onSelect={setKind}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Adding…" : "Add service"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * O(1) lookup by id for the form's behavioral defaults (placeholder
 * text, fallback name). Built once at module load. Module-local because
 * the registry already exports its own `PLATFORM_BY_ID` — this duplicate
 * exists only so this file is self-contained for the placeholder /
 * fallback-name reads. (Importing both costs an extra symbol; the
 * micro-cost of rebuilding it here is fine.)
 */
const PLATFORM_LOOKUP: Record<string, Platform> = Object.fromEntries(
  PLATFORMS.map((p) => [p.id, p]),
);

// ---------------------------------------------------------------------------
// PlatformGrid — searchable, keyboard-friendly icon picker.
//
// Renders the filtered platforms as a 6-column scrollable grid of icon
// tiles. Each tile shows the platform's simple-icons silhouette painted
// in foreground color + the platform label below. Selected tile has an
// accent ring; hovering shows a subtle background. Empty filter results
// render a "No matches" placeholder.
//
// Icons are drawn inline as `<svg>` so we don't need to pipe paths
// through the canvas's `NodeIcon` (which lives in the lib and is sized
// for canvas-space). Same path data — just scaled to a 28×28 tile glyph.
// ---------------------------------------------------------------------------

function PlatformGrid({
  platforms,
  selected,
  onSelect,
}: {
  platforms: Platform[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  if (platforms.length === 0) {
    return (
      <div className="rounded-md border border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        No matching platforms. Try a different search term, or pick a
        generic icon (cloud / server / database) by clearing the search.
      </div>
    );
  }

  return (
    <div className="max-h-72 overflow-y-auto rounded-md border border-border bg-muted/20 p-2">
      <div className="grid grid-cols-6 gap-1">
        {platforms.map((p) => (
          <PlatformTile
            key={p.id}
            platform={p}
            selected={p.id === selected}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Render the platform's icon inside a fixed 22×22 svg. Two code paths
 * by `Platform.renderMode`:
 *
 *   - `'fill'` (default; simple-icons brand glyphs) — paint each path
 *     in 24-viewBox space with `fill="currentColor"` and `evenodd`
 *     winding. This was the only path before generic platforms landed,
 *     and the inline render is a perfect parity of what the canvas
 *     surface renders via `kind: 'icon'` + `mode: 'fill'` + `viewBox: 24`.
 *
 *   - `'stroke'` (generic primitives — server, database, cloud, ...) —
 *     defer to the lib's `NodeIcon` primitive. It carries the canonical
 *     16-viewBox built-in paths (`iconPaths` inside `NodeIcon.js`) and
 *     handles the scaling + line styling so the picker preview and the
 *     on-canvas render look identical. Generics have empty `paths` in
 *     our registry; this branch is the only thing that draws them.
 *
 * Both flavors paint with `currentColor` so the tile's selected /
 * unselected color (driven by the wrapping `<button>` className) flows
 * through to the glyph.
 */
function PlatformGlyph({ platform }: { platform: Platform }) {
  const size = 22;
  if (platform.renderMode === "stroke") {
    return (
      <svg width={size} height={size} aria-hidden>
        <NodeIcon
          icon={platform.id}
          x={0}
          y={0}
          size={size}
          color="currentColor"
          opacity={1}
          mode="stroke"
          viewBox={platform.viewBox ?? 16}
          // Pass the consumer-side icon map too so the same lookup
          // logic the canvas uses applies here — keeps the tile and
          // the on-canvas render in lockstep.
          customIcons={PLATFORM_ICONS}
        />
      </svg>
    );
  }
  return (
    <svg
      viewBox={`0 0 ${platform.viewBox ?? 24} ${platform.viewBox ?? 24}`}
      width={size}
      height={size}
      aria-hidden
    >
      {platform.paths.map((d, i) => (
        <path key={i} d={d} fill="currentColor" fillRule="evenodd" />
      ))}
    </svg>
  );
}

function PlatformTile({
  platform,
  selected,
  onSelect,
}: {
  platform: Platform;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(platform.id)}
      className={
        "flex flex-col items-center gap-1.5 rounded-md p-2 text-xs transition-colors " +
        // Painted with currentColor so the glyph follows the tile's
        // text color — selected tiles render in full foreground,
        // unselected ones in muted (matching the label below).
        (selected
          ? "bg-primary/15 text-foreground ring-1 ring-primary"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")
      }
      title={platform.label}
    >
      <PlatformGlyph platform={platform} />
      <span className="truncate text-[10px] leading-tight max-w-full">
        {platform.label}
      </span>
    </button>
  );
}
