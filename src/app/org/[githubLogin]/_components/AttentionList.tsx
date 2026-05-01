"use client";

/**
 * Renders the synthetic "top items needing your attention" intro
 * card that seeds the canvas chat on fresh entry. Driven by an
 * `attention-list` artifact registered in the canvas chat store —
 * see `OrgCanvasView.tsx` for the seed flow and
 * `services/attention/topItems.ts` for the data shape.
 *
 * The card is *advisory* — no actions, just a deep-linked list. Each
 * row is a `<Link>` that navigates the user to the relevant feature
 * plan or task page, where they can actually act on the item.
 *
 * Visual language is intentionally aligned with `<ProposalCard>` so
 * that as the chat accrues different artifact types they share a
 * coherent card vocabulary (rounded border, muted card background,
 * uppercase tracking-wide metadata, compact text-sm titles).
 */
import { AlertTriangle, MessageCircleQuestion, CheckCircle2, ChevronRight, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { mostSpecificRef } from "@/lib/canvas/feature-projection";
import type { AttentionItem } from "@/services/attention/topItems";

interface AttentionListProps {
  items: AttentionItem[];
  /** Total before the cap was applied — drives the "+N more" hint. */
  total?: number;
  /** Click-handler for the × button. Caller wires sessionStorage. */
  onDismiss?: () => void;
}

/**
 * Compute where to send the user when they click an attention item.
 *
 * Returns one of:
 *   - `inCanvas` — drill into the org canvas at `canvasRef`, select
 *     the live node `selectId`. Both the camera drill and the right-
 *     panel auto-flip to Details (with embedded `<FeaturePlanChat>`
 *     for features) light up automatically once `?canvas=&select=`
 *     are pushed onto the URL.
 *   - `external` — entity isn't reachable from any canvas. Today
 *     this is tasks whose parent feature has no milestone (the
 *     milestone canvas is the only place tasks project as nodes —
 *     see `projectors.ts`); orphan tasks (`featureId === null`) also
 *     fall through. Open the workspace-scoped page in a new tab so
 *     the org-canvas context survives.
 */
function resolveTarget(
  item: AttentionItem,
):
  | { kind: "inCanvas"; canvasRef: string; selectId: string }
  | { kind: "external"; href: string } {
  if (item.entityKind === "feature") {
    // Every feature has a workspaceId by schema, so `mostSpecificRef`
    // always returns a valid feature-bearing scope (`milestone:` ⊃
    // `initiative:` ⊃ `ws:`). `feature.id` is the live node id on
    // every projector that emits it.
    if (!item.workspaceId) return { kind: "external", href: item.link };
    return {
      kind: "inCanvas",
      canvasRef: mostSpecificRef({
        workspaceId: item.workspaceId,
        initiativeId: item.initiativeId,
        milestoneId: item.milestoneId,
      }),
      selectId: `feature:${item.entityId}`,
    };
  }
  // Task path. Tasks project as nodes only on milestone canvases
  // (under their parent feature column). When the parent feature has
  // a milestone, that's the natural drill-target — the task node is
  // visible AND selecting it mounts `TaskChat` in the right panel.
  //
  // Without a milestone, the task isn't a canvas node anywhere, but
  // we still want the user to land in `TaskChat` (the whole point
  // of the AttentionList click is "answer the agent's question").
  // Drill into the parent feature's projection canvas (initiative-
  // loose feature → `initiative:<id>`; loose feature → `ws:<id>`)
  // and seed the task selection. The right panel auto-flips to
  // Details, fetches the task by id, and mounts `TaskChat` —
  // independent of whether a `task:<id>` node renders on the canvas.
  if (item.workspaceId) {
    const canvasRef = mostSpecificRef({
      workspaceId: item.workspaceId,
      initiativeId: item.initiativeId,
      milestoneId: item.milestoneId,
    });
    return {
      kind: "inCanvas",
      canvasRef,
      selectId: `task:${item.entityId}`,
    };
  }
  // Last resort — workspaceId missing (shouldn't happen given the
  // schema, but defensive against partial API responses).
  return { kind: "external", href: item.link };
}

interface TypeMeta {
  Icon: typeof AlertTriangle;
  label: string;
  /** Tailwind color class for the icon — matches ProposalCard's tone-on-card pattern. */
  iconClass: string;
}

const TYPE_META: Record<AttentionItem["type"], TypeMeta> = {
  halted: {
    Icon: AlertTriangle,
    label: "Halted",
    // Amber rather than rose: the card is advisory ("here's what
    // needs you"), not an error state. A red icon reads as "system
    // failure" to the user when really the workflow is just stuck
    // waiting for them. Tonally aligned with the other warning-class
    // signals (awaiting-reply, plan-question).
    iconClass: "text-amber-500",
  },
  "awaiting-reply": {
    Icon: MessageCircleQuestion,
    label: "Awaiting your reply",
    iconClass: "text-amber-500",
  },
  "plan-question": {
    Icon: MessageCircleQuestion,
    label: "Question waiting",
    iconClass: "text-amber-500",
  },
  "ready-to-review": {
    Icon: CheckCircle2,
    label: "Ready to review",
    iconClass: "text-emerald-500",
  },
};

/**
 * Format an age in ms as a compact human-readable string. Mirrors
 * the convention used in dashboard widgets ("2h ago", "yesterday").
 */
function formatAge(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 5) return `${wk}w ago`;
  const mo = Math.floor(day / 30);
  return `${mo}mo ago`;
}

export function AttentionList({ items, total, onDismiss }: AttentionListProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  /**
   * Push `?canvas=<ref>&select=<liveId>` onto the current org-canvas
   * URL while preserving any other query params (notably `?c=` for
   * the connection viewer and `?chat=` for shared chats). Uses
   * `replace` rather than `push` so the click doesn't add a history
   * entry the user has to back-button through — this is more like
   * "rearrange what I'm looking at" than "navigate forward."
   */
  const navigateInCanvas = useCallback(
    (canvasRef: string, selectId: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("canvas", canvasRef);
      params.set("select", selectId);
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  if (items.length === 0) return null;
  const overflow = total !== undefined && total > items.length
    ? total - items.length
    : 0;

  return (
    <div className="rounded-lg border bg-card text-card-foreground">
      <div className="flex items-center justify-between px-3 pt-2 pb-1">
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-medium">
          Top {items.length} for you
        </span>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            title="Hide for this session"
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      <ul className="divide-y divide-border/60">
        {items.map((item) => {
          const meta = TYPE_META[item.type];
          const Icon = meta.Icon;
          const target = resolveTarget(item);
          const handleClick = () => {
            if (target.kind === "inCanvas") {
              navigateInCanvas(target.canvasRef, target.selectId);
            } else {
              // External fallback: open the workspace-scoped page in
              // a new tab so the user doesn't lose their org-canvas
              // context. `noopener,noreferrer` is the standard hygiene.
              window.open(target.href, "_blank", "noopener,noreferrer");
            }
          };
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={handleClick}
                className="group flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
              >
                <div className="mt-0.5 flex-shrink-0">
                  <Icon className={`h-3.5 w-3.5 ${meta.iconClass}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    <span className="font-medium">{meta.label}</span>
                    <span aria-hidden>·</span>
                    <span className="truncate">{item.workspaceName}</span>
                  </div>
                  <div className="mt-0.5 break-words text-sm font-medium leading-snug">
                    {item.title}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {item.entityKind === "feature" ? "Feature" : "Task"} ·{" "}
                    {formatAge(item.ageMs)}
                  </div>
                </div>
                <ChevronRight className="mt-1 h-3.5 w-3.5 flex-shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" />
              </button>
            </li>
          );
        })}
      </ul>
      {overflow > 0 && (
        <div className="px-3 py-1.5 text-[11px] text-muted-foreground border-t">
          +{overflow} more {overflow === 1 ? "item" : "items"} need attention
        </div>
      )}
    </div>
  );
}
