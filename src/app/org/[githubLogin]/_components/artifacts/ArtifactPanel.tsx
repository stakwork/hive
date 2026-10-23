"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Download, RefreshCw, X } from "lucide-react";
import { CopyButton } from "@/components/ui/copy-button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useCanvasChatStore } from "../../_state/canvasChatStore";
import {
  artifactIdentity,
  latestArtifacts,
  resolveArtifactPanel,
  type ArtifactKind,
  type ArtifactRef,
  type ArtifactViewerProps,
  type ResolvedArtifactPanel,
} from "../../_state/canvasChatArtifacts";
import { ActionTip } from "../ActionTip";
import { isTypingTarget } from "../control-panel/ControlPanelList";
import { ICON_BUTTON_CLASS, MissingContentPanel, ToolbarButton, ViewerBoundary } from "./chrome";
import { artifactAsks, artifactHref, artifactKind } from "./registry";
import { useArtifactContent } from "./useArtifactContent";
import { useOpenArtifact } from "./openArtifact";
import { useActiveArtifacts, useArtifactJobId, useArtifactJobs, useChatOrgLogin } from "./useArtifactPanel";

/**
 * The artifact panel: the artifact opened from the chat, at full size, or
 * the index of every artifact in the chat. The org page gives it its own
 * pane beside the chat it came from (`OrgCanvasView`). One bar — the
 * artifact's name, which doubles as the way to any other artifact in the
 * chat, its versions, and what can be done with it — over the kind's own
 * viewer; ← goes back to the index. Escape closes it.
 */
export function ArtifactPanel() {
  const artifacts = useActiveArtifacts();
  const panel = useCanvasChatStore((s) => s.artifactPanel);

  const resolved = useMemo(() => resolveArtifactPanel(artifacts, panel), [artifacts, panel]);
  // The panel eases out after it is closed; what it showed stays up until it has gone.
  const lastResolved = useRef(resolved);
  if (resolved) lastResolved.current = resolved;
  const shown = resolved ?? lastResolved.current;
  const others = useMemo(() => latestArtifacts(artifacts), [artifacts]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // A menu or dialog that was open has already taken the key for itself.
      if (e.key !== "Escape" || e.defaultPrevented || isTypingTarget(e.target)) return;
      useCanvasChatStore.getState().closeArtifactPanel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  if (panel && panel.identity === null) return <ArtifactIndex artifacts={others} />;
  return shown ? <OpenArtifact shown={shown} others={others} /> : null;
}

interface IndexGroup {
  key: string;
  label: string;
  artifacts: ArtifactRef[];
}

/**
 * The index's sections: what waits on the reader first, then one section
 * per job (its artifacts together, under the job's title) and one for what
 * Jamie made itself — each newest first, ordered by its newest artifact.
 */
export function groupIndex(
  newestFirst: ArtifactRef[],
  jobs: ReadonlyMap<string, { jobId: string; title: string }>,
): IndexGroup[] {
  const waiting: IndexGroup = { key: "waiting", label: "Waiting on you", artifacts: [] };
  const groups = new Map<string, IndexGroup>();
  for (const artifact of newestFirst) {
    if (artifactAsks(artifact)) {
      waiting.artifacts.push(artifact);
      continue;
    }
    const job = jobs.get(artifactIdentity(artifact));
    const key = job ? `job:${job.jobId}` : "jamie";
    const group = groups.get(key) ?? { key, label: job ? job.title : "From Jamie", artifacts: [] };
    group.artifacts.push(artifact);
    groups.set(key, group);
  }
  return [waiting, ...groups.values()].filter((group) => group.artifacts.length > 0);
}

/** Every artifact in the chat, grouped: what waits on you, then by job, then what Jamie made. */
function ArtifactIndex({ artifacts }: { artifacts: ArtifactRef[] }) {
  const { closeArtifactPanel } = useCanvasChatStore.getState();
  const jobs = useArtifactJobs();
  const groups = useMemo(() => groupIndex([...artifacts].reverse(), jobs), [artifacts, jobs]);
  return (
    <section aria-label="Artifacts" className="flex h-full w-full flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b pl-3 pr-2">
        <h2 className="text-sm font-medium">Artifacts</h2>
        <span className="text-xs tabular-nums text-muted-foreground">{artifacts.length}</span>
        <div className="ml-auto">
          <ToolbarButton label="Close" onClick={closeArtifactPanel}>
            <X className="h-4 w-4" />
          </ToolbarButton>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {groups.map((group) => (
          <section key={group.key} aria-label={group.label} className="pt-3">
            <h3
              className={cn(
                "flex items-center gap-1.5 px-2 pb-1 text-xs",
                group.key === "waiting" ? "text-amber-600 dark-os:text-amber-400" : "text-muted-foreground",
              )}
            >
              <span className="truncate">{group.label}</span>
              <span className="tabular-nums opacity-70">{group.artifacts.length}</span>
            </h3>
            <ul>
              {group.artifacts.map((artifact) => (
                <IndexRow key={artifactIdentity(artifact)} artifact={artifact} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}

/**
 * The kind's full view. Memoised: the bar above it re-renders as
 * artifacts land in the chat, and a viewer is not cheap to redraw.
 */
const Viewer = React.memo(function Viewer({ artifact, content, jobId }: ArtifactViewerProps<ArtifactKind>) {
  const { Panel } = artifactKind(artifact.kind);
  return <Panel artifact={artifact} content={content} jobId={jobId} />;
});

function OpenArtifact({ shown, others }: { shown: ResolvedArtifactPanel; others: ArtifactRef[] }) {
  const { artifact, versions, index } = shown;
  const identity = artifactIdentity(artifact);
  const spec = artifactKind(artifact.kind);
  const githubLogin = useChatOrgLogin();
  const jobId = useArtifactJobId(artifact);
  const state = useArtifactContent(artifact);
  const content = state.status === "ready" ? state.content : null;
  const href = content && artifactHref(artifact.kind, content, githubLogin);
  const copyText = useMemo(() => content && spec.copyText?.(content), [spec, content]);
  const { Actions } = spec;
  const download = content ? downloadOf(artifact, content, copyText) : null;
  // Bumped by Refresh: remounts the viewer, so an app's frame fetches its document afresh.
  const [reloads, setReloads] = useState(0);
  const { openArtifactPanel, closeArtifactPanel } = useCanvasChatStore.getState();
  // The newest version is followed rather than pinned, so a later revision shows as it lands.
  const showVersion = (next: number) => openArtifactPanel(identity, next === versions.length - 1 ? null : next);

  return (
    <section aria-label={artifact.title} className="flex h-full w-full flex-col bg-background">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b pl-1.5 pr-2">
        {others.length > 1 && (
          <ToolbarButton label="All artifacts" onClick={useCanvasChatStore.getState().openArtifactIndex}>
            <ArrowLeft className="h-4 w-4" />
          </ToolbarButton>
        )}
        <spec.Icon aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground" />
        {others.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="-ml-1 flex min-w-0 items-center gap-1 rounded px-1.5 py-1 text-sm font-medium transition-colors hover:bg-muted"
              >
                <span className="truncate">{artifact.title}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-80">
              {others.map((other) => {
                const otherSpec = artifactKind(other.kind);
                const otherIdentity = artifactIdentity(other);
                return (
                  <DropdownMenuItem
                    key={otherIdentity}
                    onSelect={() => openArtifactPanel(otherIdentity)}
                    className={cn(otherIdentity === identity && "bg-muted font-medium")}
                  >
                    <otherSpec.Icon aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{other.title}</span>
                    <span className="shrink-0 text-xs font-normal text-muted-foreground">
                      {other.label ?? otherSpec.label}
                    </span>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <h2 className="min-w-0 truncate text-sm font-medium">{artifact.title}</h2>
        )}
        <span className="shrink-0 text-xs text-muted-foreground">{artifact.label ?? spec.label}</span>

        {versions.length > 1 && (
          <div className="flex shrink-0 items-center text-xs text-muted-foreground">
            <ToolbarButton
              label="Earlier version"
              onClick={() => showVersion(index - 1)}
              disabled={index === 0}
              className="p-1"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </ToolbarButton>
            <span className="tabular-nums">
              v{index + 1} of {versions.length}
            </span>
            <ToolbarButton
              label="Later version"
              onClick={() => showVersion(index + 1)}
              disabled={index === versions.length - 1}
              className="p-1"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </ToolbarButton>
          </div>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-1">
          {content && Actions && <Actions artifact={artifact} content={content} jobId={jobId} />}
          {artifact.kind === "app" && (
            <ToolbarButton label="Refresh" onClick={() => setReloads((n) => n + 1)}>
              <RefreshCw className="h-4 w-4" />
            </ToolbarButton>
          )}
          {typeof copyText === "string" && (
            <CopyButton value={copyText} className="rounded p-1.5 hover:bg-muted [&_svg]:h-4 [&_svg]:w-4" />
          )}
          {download && (
            <ToolbarButton label="Download" onClick={() => saveFile(download)}>
              <Download className="h-4 w-4" />
            </ToolbarButton>
          )}
          {href && (
            <ActionTip label="Open in new tab">
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open in new tab"
                className={ICON_BUTTON_CLASS}
              >
                <ArrowUpRight className="h-4 w-4" />
              </a>
            </ActionTip>
          )}
          <ToolbarButton label="Close" onClick={closeArtifactPanel}>
            <X className="h-4 w-4" />
          </ToolbarButton>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {state.status === "ready" ? (
          // Keyed so a viewer's own state — zoom, a filter, where it has browsed to — starts over with each artifact.
          <ViewerBoundary key={`${identity}:${index}:${reloads}`}>
            <Viewer artifact={artifact} content={state.content} jobId={jobId} />
          </ViewerBoundary>
        ) : (
          <MissingContentPanel state={state} />
        )}
      </div>
    </section>
  );
}

interface FileDownload {
  filename: string;
  /** An address to fetch the bytes from, or the text to save as they are. */
  url?: string;
  text?: string;
}

const TEXT_EXTENSIONS: Partial<Record<ArtifactKind, string>> = { markdown: "md", log: "log", json: "json", diff: "patch" };

/** What can be saved from an artifact: a file at an address, or text that is held inline. Null for the rest (a PR, a link, a graph). */
function downloadOf(artifact: ArtifactRef, content: object, copyText: unknown): FileDownload | null {
  const keyName = artifact.source.type === "graph" ? artifact.source.key.split("/").pop() : undefined;
  const url = "url" in content && typeof content.url === "string" ? content.url : undefined;
  if (["image", "video", "audio", "pdf"].includes(artifact.kind) && url)
    return { url, filename: keyName || url.split("?")[0].split("/").pop() || artifact.title };
  if (typeof copyText === "string") {
    const ext = TEXT_EXTENSIONS[artifact.kind];
    const title = artifact.title.replace(/[\\/:*?"<>|]+/g, "-").trim() || "artifact";
    return { text: copyText, filename: keyName || (ext && !title.includes(".") ? `${title}.${ext}` : title) };
  }
  return null;
}

/** Saves through a same-origin anchor, so `download` is honored; text goes via a blob URL that is revoked after. */
function saveFile({ filename, url, text }: FileDownload) {
  const blobUrl = text !== undefined ? URL.createObjectURL(new Blob([text], { type: "text/plain" })) : null;
  const a = document.createElement("a");
  a.href = blobUrl ?? url ?? "";
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  if (blobUrl) setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
}

/** One line of the index. A brainstorm tree opens on the canvas at its card, anything else on the panel. */
function IndexRow({ artifact }: { artifact: ArtifactRef }) {
  const spec = artifactKind(artifact.kind);
  const open = useOpenArtifact(useChatOrgLogin());
  const state = useArtifactContent(artifact, artifact.kind === "graph" || artifact.kind === "json");
  const content = state.status === "ready" ? state.content : null;
  return (
    <li>
      <button
        type="button"
        onClick={() => open(artifact, content)}
        className="flex w-full items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted/60"
      >
        <spec.Icon aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{artifact.title}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {artifact.label ?? spec.label}
            {artifact.summary && ` · ${artifact.summary}`}
          </span>
        </span>
      </button>
    </li>
  );
}
