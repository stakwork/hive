"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Loader2 } from "lucide-react";
import type { CanvasNode } from "system-canvas";
import { Badge } from "@/components/ui/badge";
import ReactMarkdown from "react-markdown";
import type { WorkflowStatus } from "@/lib/chat";
import { FeaturePlanChat } from "./FeaturePlanChat";

/**
 * Right-panel detail card for the currently-selected canvas node.
 *
 * Splits node kinds into two camps:
 *   - **Live nodes** (id prefix `ws:`/`repo:`/`initiative:`/...) — fetch
 *     the entity from `/api/orgs/.../canvas/node/[liveId]` so we can
 *     show its `description` and other fields the projector doesn't
 *     embed in the canvas payload.
 *   - **Authored nodes** (`note`, `decision`) — body lives on the node
 *     itself (`node.text`); no fetch needed.
 *
 * The endpoint serves as the single org-scoped guard: if the live id
 * doesn't belong to this org, we get a 404 and render an error state
 * rather than leaking cross-org content.
 */

const LIVE_PREFIX_RE = /^([a-z]+):.+$/;

interface NodeDetail {
  kind: string;
  id: string;
  name: string;
  description: string | null;
  extras?: Record<string, unknown> | null;
}

interface NodeDetailProps {
  node: CanvasNode;
  githubLogin: string;
}

/**
 * Body content for the right-panel Details tab. Header (category +
 * node name) + body (live entity fetch or authored markdown).
 *
 * No close button — the tab strip in `OrgRightPanel` is the way out:
 * switching to the Connections tab leaves the node selected (the
 * canvas keeps showing it as selected) but routes the panel away.
 */
export function NodeDetail({ node, githubLogin }: NodeDetailProps) {
  const liveMatch = LIVE_PREFIX_RE.exec(node.id);
  const isLive = liveMatch !== null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-4 pt-4 pb-3 border-b">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          {(node.category ?? "node").toUpperCase()}
        </div>
        <div className="font-medium truncate mt-0.5">
          {node.text || (node.category === "note" ? "Note" : node.id)}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {isLive ? (
          <LiveNodeBody nodeId={node.id} githubLogin={githubLogin} />
        ) : (
          <AuthoredNodeBody node={node} />
        )}
      </div>
    </div>
  );
}

/** Renders body for `note` / `decision` and any other client-only node. */
function AuthoredNodeBody({ node }: { node: CanvasNode }) {
  const text = node.text?.trim();
  if (!text) {
    return (
      <p className="text-sm text-muted-foreground italic">
        Empty note. Click the node on the canvas to edit it.
      </p>
    );
  }
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  );
}

function LiveNodeBody({
  nodeId,
  githubLogin,
}: {
  nodeId: string;
  githubLogin: string;
}) {
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setDetail(null);
    fetch(
      `/api/orgs/${githubLogin}/canvas/node/${encodeURIComponent(nodeId)}`,
    )
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setError(res.status === 404 ? "Not found." : "Failed to load.");
          return;
        }
        const body = (await res.json()) as NodeDetail;
        if (!cancelled) setDetail(body);
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nodeId, githubLogin]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }
  if (error) {
    return <p className="text-sm text-muted-foreground">{error}</p>;
  }
  if (!detail) return null;

  return (
    <div className="space-y-4">
      {detail.description ? (
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown>{detail.description}</ReactMarkdown>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground italic">
          No description set.
        </p>
      )}

      <KindExtras detail={detail} githubLogin={githubLogin} />
    </div>
  );
}

interface ExtrasProps {
  detail: NodeDetail;
  githubLogin: string;
}

function KindExtras({ detail, githubLogin }: ExtrasProps) {
  const extras = (detail.extras ?? {}) as Record<string, unknown>;

  switch (detail.kind) {
    case "workspace": {
      const slug = String(extras.slug ?? "");
      const repoCount = Number(extras.repoCount ?? 0);
      const memberCount = Number(extras.memberCount ?? 0);
      return (
        <div className="space-y-3">
          <StatGrid
            stats={[
              { label: "Repos", value: String(repoCount) },
              { label: "Members", value: String(memberCount) },
            ]}
          />
          {slug && (
            <FooterLink href={`/w/${slug}`} label="Open workspace" />
          )}
        </div>
      );
    }
    case "repository": {
      const url = extras.repositoryUrl as string | null | undefined;
      const branch = extras.branch as string | null | undefined;
      const status = extras.status as string | null | undefined;
      return (
        <div className="space-y-3">
          {(branch || status) && (
            <StatGrid
              stats={[
                ...(branch ? [{ label: "Branch", value: branch }] : []),
                ...(status ? [{ label: "Sync", value: status }] : []),
              ]}
            />
          )}
          {url && <FooterLink href={url} label="View on GitHub" external />}
        </div>
      );
    }
    case "initiative": {
      const status = (extras.status ?? "") as string;
      const milestoneCount = Number(extras.milestoneCount ?? 0);
      const startDate = extras.startDate as string | null | undefined;
      const targetDate = extras.targetDate as string | null | undefined;
      const completedAt = extras.completedAt as string | null | undefined;
      const assignee = extras.assignee as
        | { name: string | null }
        | null
        | undefined;
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            {status && <StatusPill value={status} />}
            <span className="text-xs text-muted-foreground">
              {milestoneCount} milestone{milestoneCount === 1 ? "" : "s"}
            </span>
          </div>
          <StatGrid
            stats={[
              ...(assignee?.name
                ? [{ label: "Owner", value: assignee.name }]
                : []),
              ...(startDate
                ? [{ label: "Started", value: formatDate(startDate) }]
                : []),
              ...(targetDate
                ? [{ label: "Target", value: formatDate(targetDate) }]
                : []),
              ...(completedAt
                ? [{ label: "Completed", value: formatDate(completedAt) }]
                : []),
            ]}
          />
          <FooterLink
            href={`/org/${githubLogin}/initiatives`}
            label="Open in Initiatives"
          />
        </div>
      );
    }
    case "milestone": {
      const status = (extras.status ?? "") as string;
      const dueDate = extras.dueDate as string | null | undefined;
      const completedAt = extras.completedAt as string | null | undefined;
      const featureCount = Number(extras.featureCount ?? 0);
      const assignee = extras.assignee as
        | { name: string | null }
        | null
        | undefined;
      const initiative = extras.initiative as
        | { name: string | null }
        | null
        | undefined;
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            {status && <StatusPill value={status} />}
            <span className="text-xs text-muted-foreground">
              {featureCount} feature{featureCount === 1 ? "" : "s"}
            </span>
          </div>
          <StatGrid
            stats={[
              ...(initiative?.name
                ? [{ label: "Initiative", value: initiative.name }]
                : []),
              ...(assignee?.name
                ? [{ label: "Owner", value: assignee.name }]
                : []),
              ...(dueDate ? [{ label: "Due", value: formatDate(dueDate) }] : []),
              ...(completedAt
                ? [{ label: "Completed", value: formatDate(completedAt) }]
                : []),
            ]}
          />
          <FooterLink
            href={`/org/${githubLogin}/initiatives`}
            label="Open in Initiatives"
          />
        </div>
      );
    }
    case "feature": {
      const status = (extras.status ?? "") as string;
      const taskCount = Number(extras.taskCount ?? 0);
      const slug = extras.workspaceSlug as string | undefined;
      const workflowStatus = (extras.workflowStatus ?? null) as
        | WorkflowStatus
        | null;
      const assignee = extras.assignee as
        | { name: string | null }
        | null
        | undefined;
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            {status && <StatusPill value={status} />}
            <span className="text-xs text-muted-foreground">
              {taskCount} task{taskCount === 1 ? "" : "s"}
            </span>
          </div>
          {assignee?.name && (
            <StatGrid stats={[{ label: "Owner", value: assignee.name }]} />
          )}
          {slug && (
            <FooterLink
              href={`/w/${slug}/plan/${detail.id}`}
              label="Open feature"
            />
          )}
          {/*
           * Inline plan chat — reads/writes the same feature-chat API
           * the full plan page uses, subscribes to the same Pusher
           * channel, and renders clarifying-question artifacts inline
           * so the planning workflow doesn't silently stall on the
           * canvas. The "Open feature" link above is the escape
           * hatch to the artifacts panel (PLAN/TASKS/VERIFY).
           */}
          {slug && (
            <FeaturePlanChat
              featureId={detail.id}
              workspaceSlug={slug}
              initialWorkflowStatus={workflowStatus}
            />
          )}
        </div>
      );
    }
    case "task": {
      const status = (extras.status ?? "") as string;
      const workflowStatus = (extras.workflowStatus ?? "") as string;
      const slug = extras.workspaceSlug as string | undefined;
      const assignee = extras.assignee as
        | { name: string | null }
        | null
        | undefined;
      return (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            {status && <StatusPill value={status} />}
            {workflowStatus && <StatusPill value={workflowStatus} variant="muted" />}
          </div>
          {assignee?.name && (
            <StatGrid stats={[{ label: "Owner", value: assignee.name }]} />
          )}
          {slug && (
            <FooterLink href={`/w/${slug}/tasks/${detail.id}`} label="Open task" />
          )}
        </div>
      );
    }
    default:
      return null;
  }
}

function StatGrid({ stats }: { stats: { label: string; value: string }[] }) {
  if (stats.length === 0) return null;
  return (
    <dl className="grid grid-cols-2 gap-3 text-xs">
      {stats.map((s) => (
        <div key={s.label} className="space-y-0.5">
          <dt className="text-muted-foreground">{s.label}</dt>
          <dd className="font-medium truncate">{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function StatusPill({
  value,
  variant = "default",
}: {
  value: string;
  variant?: "default" | "muted";
}) {
  return (
    <Badge variant={variant === "muted" ? "outline" : "secondary"} className="text-[10px] uppercase">
      {value.replace(/_/g, " ").toLowerCase()}
    </Badge>
  );
}

function FooterLink({
  href,
  label,
  external,
}: {
  href: string;
  label: string;
  external?: boolean;
}) {
  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
      >
        {label}
        <ArrowUpRight className="h-3 w-3" />
      </a>
    );
  }
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
    >
      {label}
      <ArrowUpRight className="h-3 w-3" />
    </Link>
  );
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}
