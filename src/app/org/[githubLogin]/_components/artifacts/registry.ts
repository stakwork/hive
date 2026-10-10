import type { ComponentType } from "react";
import {
  AudioLines,
  BookOpenText,
  Braces,
  Code,
  FileCode2,
  FileDiff,
  FileText,
  Film,
  GitPullRequest,
  Globe,
  Image as ImageIcon,
  Network,
  ScrollText,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { toJsonText } from "@/components/streaming/toolCallValue";
import type { ArtifactContents, ArtifactKind, ArtifactViewerProps } from "../../_state/canvasChatArtifacts";
import { buildSharePath } from "../HtmlPageCard";
import { addressParts, webAddress } from "./address";
import { lineCount, plural } from "./lines";
import { CodeInline, CodePanel, codeLanguage } from "./viewers/code";
import { DiffInline, DiffPanel, diffPatchText } from "./viewers/diff";
import { GraphInline, GraphPanel } from "./viewers/graph";
import { HtmlInline, HtmlPanel } from "./viewers/html";
import { JsonInline, JsonPanel, jsonSummary } from "./viewers/json";
import { LogInline, LogPanel } from "./viewers/log";
import { MarkdownInline, MarkdownPanel } from "./viewers/markdown";
import { AudioInline, AudioPanel, ImageInline, ImagePanel, VideoInline, VideoPanel } from "./viewers/media";
import { PdfPanel } from "./viewers/pdf";
import { PullRequestInline, PullRequestPanel } from "./viewers/pullRequest";
import { RunGraphInline, RunGraphPanel, runGraphFact } from "./viewers/runGraph";
import { UrlInline, UrlPanel } from "./viewers/url";
import { orgGraphHref } from "../graphHref";

/**
 * How Hive shows each kind of artifact: its preview on the chat card and
 * its full view on the artifact panel. The one place a kind is switched
 * on — the card and the panel look their artifact up here and know
 * nothing about kinds themselves.
 */
export interface ArtifactKindSpec<K extends ArtifactKind> {
  /** The kind's own name, shown when an artifact carries no `label`. */
  label: string;
  Icon: LucideIcon;
  /** The preview on the chat card. A kind without one gets a card that is its name alone. */
  Inline?: ComponentType<ArtifactViewerProps<K>>;
  /** The full view on the artifact panel. */
  Panel: ComponentType<ArtifactViewerProps<K>>;
  /** The card's preview is something to operate (a player), so a click on it does not open the panel. */
  inlineInteractive?: boolean;
  /** A short fact for the card's caption: "3 files", "stakwork/hive #5372". */
  fact?: (content: ArtifactContents[K]) => string | null;
  /** The content as text, for the panel's copy button. */
  copyText?: (content: ArtifactContents[K]) => string;
  /** Where the artifact itself lives, as its content gives it; null when this one has nowhere of its own. A link gets it only through `artifactHref`. */
  address?: (content: ArtifactContents[K], githubLogin: string) => string | null;
}

export const ARTIFACT_KINDS: { [K in ArtifactKind]: ArtifactKindSpec<K> } = {
  markdown: {
    label: "Document",
    Icon: FileText,
    Inline: MarkdownInline,
    Panel: MarkdownPanel,
    copyText: (content) => content.text,
  },
  html: {
    label: "Page",
    Icon: FileCode2,
    Inline: HtmlInline,
    Panel: HtmlPanel,
    // A page a strut job wrote has no page of its own on Hive: the reader serves it, and serves it static.
    address: (content, githubLogin) => ("slug" in content ? buildSharePath(githubLogin, encodeURIComponent(content.slug)) : null),
  },
  image: {
    label: "Image",
    Icon: ImageIcon,
    Inline: ImageInline,
    Panel: ImagePanel,
  },
  video: {
    label: "Video",
    Icon: Film,
    Inline: VideoInline,
    Panel: VideoPanel,
    inlineInteractive: true,
  },
  audio: {
    label: "Audio",
    Icon: AudioLines,
    Inline: AudioInline,
    Panel: AudioPanel,
    inlineInteractive: true,
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
    Inline: UrlInline,
    Panel: UrlPanel,
    fact: (content) => addressParts(content.url).host,
    address: (content) => content.url,
  },
  diff: {
    label: "Diff",
    Icon: FileDiff,
    Inline: DiffInline,
    Panel: DiffPanel,
    fact: (content) => plural(content.diffs.length, "file"),
    copyText: (content) => diffPatchText(content.diffs),
  },
  pull_request: {
    label: "Pull request",
    Icon: GitPullRequest,
    Inline: PullRequestInline,
    Panel: PullRequestPanel,
    fact: (content) => `${content.repo} #${content.number}`,
    address: (content) => content.url,
  },
  code: {
    label: "Code",
    Icon: Code,
    Inline: CodeInline,
    Panel: CodePanel,
    fact: (content) => content.filename ?? codeLanguage(content),
    copyText: (content) => content.code,
  },
  log: {
    label: "Logs",
    Icon: ScrollText,
    Inline: LogInline,
    Panel: LogPanel,
    fact: (content) => plural(lineCount(content.text), "line"),
    copyText: (content) => content.text,
  },
  json: {
    label: "JSON",
    Icon: Braces,
    Inline: JsonInline,
    Panel: JsonPanel,
    fact: (content) => jsonSummary(content.value),
    copyText: (content) => toJsonText(content.value),
  },
  graph: {
    label: "Graph",
    Icon: Network,
    Inline: GraphInline,
    Panel: GraphPanel,
    fact: (content) => content.workspace,
    // The org page's graph view, on the same workspace and node.
    address: (content, githubLogin) =>
      orgGraphHref(githubLogin, { workspace: content.workspace, refId: content.focus }),
  },
  run_graph: {
    label: "Graph trace",
    Icon: Waypoints,
    Inline: RunGraphInline,
    Panel: RunGraphPanel,
    fact: runGraphFact,
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
