"use client";

import { useEffect, useState } from "react";
import type { CanvasNode } from "system-canvas";
import { Loader2 } from "lucide-react";
import { PlanChatView } from "@/app/w/[slug]/plan/[featureId]/components/PlanChatView";
import type { ControlPanelItem } from "@/types/control-panel";
import { focusNodeIdOf, type ControlPanelFocus } from "./types";

/**
 * The pieces of the control panel's stage. The stage itself is the org
 * page's right panel in control panel mode (`OrgRightPanel`), which
 * keeps the same mounted `<SidebarChat>` across the switch; these are
 * what it adds around the chat — the real plan page for a plan, and the
 * synthetic node a task renders through `NodeDetail`.
 */

export interface ControlPanelStageProps {
  focus: ControlPanelFocus;
  /** The list row for the focused plan, when it is in the list (its workspace, for the plan page). */
  focusedItem: ControlPanelItem | null;
  onFocusChange: (focus: ControlPanelFocus) => void;
  /** Back to the canvas. */
  onExit: () => void;
}

// ─── The plan on stage: the real plan page ──────────────────────────────

interface FeatureWorkspacePayload {
  data?: { workspace?: { id?: string; slug?: string } };
}

/**
 * A plan on stage is the plan page itself — `PlanChatView`: its chat
 * and the PLAN / TASKS / VERIFY panel — not a re-creation of it. It
 * needs the plan's workspace; a list row already knows it, anything
 * else (a task's "back to plan", a deep link) asks the feature
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
  // divider rather than flush on the lines.
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
