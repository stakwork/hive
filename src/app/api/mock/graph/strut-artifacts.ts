/**
 * Mock mode (`USE_MOCKS`): strut jobs on the mock initiatives' cards with
 * their `run.end` artifact lists, exactly as strut sends them
 * (`StrutArtifact`, `services/strut-runs/job-turn.ts`). The canvas-jobs read
 * maps them through `mapStrutArtifacts`, the path real jobs take, so every
 * kind shows on the canvas and the artifact panel as production will show
 * it. Files (`/jobs/<job>/files/<name>`) are served by the artifact reader
 * from `strut-files/` for `MOCK_STRUT_SWARM_ID` only. `docs/strut-artifacts.md`
 * lists the shapes.
 */

import { readFile } from "fs/promises";
import { join } from "path";
import type { StrutArtifact } from "@/services/strut-runs/job-turn";

/** The swarm the mock jobs' files live on: the reader serves them only for this id, and only under mocks. */
export const MOCK_STRUT_SWARM_ID = "mock-strut-swarm";

export interface MockStrutJob {
  jobId: string;
  initiativeRefId: string;
  /** The card it's on. */
  refId: string;
  title: string;
  state: "running" | "done" | "failed";
  error?: string;
  /** Hours ago it last changed. */
  hoursAgo: number;
  artifacts: StrutArtifact[];
}

const file = (job: string, name: string) => `/jobs/${job}/files/${name}`;
const pr = (
  repo: string,
  number: number,
  state: "open" | "draft" | "merged",
  ci: "success" | "pending" | "failure",
  head: string,
) => ({
  url: `https://github.com/${repo}/pull/${number}`,
  repo,
  number,
  state,
  headBranch: head,
  baseBranch: "master",
  checks: [
    { name: "build", status: "success" },
    { name: "unit-tests", status: ci },
  ],
});

const ONB = "mock-initiative-onboarding";
const JANITOR = "mock-initiative-janitor";
const CAUSE = "mock-initiative-causation";

/** A graph thumbnail on the large initiative: the workspace's graph around one of its cards. */
const causeGraph = (n: number, focus: string): StrutArtifact => ({
  id: `cause-graph-${n}`,
  kind: "graph",
  title: `Causes around ${focus}`,
  content: JSON.stringify({ workspace: "mock-stakgraph", focus }),
});
/** Notes long enough that rendering them as markdown costs something. */
const causeNotes = (n: number): string =>
  Array.from(
    { length: 12 },
    (_, i) =>
      `## Finding ${n}.${i + 1}\n\nThe **effect** traced back to its cause in ${i + 2} hops; see \`cause-${i}\` and [the run](https://example.com/run/${i}).\n\n- evidence: ${i + 3} edges\n- confidence: ${(0.5 + i / 30).toFixed(2)}`,
  ).join("\n\n");

export const MOCK_STRUT_JOBS: MockStrutJob[] = [
  {
    jobId: "mock-job-gh-architecture",
    initiativeRefId: ONB,
    refId: "mock-f-gh",
    title: "Draft the architecture for GitHub sign-in",
    state: "done",
    hoursAgo: 30,
    artifacts: [
      {
        id: "gh-architecture",
        kind: "markdown",
        title: "GitHub App per org",
        label: "Architecture",
        summary: "One GitHub App installed per org; sign-in is OAuth through the app.",
        content:
          "## GitHub App per org\n\nSign-in is OAuth through the app. The installation token is stored encrypted and refreshed on use.\n\n```mermaid\ngraph LR; A[Sign in] --> B[GitHub consent]; B --> C[Install app]; C --> D[Pick org]\n```",
      },
      {
        id: "gh-scopes",
        kind: "json",
        title: "Scopes the app asks for",
        // JSON text, as a json artifact's content arrives.
        content: JSON.stringify({ metadata: "read", contents: "read", pull_requests: "write", checks: "read" }),
      },
    ],
  },
  {
    jobId: "mock-job-gh-implement",
    initiativeRefId: ONB,
    refId: "mock-f-gh",
    title: "Implement GitHub sign-in",
    state: "done",
    hoursAgo: 4,
    artifacts: [
      {
        id: "pr-hive-5601",
        kind: "pull_request",
        title: "GitHub App install flow",
        content: pr("stakwork/hive", 5601, "merged", "success", "gh-app-install"),
      },
      {
        id: "pr-hive-5604",
        kind: "pull_request",
        title: "Skip workspace creation for returning users",
        content: pr("stakwork/hive", 5604, "merged", "success", "returning-users"),
      },
      {
        id: "pr-stakgraph-412",
        kind: "pull_request",
        title: "Read installation tokens per org",
        content: pr("stakwork/stakgraph", 412, "merged", "success", "install-tokens"),
      },
      {
        id: "shot-step-2",
        kind: "image",
        title: "Repo step after sign-in",
        label: "Screenshot",
        url: file("mock-job-gh-implement", "onboarding-step-2.png"),
      },
      {
        id: "walkthrough-signup",
        kind: "walkthrough",
        title: "Sign-up, end to end",
        label: "Recording",
        url: file("mock-job-gh-implement", "walkthrough.json"),
      },
    ],
  },
  {
    jobId: "mock-job-repo-implement",
    initiativeRefId: ONB,
    refId: "mock-f-repo",
    title: "Implement Repo picker",
    state: "running",
    hoursAgo: 1,
    artifacts: [
      {
        id: "pr-hive-5622",
        kind: "pull_request",
        title: "List installation repos, newest first",
        content: pr("stakwork/hive", 5622, "open", "pending", "repo-list"),
      },
      {
        id: "pr-stakgraph-418",
        kind: "pull_request",
        title: "Repo search endpoint",
        content: pr("stakwork/stakgraph", 418, "draft", "pending", "repo-search"),
      },
      {
        id: "repo-picker-page",
        kind: "html",
        title: "Repo picker, as built",
        label: "Preview",
        url: file("mock-job-repo-implement", "repo-picker.html"),
      },
      {
        id: "repo-picker-code",
        kind: "code",
        title: "RepoPicker.tsx",
        content: {
          filename: "RepoPicker.tsx",
          language: "tsx",
          code: 'export function RepoPicker({ repos }: { repos: string[] }) {\n  const [q, setQ] = useState("");\n  return repos.filter((r) => r.includes(q)).map((r) => <Row key={r} name={r} />);\n}\n',
        },
      },
      {
        id: "repo-picker-diff",
        kind: "diff",
        title: "Sort repos newest first",
        content:
          "--- a/src/repos.ts\n+++ b/src/repos.ts\n@@ -1,3 +1,3 @@\n-export const sortRepos = (r) => r;\n+export const sortRepos = (r) => [...r].sort((a, b) => b.updatedAt - a.updatedAt);\n",
      },
    ],
  },
  {
    jobId: "mock-job-link-implement",
    initiativeRefId: ONB,
    refId: "mock-f-link",
    title: "Implement Invite by link",
    state: "done",
    hoursAgo: 6,
    artifacts: [
      {
        id: "pr-hive-5640",
        kind: "pull_request",
        title: "Invite links that expire",
        content: pr("stakwork/hive", 5640, "open", "failure", "invite-links"),
      },
    ],
  },
  {
    jobId: "mock-job-signup-features",
    initiativeRefId: ONB,
    refId: "mock-m-signup",
    title: "Propose features for Sign-up",
    state: "done",
    hoursAgo: 48,
    artifacts: [
      {
        id: "signup-features",
        kind: "markdown",
        title: "Features for Sign-up",
        content:
          "1. **GitHub sign-in**: one app per org.\n2. **Repo picker**: newest first, search as you type.\n3. **Workspace naming**: suggested from the org.",
      },
      {
        id: "signup-preview",
        kind: "url",
        title: "Preview deploy",
        url: "https://hive-git-signup-stakwork.vercel.app",
      },
    ],
  },
  {
    jobId: "mock-job-onboarding-stories",
    initiativeRefId: ONB,
    refId: ONB,
    title: "Write the user stories for Self-serve onboarding",
    state: "done",
    hoursAgo: 72,
    artifacts: [
      {
        id: "onboarding-stories",
        kind: "markdown",
        title: "User stories",
        summary: "Five journeys, from sign-in to the first janitor run.",
        content:
          "- As a new PM, I sign in with GitHub and land in a fresh workspace.\n- As a new PM, I pick which repos Hive watches.\n- As an admin, I see who signed up from my org.",
      },
      {
        id: "security-review",
        kind: "pdf",
        title: "Security review of the sign-up flow",
        url: file("mock-job-onboarding-stories", "security-review.pdf"),
      },
      {
        id: "stories-log",
        kind: "log",
        title: "Job log",
        content:
          "12:01:04 reading the brief\n12:01:09 drafted 5 journeys\n12:01:15 wrote 12 requirements (proposed)\n12:01:16 done",
      },
    ],
  },
  {
    jobId: "mock-job-mute-implement",
    initiativeRefId: JANITOR,
    refId: "mock-f-mute",
    title: "Implement Mute a finding",
    state: "failed",
    error: "The pod ran out of disk while installing dependencies",
    hoursAgo: 2,
    artifacts: [
      {
        id: "mute-log",
        kind: "log",
        title: "npm install",
        content:
          "npm ERR! code ENOSPC\nnpm ERR! syscall write\nnpm ERR! errno -28\nnpm ERR! nospc ENOSPC: no space left on device",
      },
      { id: "mute-shot", kind: "image", title: "Settings page", error: "screenshot failed: page did not load" },
    ],
  },
  {
    jobId: "mock-job-cause-build",
    initiativeRefId: CAUSE,
    refId: CAUSE,
    title: "Build out Causation primitive",
    state: "running",
    hoursAgo: 0,
    artifacts: [],
  },
  {
    jobId: "mock-job-cause-benchmarks",
    initiativeRefId: CAUSE,
    refId: CAUSE,
    title: "Benchmark the causation primitive",
    state: "done",
    hoursAgo: 3,
    artifacts: [
      {
        id: "cause-benchmarks-app",
        kind: "app",
        title: "Causation Benchmarks",
        app: { name: "causation-benchmarks", version: "v1" },
      },
      {
        id: "pr-hive-5650",
        kind: "pull_request",
        title: "Cause node and its evidence edges",
        content: pr("stakwork/hive", 5650, "open", "pending", "cause-node"),
      },
      { id: "cause-pod", kind: "url", title: "Pod", label: "Pod", url: "https://pod-cause.example.com" },
      { id: "cause-ide", kind: "url", title: "IDE", label: "IDE", url: "https://ide-cause.example.com" },
      causeGraph(1, CAUSE),
      causeGraph(2, "mock-cause-m1"),
      causeGraph(3, "mock-cause-m2"),
      causeGraph(4, "mock-cause-s1"),
      { id: "cause-notes-1", kind: "markdown", title: "Notes", label: "Notes", content: causeNotes(1) },
      {
        id: "cause-notes-2",
        kind: "markdown",
        title: "Notes on the benchmarks",
        label: "Notes",
        content: causeNotes(2),
      },
    ],
  },
];

/** The files the mock jobs' keys name, by file name: what the reader serves under mocks. */
export const MOCK_STRUT_FILES: Record<string, string> = {
  "onboarding-step-1.png": "image/png",
  "onboarding-step-2.png": "image/png",
  "onboarding-step-3.png": "image/png",
  "walkthrough.json": "application/json",
  "repo-picker.html": "text/html; charset=utf-8",
  "security-review.pdf": "application/pdf",
};

/**
 * A mock job's file, as the reader serves it: only under mocks and only for
 * `MOCK_STRUT_SWARM_ID` (the caller checks both), only the names above. Null
 * for anything else.
 */
export async function mockStrutFile(path: string): Promise<{ body: Buffer; contentType: string } | null> {
  // A bare name from the list: no folders, nothing else on disk.
  const contentType = Object.hasOwn(MOCK_STRUT_FILES, path) ? MOCK_STRUT_FILES[path] : undefined;
  if (!contentType) return null;
  try {
    return { body: await readFile(join(process.cwd(), "src/app/api/mock/graph/strut-files", path)), contentType };
  } catch {
    return null;
  }
}
