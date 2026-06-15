"use client";

import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  PlanArtifactPanel,
  type PlanData,
  type PlanSection,
} from "@/app/w/[slug]/plan/[featureId]/components/PlanArtifact";

/**
 * FeaturePlanDialog — a "View Plan" affordance for a feature the canvas
 * agent is managing via `send_to_feature_planner` (see `SubAgentRunCard`).
 *
 * The canvas chat only talks to the planner; the actual plan content
 * (brief / user stories / requirements / architecture) lives on the
 * `Feature` row and is rendered on the per-feature plan page. This pulls
 * that same content into a read-only modal so the user can read the plan
 * without leaving the canvas.
 *
 * **Self-gating.** On mount it fetches the feature once; if NO plan part
 * has content yet, it renders nothing (no button). The button only
 * appears "if plan parts exist." The component is meant to be mounted
 * lazily (e.g. only when the parent card is expanded) so the fetch is
 * paid for on demand.
 *
 * **Read-only.** `PlanArtifactPanel` becomes non-editable when no
 * `onSectionSave` is passed — the canonical plan renderer reused from the
 * full plan page, so formatting stays identical.
 */

interface FeatureApiResponse {
  brief?: string | null;
  requirements?: string | null;
  architecture?: string | null;
  title?: string | null;
  userStories?: { title: string }[];
}

/**
 * Build the canonical `PlanData` from a feature API payload. Mirrors the
 * transform in `PlanChatView` so the modal renders identically to the
 * full plan page. Only sections with content are kept — the modal is a
 * read-only viewer, so empty "No X yet" placeholders would just be noise.
 */
function buildPlanData(feature: FeatureApiResponse): PlanData {
  const stories = feature.userStories ?? [];
  let userStoriesContent: string | null = null;
  if (stories.length === 1) userStoriesContent = stories[0].title;
  else if (stories.length > 1)
    userStoriesContent = stories.map((s) => `- ${s.title}`).join("\n");

  const sections: PlanSection[] = [
    { key: "brief", label: "Brief", content: feature.brief || null },
    { key: "user-stories", label: "User Stories", content: userStoriesContent },
    { key: "requirements", label: "Requirements", content: feature.requirements || null },
    { key: "architecture", label: "Architecture", content: feature.architecture || null },
  ].filter((s) => Boolean(s.content));

  return { featureTitle: feature.title || null, sections };
}

interface FeaturePlanDialogProps {
  featureId: string;
  /** Fallback title while the fetch is in flight / if the API omits it. */
  featureTitle?: string;
}

export function FeaturePlanDialog({
  featureId,
  featureTitle,
}: FeaturePlanDialogProps) {
  const [planData, setPlanData] = useState<PlanData | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/features/${featureId}`);
        if (!res.ok) return;
        const json = await res.json();
        const feature = (json?.data ?? null) as FeatureApiResponse | null;
        if (!feature || cancelled) return;
        const data = buildPlanData(feature);
        // Self-gate: only surface the button when a plan part exists.
        if (data.sections.length > 0) setPlanData(data);
      } catch {
        // Silent — a missing plan just means no button, not an error UI.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [featureId]);

  if (!planData) return null;

  const title = planData.featureTitle || featureTitle || "Plan";

  return (
    <div className="px-3 pb-2.5">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      >
        <FileText className="h-3.5 w-3.5" />
        View plan
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl gap-0 p-0 sm:max-w-2xl">
          <DialogHeader className="border-b px-5 py-4">
            <DialogTitle className="truncate pr-6">{title}</DialogTitle>
          </DialogHeader>
          <div className="h-[70vh]">
            <PlanArtifactPanel planData={planData} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
