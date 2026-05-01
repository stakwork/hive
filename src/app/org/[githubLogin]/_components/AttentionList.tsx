"use client";

/**
 * Renders the synthetic "top items needing your attention" intro
 * card that seeds the canvas chat on fresh entry. Driven by an
 * `attention-list` artifact registered in the canvas chat store —
 * see `OrgCanvasView.tsx` for the seed flow and
 * `services/attention/topItems.ts` for the data shape.
 *
 * The card is *advisory* — no actions, just a list of pointers. Each
 * row opens the relevant feature plan or task page in a new tab,
 * where the user can actually act on the item. We deliberately don't
 * try to drill the org canvas in-place: that flow used to write
 * `?canvas=&select=` and round-trip through the canvas's URL sync,
 * which raced with the library's breadcrumb-back path and bounced
 * the user back into sub-canvases they had just exited.
 *
 * Visual language is intentionally aligned with `<ProposalCard>` so
 * that as the chat accrues different artifact types they share a
 * coherent card vocabulary (rounded border, muted card background,
 * uppercase tracking-wide metadata, compact text-sm titles).
 */
import { AlertTriangle, MessageCircleQuestion, CheckCircle2, ChevronRight, X } from "lucide-react";
import type { AttentionItem } from "@/services/attention/topItems";

interface AttentionListProps {
  items: AttentionItem[];
  /** Total before the cap was applied — drives the "+N more" hint. */
  total?: number;
  /** Click-handler for the × button. Caller wires sessionStorage. */
  onDismiss?: () => void;
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
          // Always open the workspace-scoped page in a new tab. We
          // previously had an "in-canvas" mode that drilled to the
          // feature/task's projection canvas via `?canvas=&select=`,
          // but the URL-driven sync with the canvas's internal scope
          // state proved fragile (router.replace lags useSearchParams
          // by a render, breadcrumb-back was bouncing right back into
          // the sub-canvas). External-tab navigation preserves the
          // user's org-canvas state and is the path the user
          // ultimately needs to act on the item anyway.
          const handleClick = () => {
            window.open(item.link, "_blank", "noopener,noreferrer");
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
