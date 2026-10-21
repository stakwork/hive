import type { ComponentType } from "react";
import {
  AppWindow,
  AudioLines,
  BookOpenText,
  Braces,
  Clapperboard,
  ShieldQuestion,
  Code,
  FileCode2,
  FileDiff,
  FileText,
  Film,
  GitPullRequest,
  Globe,
  Image as ImageIcon,
  ListChecks,
  Network,
  ScrollText,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { toJsonText } from "@/components/streaming/toolCallValue";
import {
  claimNeedsLook,
  parseArtifactContent,
  type ArtifactContents,
  type ArtifactKind,
  type ArtifactRef,
  type ArtifactViewerProps,
} from "../../_state/canvasChatArtifacts";
import { buildSharePath } from "../HtmlPageCard";
import { webAddress } from "./address";
import { AppPanel } from "./viewers/app";
import { CaptchaPanel } from "./viewers/captcha";
import { ClaimsPanel, ClaimsRowMeta } from "./viewers/claims";
import { CodePanel } from "./viewers/code";
import { DiffPanel, diffPatchText } from "./viewers/diff";
import { brainstormBoardHref, GraphPanel, GraphThumb } from "./viewers/graph";
import { HtmlPanel } from "./viewers/html";
import { JsonPanel } from "./viewers/json";
import { LogPanel } from "./viewers/log";
import { MarkdownPanel, MarkdownPreview } from "./viewers/markdown";
import { AudioPanel, ImagePanel, ImageThumb, VideoPanel, VideoThumb } from "./viewers/media";
import { PdfPanel } from "./viewers/pdf";
import { PullRequestPanel, PullRequestRowMeta } from "./viewers/pullRequest";
import { RunGraphPanel, RunGraphThumb } from "./viewers/runGraph";
import { UrlPanel, UrlRowMeta } from "./viewers/url";
import { WalkthroughPanel, WalkthroughThumb } from "./viewers/walkthrough";

/**
 * Where an artifact shows in the chat, under the message that reported it:
 *
 * - `row` — something to act on or open (a pull request, claims, a pod or a
 *   page): one compact row, its state on the right.
 * - `media` — something to look at (a screenshot, a recording, a graph): a
 *   thumbnail in the message's strip.
 * - `preview` — something to read (a plan, a document): its first lines
 *   under its title.
 *
 * A kind with none folds into the message's "N more" line — reference
 * material the panel holds (logs, JSON, code, diffs).
 */
export type ChatPlacement<K extends ArtifactKind> =
  | {
      place: "row";
      /** The row's state, on its right; without one, the artifact's label. */
      Meta?: ComponentType<ArtifactViewerProps<K>>;
    }
  | { place: "media"; Thumb: ComponentType<ArtifactViewerProps<K>> }
  | { place: "preview"; Lines: ComponentType<ArtifactViewerProps<K>> };

/**
 * How Hive shows each kind of artifact: where it sits in the chat and its
 * full view on the artifact panel. The one place a kind is switched on —
 * the chat and the panel look their artifact up here and know nothing
 * about kinds themselves.
 */
export interface ArtifactKindSpec<K extends ArtifactKind> {
  /** The kind's own name, shown when an artifact carries no `label`. */
  label: string;
  Icon: LucideIcon;
  /** Where it shows in the chat, and what draws it there; absent, it folds. */
  chat?: ChatPlacement<K>;
  /** The full view on the artifact panel. */
  Panel: ComponentType<ArtifactViewerProps<K>>;
  /** The content as text, for the panel's copy button. */
  copyText?: (content: ArtifactContents[K]) => string;
  /** Where the artifact itself lives, as its content gives it; null when this one has nowhere of its own. A link gets it only through `artifactHref`. */
  address?: (content: ArtifactContents[K], githubLogin: string) => string | null;
  /**
   * The artifact waits on the reader — a PR to review, a claim to look at — so it tops the artifact panel's index.
   * Decided from inline content only (`artifactAsks`): a kind read from elsewhere never does.
   */
  asks?: (content: ArtifactContents[K]) => boolean;
}

export const ARTIFACT_KINDS: { [K in ArtifactKind]: ArtifactKindSpec<K> } = {
  markdown: {
    label: "Document",
    Icon: FileText,
    chat: { place: "preview", Lines: MarkdownPreview },
    Panel: MarkdownPanel,
    copyText: (content) => content.text,
  },
  html: {
    label: "Page",
    Icon: FileCode2,
    chat: { place: "row" },
    Panel: HtmlPanel,
    // A page a strut job wrote has no page of its own on Hive: the reader serves it, and serves it static.
    address: (content, githubLogin) => ("slug" in content ? buildSharePath(githubLogin, encodeURIComponent(content.slug)) : null),
  },
  // A job's app: live software in the app frame, beside a page (`html`), never instead of it.
  app: {
    label: "App",
    Icon: AppWindow,
    chat: { place: "row" },
    Panel: AppPanel,
  },
  image: {
    label: "Image",
    Icon: ImageIcon,
    chat: { place: "media", Thumb: ImageThumb },
    Panel: ImagePanel,
  },
  video: {
    label: "Video",
    Icon: Film,
    chat: { place: "media", Thumb: VideoThumb },
    Panel: VideoPanel,
  },
  audio: {
    label: "Audio",
    Icon: AudioLines,
    Panel: AudioPanel,
  },
  pdf: {
    label: "PDF",
    Icon: BookOpenText,
    Panel: PdfPanel,
    address: (content) => content.url,
  },
  url: {
    label: "Browser",
    Icon: Globe,
    chat: { place: "row", Meta: UrlRowMeta },
    Panel: UrlPanel,
    address: (content) => content.url,
  },
  diff: {
    label: "Diff",
    Icon: FileDiff,
    Panel: DiffPanel,
    copyText: (content) => diffPatchText(content.diffs),
  },
  pull_request: {
    label: "Pull request",
    Icon: GitPullRequest,
    chat: { place: "row", Meta: PullRequestRowMeta },
    Panel: PullRequestPanel,
    address: (content) => content.url,
    asks: (content) => content.state === "open" || content.state === "draft",
  },
  code: {
    label: "Code",
    Icon: Code,
    Panel: CodePanel,
    copyText: (content) => content.code,
  },
  log: {
    label: "Logs",
    Icon: ScrollText,
    Panel: LogPanel,
    copyText: (content) => content.text,
  },
  json: {
    label: "JSON",
    Icon: Braces,
    Panel: JsonPanel,
    copyText: (content) => toJsonText(content.value),
  },
  graph: {
    label: "Graph",
    Icon: Network,
    chat: { place: "media", Thumb: GraphThumb },
    Panel: GraphPanel,
    // The org page's graph view, on the same workspace and node.
    address: (content, githubLogin) => {
      // A brainstorm tree opens on the desk.
      if (content.layout === "tree" && content.focus)
        return brainstormBoardHref(githubLogin, content.workspace, content.focus);
      const params = new URLSearchParams({ view: "graph", workspace: content.workspace });
      if (content.focus) params.set("gnode", content.focus);
      return `/org/${githubLogin}?${params.toString()}`;
    },
  },
  run_graph: {
    label: "Graph trace",
    Icon: Waypoints,
    chat: { place: "media", Thumb: RunGraphThumb },
    Panel: RunGraphPanel,
  },
  // The row is the summary alone ("1 needs a look"); the claims themselves are on the panel.
  claims: {
    label: "Claims",
    Icon: ListChecks,
    chat: { place: "row", Meta: ClaimsRowMeta },
    Panel: ClaimsPanel,
    asks: (content) => content.claims.some(claimNeedsLook),
  },
  // A strut job's recording of a flow: its newest frame in the chat, scrubbed on the panel.
  walkthrough: {
    label: "Walkthrough",
    Icon: Clapperboard,
    chat: { place: "media", Thumb: WalkthroughThumb },
    Panel: WalkthroughPanel,
  },
  // A captcha a strut job cannot solve: tapped or typed on the panel, the answer is the job's next turn.
  captcha: {
    label: "Captcha",
    Icon: ShieldQuestion,
    chat: { place: "row" },
    Panel: CaptchaPanel,
    asks: (content) => (content.state === undefined || content.state === "waiting") && !(content.expiresAt && Date.parse(content.expiresAt) <= Date.now()),
  },
};

/**
 * The entry for a kind that is only known at run time. The registry is
 * keyed by kind, so it is always the one for that kind's content.
 */
export function artifactKind(kind: ArtifactKind): ArtifactKindSpec<ArtifactKind> {
  return ARTIFACT_KINDS[kind] as unknown as ArtifactKindSpec<ArtifactKind>;
}

/**
 * Whether an artifact waits on the reader (`asks`). Read off inline content
 * only — what is read from elsewhere is not known until it loads, and folds.
 */
export function artifactAsks(artifact: ArtifactRef): boolean {
  const known = asksByRef.get(artifact);
  if (known !== undefined) return known;
  const { asks } = artifactKind(artifact.kind);
  let result = false;
  if (asks && artifact.source.type === "inline") {
    const content = parseArtifactContent(artifact.kind, artifact.source.content);
    result = !!content && asks(content);
  }
  asksByRef.set(artifact, result);
  return result;
}

/** Refs are immutable once parsed, and the chat asks about each on every streamed chunk: parse once. */
const asksByRef = new WeakMap<ArtifactRef, boolean>();

/**
 * Where an artifact opens in a tab of its own, or null when it has no
 * address or the address is not a web page. An agent wrote the address, so
 * this is the one way it becomes a link.
 */
export function artifactHref(
  kind: ArtifactKind,
  content: ArtifactContents[ArtifactKind],
  githubLogin: string,
): string | null {
  const address = artifactKind(kind).address?.(content, githubLogin);
  return address ? webAddress(address) : null;
}
