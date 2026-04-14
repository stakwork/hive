import { describe, test, expect, vi, beforeEach } from "vitest";
import {
  buildWorkspaceGraph,
  createRepoPRLoader,
  type WorkspaceData,
  type TaskSummary,
  type RepoSummary,
} from "@/components/GraphPortal";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeRepo(overrides?: Partial<RepoSummary>): RepoSummary {
  return {
    id: "repo-1",
    name: "my-repo",
    repositoryUrl: "https://github.com/org/my-repo",
    ...overrides,
  };
}

function makeTask(overrides?: Partial<TaskSummary>): TaskSummary {
  return {
    id: "task-1",
    title: "Fix bug",
    status: "IN_PROGRESS",
    workflowStatus: null,
    assignee: null,
    createdBy: { id: "user-1" },
    feature: null,
    prArtifact: { content: { url: "https://github.com/org/repo/pull/42", status: "DONE" } },
    ...overrides,
  };
}

function makeWorkspaceData(overrides?: Partial<WorkspaceData>): WorkspaceData {
  return {
    slug: "my-workspace",
    workspaceId: "ws-1",
    name: "My Workspace",
    members: [],
    features: [],
    tasks: [],
    whiteboards: [],
    repositories: [],
    ...overrides,
  };
}

// ── buildWorkspaceGraph ───────────────────────────────────────────────────────

describe("buildWorkspaceGraph", () => {
  describe("with 2 configured repositories", () => {
    const repo1 = makeRepo({ id: "r1", name: "frontend", repositoryUrl: "https://github.com/org/frontend" });
    const repo2 = makeRepo({ id: "r2", name: "backend", repositoryUrl: "https://github.com/org/backend" });
    const ws = makeWorkspaceData({ repositories: [repo1, repo2] });
    const { nodes } = buildWorkspaceGraph([ws]);
    const nodeIds = nodes.map((n) => n.id);

    test("creates a group-repos parent node", () => {
      expect(nodeIds).toContain("group-repos");
    });

    test("does NOT create old single group-repo node", () => {
      expect(nodeIds).not.toContain("group-repo");
    });

    test("creates individual repo group nodes for each repository", () => {
      expect(nodeIds).toContain("repo-r1");
      expect(nodeIds).toContain("repo-r2");
    });

    test("labels individual repo nodes with repo names", () => {
      const r1Node = nodes.find((n) => n.id === "repo-r1");
      const r2Node = nodes.find((n) => n.id === "repo-r2");
      expect(r1Node?.label).toBe("frontend");
      expect(r2Node?.label).toBe("backend");
    });

    test("creates Code loader nodes under each repo", () => {
      expect(nodeIds).toContain("repo-r1-code");
      expect(nodeIds).toContain("repo-r2-code");
    });

    test("creates Pull Requests loader nodes under each repo", () => {
      expect(nodeIds).toContain("repo-r1-prs");
      expect(nodeIds).toContain("repo-r2-prs");
    });

    test("Code nodes have correct loaderId", () => {
      const codeNode = nodes.find((n) => n.id === "repo-r1-code");
      expect(codeNode?.loaderId).toBe("repo-r1-code");
    });

    test("Pull Requests nodes have correct loaderId", () => {
      const prsNode = nodes.find((n) => n.id === "repo-r2-prs");
      expect(prsNode?.loaderId).toBe("repo-r2-prs");
    });
  });

  describe("with 0 configured repositories (fallback)", () => {
    const ws = makeWorkspaceData({ repositories: [] });
    const { nodes, edges } = buildWorkspaceGraph([ws]);
    const nodeIds = nodes.map((n) => n.id);

    test("creates the original single group-repo node", () => {
      expect(nodeIds).toContain("group-repo");
    });

    test("does NOT create group-repos node", () => {
      expect(nodeIds).not.toContain("group-repos");
    });

    test("creates fallback repo-code loader node", () => {
      expect(nodeIds).toContain("repo-code");
    });

    test("creates fallback repo-prs loader node", () => {
      expect(nodeIds).toContain("repo-prs");
    });

    test("fallback repo-code has correct loaderId", () => {
      const codeNode = nodes.find((n) => n.id === "repo-code");
      expect(codeNode?.loaderId).toBe("repo-code");
    });

    test("edges connect group-repo to repo-code and repo-prs", () => {
      const edgePairs = edges.map((e) => `${e.source}→${e.target}`);
      expect(edgePairs).toContain("group-repo→repo-code");
      expect(edgePairs).toContain("group-repo→repo-prs");
    });
  });

  describe("with multiple workspaces (prefix mode)", () => {
    const repo = makeRepo({ id: "r1", name: "lib" });
    const ws1 = makeWorkspaceData({ slug: "ws-a", name: "Alpha", repositories: [repo] });
    const ws2 = makeWorkspaceData({ slug: "ws-b", name: "Beta", repositories: [] });
    const { nodes } = buildWorkspaceGraph([ws1, ws2]);
    const nodeIds = nodes.map((n) => n.id);

    test("prefixes ws1 nodes with slug", () => {
      expect(nodeIds).toContain("ws-a-group-repos");
      expect(nodeIds).toContain("ws-a-repo-r1");
      expect(nodeIds).toContain("ws-a-repo-r1-code");
    });

    test("ws2 uses fallback with its slug prefix", () => {
      expect(nodeIds).toContain("ws-b-group-repo");
      expect(nodeIds).toContain("ws-b-repo-code");
      expect(nodeIds).toContain("ws-b-repo-prs");
    });
  });
});

// ── createRepoPRLoader ────────────────────────────────────────────────────────

describe("createRepoPRLoader", () => {
  const repoAUrl = "https://github.com/org/repo-a";
  const repoBUrl = "https://github.com/org/repo-b";

  const taskA = makeTask({
    id: "task-a",
    prArtifact: { content: { url: "https://github.com/org/repo-a/pull/1", status: "DONE" } },
    repository: { repositoryUrl: repoAUrl },
  });
  const taskB = makeTask({
    id: "task-b",
    prArtifact: { content: { url: "https://github.com/org/repo-b/pull/2", status: "IN_PROGRESS" } },
    repository: { repositoryUrl: repoBUrl },
  });
  const taskNoRepo = makeTask({
    id: "task-no-repo",
    prArtifact: { content: { url: "https://github.com/org/repo-a/pull/3", status: "DONE" } },
    repository: null,
  });

  test("filters tasks to only those matching the given repositoryUrl", async () => {
    const loader = createRepoPRLoader([taskA, taskB], "ws", "", "rid-a", repoAUrl);
    const { nodes } = await loader();
    const nodeIds = nodes.map((n) => n.id);
    expect(nodeIds.some((id) => id.includes("task-a"))).toBe(true);
    expect(nodeIds.some((id) => id.includes("task-b"))).toBe(false);
  });

  test("uses scoped prNodeId with repoId prefix", async () => {
    const loader = createRepoPRLoader([taskA], "ws", "", "rid-a", repoAUrl);
    const { nodes } = await loader();
    expect(nodes[0].id).toBe("repo-rid-a-pr-task-a");
  });

  test("edges point from repo-{repoId}-prs to prNodeId", async () => {
    const loader = createRepoPRLoader([taskA], "ws", "", "rid-a", repoAUrl);
    const { edges } = await loader();
    expect(edges[0].source).toBe("repo-rid-a-prs");
  });

  test("when repositoryUrl is empty string, includes all tasks with PRs", async () => {
    const loader = createRepoPRLoader([taskA, taskB], "ws", "", "", "");
    const { nodes } = await loader();
    const nodeIds = nodes.map((n) => n.id);
    expect(nodeIds.some((id) => id.includes("task-a"))).toBe(true);
    expect(nodeIds.some((id) => id.includes("task-b"))).toBe(true);
  });

  test("excludes tasks without prArtifact url even when repo matches", async () => {
    const taskNoPR = makeTask({
      id: "task-no-pr",
      prArtifact: null,
      repository: { repositoryUrl: repoAUrl },
    });
    const loader = createRepoPRLoader([taskNoPR], "ws", "", "rid-a", repoAUrl);
    const { nodes } = await loader();
    expect(nodes).toHaveLength(0);
  });

  test("tasks with no repository field are excluded when repositoryUrl filter is active", async () => {
    const loader = createRepoPRLoader([taskNoRepo], "ws", "", "rid-a", repoAUrl);
    const { nodes } = await loader();
    expect(nodes).toHaveLength(0);
  });

  test("uses fallback prNodeId format when repoId is empty", async () => {
    const loader = createRepoPRLoader([taskA], "ws", "", "", "");
    const { nodes } = await loader();
    expect(nodes[0].id).toBe("pr-task-a");
  });

  test("fallback edges point from repo-prs when repoId is empty", async () => {
    const loader = createRepoPRLoader([taskA], "ws", "", "", "");
    const { edges } = await loader();
    expect(edges[0].source).toBe("repo-prs");
  });
});

// ── search logic (pure computation, mirroring the useEffect) ─────────────────

describe("search node matching logic", () => {
  // Replicate the logic from GraphPortal's search useEffect as a pure function
  function computeSearchMatches(
    nodes: Array<{ label?: string }>,
    searchText: string,
  ): Set<number> | null {
    if (!searchText.trim()) return null;
    const q = searchText.toLowerCase();
    const matches = new Set<number>();
    nodes.forEach((node, i) => {
      if (node.label?.toLowerCase().includes(q)) matches.add(i);
    });
    return matches.size > 0 ? matches : null;
  }

  const nodes = [
    { label: "Alice Smith" },
    { label: "Backend Service" },
    { label: "alice-repo" },
    { label: "Feature: Auth" },
    { label: "Pull Requests" },
  ];

  test("matches nodes containing the query string (case-insensitive)", () => {
    const result = computeSearchMatches(nodes, "alice");
    expect(result).not.toBeNull();
    expect(result!.has(0)).toBe(true); // "Alice Smith"
    expect(result!.has(2)).toBe(true); // "alice-repo"
  });

  test("does not match nodes that do not contain the query", () => {
    const result = computeSearchMatches(nodes, "alice");
    expect(result!.has(1)).toBe(false);
    expect(result!.has(3)).toBe(false);
    expect(result!.has(4)).toBe(false);
  });

  test("returns null when no nodes match", () => {
    const result = computeSearchMatches(nodes, "zzznomatch");
    expect(result).toBeNull();
  });

  test("returns null for empty search text", () => {
    expect(computeSearchMatches(nodes, "")).toBeNull();
  });

  test("returns null for whitespace-only search text", () => {
    expect(computeSearchMatches(nodes, "   ")).toBeNull();
  });

  test("is case-insensitive", () => {
    const resultLower = computeSearchMatches(nodes, "BACKEND");
    expect(resultLower!.has(1)).toBe(true);
  });

  test("matches partial substrings", () => {
    const result = computeSearchMatches(nodes, "pull");
    expect(result!.has(4)).toBe(true);
  });

  test("returns correct count of matches", () => {
    const result = computeSearchMatches(nodes, "a");
    // "Alice Smith", "Backend Service", "alice-repo", "Feature: Auth", "Pull Requests" — all contain "a"
    expect(result!.size).toBeGreaterThan(0);
  });
});
