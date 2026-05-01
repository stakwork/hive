"use client";

import { useState } from "react";
import {
  Code,
  Diff,
  FileText,
  Globe,
  Image as ImageIcon,
  Workflow,
  Layers,
  Bug,
  Megaphone,
  Coins,
  ExternalLink,
} from "lucide-react";
import { type Artifact, type ArtifactType } from "@/lib/chat";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
// Reused panel renderers from the full task page. Each is self-
// contained for the artifact types we open in the modal — they
// either need only the artifact array (most) or the artifact +
// `workflowUrl` (LONGFORM). Heavier panels (BROWSER / WORKFLOW /
// GRAPH / IDE) need workspace + pod context and are intentionally
// NOT mounted here — see `kindMeta` below for the fallback path
// that opens the full task page in a new tab.
import { CodeArtifactPanel } from "@/app/w/[slug]/task/[...taskParams]/artifacts/code";
import { DiffArtifactPanel } from "@/app/w/[slug]/task/[...taskParams]/artifacts/diff";
import { LongformArtifactPanel } from "@/app/w/[slug]/task/[...taskParams]/artifacts/longform";
import { BountyArtifact } from "@/app/w/[slug]/task/[...taskParams]/artifacts/bounty";
import { PublishWorkflowArtifact } from "@/app/w/[slug]/task/[...taskParams]/artifacts/publish-workflow";

/**
 * Compact pill-as-button for a non-FORM, non-PULL_REQUEST artifact in
 * the canvas-sidebar task chat. Click behavior is type-dependent:
 *
 *   - `inModal` types (CODE, DIFF, LONGFORM, BOUNTY, PUBLISH_WORKFLOW)
 *     open a large `<Dialog>` mounting the matching artifact panel
 *     from the full task page. The reused panels are render-only
 *     (no workspace/pod context required), so they work cleanly
 *     in a modal divorced from the task layout.
 *
 *   - `external` types (BROWSER, IDE, MEDIA, STREAM, BUG_REPORT,
 *     WORKFLOW, GRAPH, TASKS, VERIFY, PLAN-non-clarifying) open
 *     the full task page in a new tab. These artifacts depend on
 *     rich workspace context — pod browser sessions, workflow
 *     editor state, graph data — that doesn't survive a modal-only
 *     mount. The pill makes the artifact's existence visible
 *     without trying to fake an inline render.
 *
 * The icon + label vocabulary mirrors what the full task page
 * surfaces in its artifact-panel tabs, so users see consistent
 * "this is a Code artifact" cues across surfaces.
 */
interface TaskArtifactPillProps {
  artifact: Artifact;
  /** Workspace-scoped task page URL — used by the external fallback. */
  taskHref: string;
  /**
   * Optional `workflowUrl` from the parent message. Only consumed by
   * `LONGFORM` (the artifact panel renders it as a footer link).
   */
  workflowUrl?: string | null;
}

interface PillKind {
  Icon: typeof Code;
  label: string;
  /** Tailwind tone class for the icon. */
  iconClass: string;
  /**
   * `inModal` — render in the large dialog using the matching panel
   *   component (mapped in `renderModalBody` below).
   * `external` — clicking opens the full task page in a new tab.
   *   Used for artifact types whose renderers need workspace/pod
   *   context the canvas surface doesn't have.
   */
  mode: "inModal" | "external";
}

const KIND_META: Partial<Record<ArtifactType | string, PillKind>> = {
  CODE: { Icon: Code, label: "Code", iconClass: "text-blue-500", mode: "inModal" },
  DIFF: { Icon: Diff, label: "Diff", iconClass: "text-emerald-500", mode: "inModal" },
  LONGFORM: { Icon: FileText, label: "Report", iconClass: "text-violet-500", mode: "inModal" },
  BOUNTY: { Icon: Coins, label: "Bounty", iconClass: "text-amber-500", mode: "inModal" },
  PUBLISH_WORKFLOW: { Icon: Megaphone, label: "Publish workflow", iconClass: "text-fuchsia-500", mode: "inModal" },
  BROWSER: { Icon: Globe, label: "Browser session", iconClass: "text-sky-500", mode: "external" },
  IDE: { Icon: Code, label: "IDE session", iconClass: "text-sky-500", mode: "external" },
  MEDIA: { Icon: ImageIcon, label: "Media", iconClass: "text-pink-500", mode: "external" },
  WORKFLOW: { Icon: Workflow, label: "Workflow", iconClass: "text-indigo-500", mode: "external" },
  GRAPH: { Icon: Layers, label: "Graph", iconClass: "text-teal-500", mode: "external" },
  BUG_REPORT: { Icon: Bug, label: "Bug report", iconClass: "text-red-500", mode: "external" },
  STREAM: { Icon: Workflow, label: "Stream", iconClass: "text-indigo-500", mode: "external" },
  TASKS: { Icon: Layers, label: "Tasks", iconClass: "text-teal-500", mode: "external" },
  VERIFY: { Icon: FileText, label: "Verify", iconClass: "text-violet-500", mode: "external" },
  // PLAN is FORM-like for clarifying questions and rendered inline by
  // `TaskChatMessage`; for non-clarifying PLAN we pop the task page.
  PLAN: { Icon: FileText, label: "Plan", iconClass: "text-violet-500", mode: "external" },
};

export function TaskArtifactPill({
  artifact,
  taskHref,
  workflowUrl,
}: TaskArtifactPillProps) {
  const [open, setOpen] = useState(false);

  const meta = KIND_META[artifact.type as string];
  if (!meta) {
    // Unknown artifact type — render nothing rather than crash. New
    // types added to the schema will surface here once registered.
    return null;
  }
  const Icon = meta.Icon;

  const handleClick = () => {
    if (meta.mode === "inModal") {
      setOpen(true);
    } else {
      window.open(taskHref, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        title={
          meta.mode === "inModal"
            ? `View ${meta.label.toLowerCase()}`
            : `Open task to view ${meta.label.toLowerCase()}`
        }
        className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-0.5 text-[11px] font-medium text-foreground/80 hover:bg-muted/60 transition-colors"
      >
        <Icon className={`h-3 w-3 ${meta.iconClass}`} />
        <span>{meta.label}</span>
        {meta.mode === "external" && (
          <ExternalLink className="h-2.5 w-2.5 text-muted-foreground/60" />
        )}
      </button>

      {meta.mode === "inModal" && (
        <Dialog open={open} onOpenChange={setOpen}>
          {/*
           * 90vw / 90vh wrapper because most artifact panels (CODE,
           * DIFF, LONGFORM) render long content; using the default
           * `max-w-lg` would clip the body. `p-0` plus an inner
           * scroll container so the dialog header stays fixed while
           * the body scrolls inside.
           */}
          <DialogContent className="max-w-[90vw] sm:max-w-[1000px] max-h-[90vh] p-0 overflow-hidden flex flex-col">
            <DialogHeader className="px-5 pt-5 pb-3 border-b">
              <DialogTitle className="flex items-center gap-2 text-sm">
                <Icon className={`h-4 w-4 ${meta.iconClass}`} />
                {meta.label}
              </DialogTitle>
            </DialogHeader>
            <div className="flex-1 overflow-y-auto p-5">
              {renderModalBody(artifact, workflowUrl)}
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/**
 * Modal body dispatcher. Returns the matching artifact panel for
 * `inModal` types. Each panel below is the same component the full
 * task page mounts in its right-side artifact pane — they're
 * render-only (or self-fetching) and don't require the surrounding
 * task layout, so they slot cleanly into the modal.
 *
 * NOTE: panels that DO need surrounding context (BROWSER's
 * staktrak/playwright + pod url, WORKFLOW's selectedStep / version
 * picker, GRAPH's workspace slug from `useWorkspace`) are NOT
 * dispatched here — those types are `mode: "external"` in
 * `KIND_META` and never reach this function.
 */
function renderModalBody(artifact: Artifact, workflowUrl?: string | null) {
  switch (artifact.type) {
    case "CODE":
      return <CodeArtifactPanel artifacts={[artifact]} />;
    case "DIFF":
      return <DiffArtifactPanel artifacts={[artifact]} />;
    case "LONGFORM":
      return (
        <LongformArtifactPanel
          artifacts={[artifact]}
          workflowUrl={workflowUrl ?? undefined}
        />
      );
    case "BOUNTY":
      return <BountyArtifact artifact={artifact} />;
    case "PUBLISH_WORKFLOW":
      return <PublishWorkflowArtifact artifact={artifact} />;
    default:
      return (
        <div className="text-sm text-muted-foreground italic">
          No preview available for this artifact type.
        </div>
      );
  }
}
