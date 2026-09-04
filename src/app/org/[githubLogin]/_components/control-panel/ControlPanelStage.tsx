"use client";

import { useEffect, useMemo, useState } from "react";
import type { CanvasNode } from "system-canvas";
import { AlertTriangle, CheckCircle2, Loader2, MessageCircleQuestion, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PlanChatView } from "@/app/w/[slug]/plan/[featureId]/components/PlanChatView";
import type { AttentionItem } from "@/services/attention/topItems";
import { ATTENTION_TYPE_META, ATTENTION_TYPE_ORDER } from "@/services/attention/typeMeta";
import type { ControlPanelItem } from "@/types/control-panel";
import { useAttentionMapContext } from "../../connections/AttentionMapContext";
import { focusNodeIdOf, type ControlPanelFocus } from "./types";

/**
 * The pieces of the control panel's stage. The stage itself is the org
 * page's right panel in control panel mode (`OrgRightPanel`), which
 * keeps the same mounted `<SidebarChat>` across the switch; these are
 * what it adds around the chat — the briefing, the real plan page for a
 * plan, and the synthetic node a task renders through `NodeDetail`.
 */

export interface ControlPanelStageProps {
  focus: ControlPanelFocus;
  /** The list row for the focused plan, when it is in the list (its workspace, for the plan page). */
  focusedItem: ControlPanelItem | null;
  onFocusChange: (focus: ControlPanelFocus) => void;
  /** Back to the canvas. */
  onExit: () => void;
}

// ─── Briefing ───────────────────────────────────────────────────────────

const BRIEFING_TOP_N = 3;
const briefingDismissKey = (githubLogin: string) => `hive:control-panel-briefing-dismissed:${githubLogin}`;

const BRIEFING_ICON = {
  "alert-triangle": AlertTriangle,
  "message-circle-question": MessageCircleQuestion,
  "check-circle-2": CheckCircle2,
} as const;

/** What an attention item puts on stage. */
export function focusForAttentionItem(item: AttentionItem): ControlPanelFocus {
  return item.entityKind === "feature"
    ? { kind: "plan", id: item.entityId }
    : { kind: "task", id: item.entityId, planId: item.featureId ?? undefined, title: item.title };
}

interface ControlPanelBriefingProps {
  githubLogin: string;
  onOpen: (item: AttentionItem) => void;
  className?: string;
}

/**
 * Landing briefing: what needs the user across the org, from the same
 * attention feed the canvas intro and the Live Now panel read. Counts
 * per signal, the top three items, dismissable for the session.
 */
export function ControlPanelBriefing({ githubLogin, onOpen, className }: ControlPanelBriefingProps) {
  const { items, lastUpdatedAt } = useAttentionMapContext();
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    try {
      setDismissed(sessionStorage.getItem(briefingDismissKey(githubLogin)) === "1");
    } catch {
      setDismissed(false);
    }
  }, [githubLogin]);

  const summary = useMemo(() => {
    const counts = new Map<AttentionItem["type"], number>();
    for (const item of items) counts.set(item.type, (counts.get(item.type) ?? 0) + 1);
    const parts = (Object.keys(ATTENTION_TYPE_ORDER) as AttentionItem["type"][])
      .sort((a, b) => ATTENTION_TYPE_ORDER[a] - ATTENTION_TYPE_ORDER[b])
      .filter((type) => (counts.get(type) ?? 0) > 0)
      .map((type) => `${counts.get(type)} ${ATTENTION_TYPE_META[type].label.toLowerCase()}`);
    return parts.join(" · ");
  }, [items]);

  if (dismissed || items.length === 0) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(briefingDismissKey(githubLogin), "1");
    } catch {
      // Session storage unavailable — the card just comes back next load.
    }
  };

  return (
    <div className={cn("rounded-lg border bg-card text-card-foreground", className)}>
      <div className="flex items-start justify-between gap-3 px-3 pt-2.5">
        <div className="min-w-0">
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Needs you now · {items.length} across the org
          </span>
          <p className="mt-0.5 text-sm">{summary}</p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          title="Hide for this session"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <ul className="mt-1 divide-y divide-border/60">
        {items.slice(0, BRIEFING_TOP_N).map((item) => {
          const meta = ATTENTION_TYPE_META[item.type];
          const Icon = BRIEFING_ICON[meta.iconName];
          return (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => onOpen(item)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted/60"
              >
                <Icon className={cn("h-3.5 w-3.5 shrink-0", meta.colorClass)} />
                <span className="min-w-0 flex-1 truncate text-sm">{item.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {item.workspaceName} · {meta.label}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {lastUpdatedAt > 0 && (
        <p className="border-t px-3 py-1.5 text-[10px] text-muted-foreground">
          Updated {new Date(lastUpdatedAt).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}

// ─── The plan on stage: the real plan page ──────────────────────────────

interface FeatureWorkspacePayload {
  data?: { workspace?: { id?: string; slug?: string } };
}

/**
 * A plan on stage is the plan page itself — `PlanChatView`: its chat
 * and the PLAN / TASKS / VERIFY panel — not a re-creation of it. It
 * needs the plan's workspace; a list row already knows it, anything
 * else (the briefing, a task's "back to plan") asks the feature
 * endpoint first.
 */
export function PlanStage({
  featureId,
  workspace,
  onBack,
}: {
  featureId: string;
  workspace: { id: string; slug: string } | null;
  /** The plan page's back arrow: back to the Jamie chat. */
  onBack: () => void;
}) {
  const [resolved, setResolved] = useState<{ id: string; slug: string } | null>(workspace);
  const [missing, setMissing] = useState(false);
  const knownId = workspace?.id ?? null;
  const knownSlug = workspace?.slug ?? null;

  useEffect(() => {
    setMissing(false);
    if (knownId && knownSlug) {
      setResolved({ id: knownId, slug: knownSlug });
      return;
    }
    setResolved(null);
    let cancelled = false;
    fetch(`/api/features/${featureId}`)
      .then((res) => (res.ok ? (res.json() as Promise<FeatureWorkspacePayload>) : null))
      .then((payload) => {
        if (cancelled) return;
        const ws = payload?.data?.workspace;
        if (ws?.id && ws.slug) setResolved({ id: ws.id, slug: ws.slug });
        else setMissing(true);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [featureId, knownId, knownSlug]);

  if (missing) {
    return <p className="px-4 py-8 text-center text-sm text-muted-foreground">This plan is gone.</p>;
  }
  if (!resolved) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  // The plan page is two rounded cards; inset them from the bar and the
  // divider the way the briefing card is, rather than flush on the lines.
  return (
    <div className="h-full min-h-0 p-3">
      <PlanChatView
        key={featureId}
        featureId={featureId}
        workspaceSlug={resolved.slug}
        workspaceId={resolved.id}
        embedded
        onBack={onBack}
      />
    </div>
  );
}

// ─── The node a task renders through NodeDetail ─────────────────────────

/**
 * Synthetic canvas node for `NodeDetail` — the same trick the `?r=`
 * research deep link uses: only id / text / category are read. Plans
 * get the real plan page instead (`PlanStage`); this is for tasks.
 */
export function taskNodeFor(focus: ControlPanelFocus): CanvasNode | null {
  if (focus.kind !== "task") return null;
  return { id: focusNodeIdOf(focus), text: focus.title ?? "", category: "task" } as unknown as CanvasNode;
}
