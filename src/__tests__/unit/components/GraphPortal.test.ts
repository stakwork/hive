import { describe, it, expect } from "vitest";

// ---- Types mirrored from GraphPortal.tsx for testing ----

interface RepoSummary {
  id: string;
  name: string;
  repositoryUrl: string;
}

interface FeatureSummary {
  id: string;
  title: string;
  status: string;
  assignee: { id: string } | null;
  createdBy: { id: string };
}

interface TaskSummary {
  id: string;
  title: string;
  status: string;
  workflowStatus: string | null;
  assignee: { id: string } | null;
  createdBy: { id: string };
  feature: { id: string } | null;
  repository?: { repositoryUrl: string } | null;
  prArtifact?: { content?: { url?: string; status?: string; repo?: string } } | null;
}

interface WhiteboardSummary {
  id: string;
  name: string;
  featureId: string | null;
}

interface WorkspaceData {
  slug: string;
  workspaceId: string;
  name: string;
  members: { id: string; userId: string; role: string; user: { id: string; name: string; email: string } }[];
  features: FeatureSummary[];
  tasks: TaskSummary[];
  whiteboards: WhiteboardSummary[];
  repositories: RepoSummary[];
}

// ---- Pure logic extracted from GraphPortal for unit testing ----

interface RawNode {
  id: string;
  label?: string;
  nodeType?: string;
  loaderId?: string;
  [key: string]: unknown;
}

interface RawEdge {
  source: string;
  target: string;
  [key: string]: unknown;
}

interface NodeMeta {
  workspace: string;
  entityType: string;
  status?: string;
  connectedMembers: string[];
}

function buildWorkspaceGraph(allData: WorkspaceData[]): {
  nodes: RawNode[];
  edges: RawEdge[];
  nodeMeta: Map<string, NodeMeta>;
} {
  const nodes: RawNode[] = [];
  const edges: RawEdge[] = [];
  const nodeMeta = new Map<string, NodeMeta>();
  const hasMultiple = allData.length > 1;

  const meta = (id: string, workspace: string, entityType: string, status?: string) => {
    nodeMeta.set(id, { workspace, entityType, status, connectedMembers: [] });
  };

  for (const ws of allData) {
    const wsId = hasMultiple ? `ws-${ws.slug}` : "workspace";
    const prefix = hasMultiple ? `${ws.slug}-` : "";

    nodes.push({ id: wsId, label: ws.name, nodeType: "workspace" });
    meta(wsId, ws.slug, "workspace");

    nodes.push({ id: `${prefix}group-members`, label: "Members", nodeType: "group" });
    nodes.push({ id: `${prefix}group-features`, label: "Features", nodeType: "group" });
    meta(`${prefix}group-members`, ws.slug, "group");
    meta(`${prefix}group-features`, ws.slug, "group");
    edges.push({ source: wsId, target: `${prefix}group-members` });
    edges.push({ source: wsId, target: `${prefix}group-features` });

    // Repositories — per-repo nodes with scoped Code + Pull Requests children
    if (ws.repositories.length > 0) {
      const groupReposId = `${prefix}group-repos`;
      nodes.push({ id: groupReposId, label: "Repositories", nodeType: "group" });
      meta(groupReposId, ws.slug, "group");
      edges.push({ source: wsId, target: groupReposId });
      for (const repo of ws.repositories) {
        const repoNodeId = `${prefix}repo-${repo.id}`;
        nodes.push({ id: repoNodeId, label: repo.name, nodeType: "group" });
        meta(repoNodeId, ws.slug, "group");
        edges.push({ source: groupReposId, target: repoNodeId });
        nodes.push({ id: `${repoNodeId}-code`, label: "Code", loaderId: `${repoNodeId}-code`, nodeType: "repo" });
        meta(`${repoNodeId}-code`, ws.slug, "repo");
        edges.push({ source: repoNodeId, target: `${repoNodeId}-code` });
        nodes.push({ id: `${repoNodeId}-prs`, label: "Pull Requests", loaderId: `${repoNodeId}-prs`, nodeType: "repo" });
        meta(`${repoNodeId}-prs`, ws.slug, "repo");
        edges.push({ source: repoNodeId, target: `${repoNodeId}-prs` });
      }
    } else {
      // Fallback: preserve original single-repo structure
      nodes.push({ id: `${prefix}group-repo`, label: "Repository", nodeType: "group" });
      meta(`${prefix}group-repo`, ws.slug, "group");
      edges.push({ source: wsId, target: `${prefix}group-repo` });
      nodes.push({ id: `${prefix}repo-code`, label: "Code", loaderId: `${prefix}repo-code`, nodeType: "repo" });
      meta(`${prefix}repo-code`, ws.slug, "repo");
      edges.push({ source: `${prefix}group-repo`, target: `${prefix}repo-code` });
      nodes.push({ id: `${prefix}repo-prs`, label: "Pull Requests", loaderId: `${prefix}repo-prs`, nodeType: "repo" });
      meta(`${prefix}repo-prs`, ws.slug, "repo");
      edges.push({ source: `${prefix}group-repo`, target: `${prefix}repo-prs` });
    }
  }

  return { nodes, edges, nodeMeta };
}

function createRepoPRLoaderResult(
  tasks: TaskSummary[],
  prefix: string,
  repoId: string,
  repositoryUrl: string,
): { nodes: RawNode[]; edges: RawEdge[] } {
  const nodes: RawNode[] = [];
  const edges: RawEdge[] = [];
  const prsNodeId = repoId ? `${prefix}repo-${repoId}-prs` : `${prefix}repo-prs`;

  const PR_STATUS: Record<string, "executing" | "done" | "idle"> = {
    IN_PROGRESS: "executing",
    DONE: "done",
    CANCELLED: "idle",
  };

  const filteredTasks = repositoryUrl
    ? tasks.filter(t => t.repository?.repositoryUrl === repositoryUrl)
    : tasks;

  for (const task of filteredTasks) {
    const pr = task.prArtifact?.content;
    if (!pr?.url) continue;
    const match = pr.url.match(/\/pull\/(\d+)/);
    const prLabel = match ? `#${match[1]}` : task.title;
    const prNodeId = repoId ? `${prefix}repo-${repoId}-pr-${task.id}` : `${prefix}pr-${task.id}`;
    nodes.push({
      id: prNodeId,
      label: prLabel,
      status: PR_STATUS[pr.status || ""] || "idle",
      content: pr.status || "unknown",
    });
    edges.push({ source: prsNodeId, target: prNodeId });
  }

  return { nodes, edges };
}

// ---- search match logic ----
function computeSearchMatches(
  graphNodes: Array<{ label?: string }>,
  searchText: string,
): Set<number> | null {
  if (!searchText.trim()) return null;
  const q = searchText.toLowerCase();
  const matches = new Set<number>();
  graphNodes.forEach((node, i) => {
    if (node.label?.toLowerCase().includes(q)) matches.add(i);
  });
  return matches.size > 0 ? matches : null;
}

// ---- Tests ----

describe("buildWorkspaceGraph", () => {
  const baseWs = (repos: RepoSummary[]): WorkspaceData => ({
    slug: "test-ws",
    workspaceId: "ws-1",
    name: "Test Workspace",
    members: [],
    features: [],
    tasks: [],
    whiteboards: [],
    repositories: repos,
  });

  it("shows a Repositories group node with one child per repo when repos exist", () => {
    const repos: RepoSummary[] = [
      { id: "r1", name: "backend", repositoryUrl: "https://github.com/org/backend" },
      { id: "r2", name: "frontend", repositoryUrl: "https://github.com/org/frontend" },
    ];
    const { nodes, edges } = buildWorkspaceGraph([baseWs(repos)]);

    // group-repos node
    const groupRepos = nodes.find(n => n.id === "group-repos");
    expect(groupRepos).toBeDefined();
    expect(groupRepos?.label).toBe("Repositories");

    // two repo group nodes
    const repoR1 = nodes.find(n => n.id === "repo-r1");
    const repoR2 = nodes.find(n => n.id === "repo-r2");
    expect(repoR1).toBeDefined();
    expect(repoR1?.label).toBe("backend");
    expect(repoR2).toBeDefined();
    expect(repoR2?.label).toBe("frontend");

    // each repo has -code and -prs loader children
    expect(nodes.find(n => n.id === "repo-r1-code")).toBeDefined();
    expect(nodes.find(n => n.loaderId === "repo-r1-code")).toBeDefined();
    expect(nodes.find(n => n.id === "repo-r1-prs")).toBeDefined();
    expect(nodes.find(n => n.loaderId === "repo-r1-prs")).toBeDefined();
    expect(nodes.find(n => n.id === "repo-r2-code")).toBeDefined();
    expect(nodes.find(n => n.id === "repo-r2-prs")).toBeDefined();

    // edges from group-repos to each repo node
    expect(edges).toContainEqual({ source: "group-repos", target: "repo-r1" });
    expect(edges).toContainEqual({ source: "group-repos", target: "repo-r2" });

    // no old single-repo nodes
    expect(nodes.find(n => n.id === "group-repo")).toBeUndefined();
    expect(nodes.find(n => n.id === "repo-code")).toBeUndefined();
    expect(nodes.find(n => n.id === "repo-prs")).toBeUndefined();
  });

  it("falls back to original Repository → Code + Pull Requests when repos is empty", () => {
    const { nodes, edges } = buildWorkspaceGraph([baseWs([])]);

    // old single-repo structure preserved
    const groupRepo = nodes.find(n => n.id === "group-repo");
    expect(groupRepo).toBeDefined();
    expect(groupRepo?.label).toBe("Repository");

    expect(nodes.find(n => n.id === "repo-code")).toBeDefined();
    expect(nodes.find(n => n.loaderId === "repo-code")).toBeDefined();
    expect(nodes.find(n => n.id === "repo-prs")).toBeDefined();
    expect(nodes.find(n => n.loaderId === "repo-prs")).toBeDefined();

    expect(edges).toContainEqual({ source: "group-repo", target: "repo-code" });
    expect(edges).toContainEqual({ source: "group-repo", target: "repo-prs" });

    // no new multi-repo nodes
    expect(nodes.find(n => n.id === "group-repos")).toBeUndefined();
  });

  it("uses slug prefix when multiple workspaces are present", () => {
    const ws1 = baseWs([{ id: "r1", name: "api", repositoryUrl: "https://github.com/org/api" }]);
    const ws2: WorkspaceData = {
      ...baseWs([]),
      slug: "other-ws",
      workspaceId: "ws-2",
      name: "Other Workspace",
    };
    const { nodes } = buildWorkspaceGraph([ws1, ws2]);

    expect(nodes.find(n => n.id === "test-ws-group-repos")).toBeDefined();
    expect(nodes.find(n => n.id === "test-ws-repo-r1")).toBeDefined();
    expect(nodes.find(n => n.id === "test-ws-repo-r1-code")).toBeDefined();
    // second workspace uses fallback (no repos)
    expect(nodes.find(n => n.id === "other-ws-group-repo")).toBeDefined();
  });
});

describe("createRepoPRLoader — filtering by repositoryUrl", () => {
  const makePRTask = (id: string, repoUrl: string, prUrl: string): TaskSummary => ({
    id,
    title: `Task ${id}`,
    status: "DONE",
    workflowStatus: null,
    assignee: null,
    createdBy: { id: "user-1" },
    feature: null,
    repository: { repositoryUrl: repoUrl },
    prArtifact: { content: { url: prUrl, status: "DONE" } },
  });

  const tasks: TaskSummary[] = [
    makePRTask("t1", "https://github.com/org/backend", "https://github.com/org/backend/pull/1"),
    makePRTask("t2", "https://github.com/org/backend", "https://github.com/org/backend/pull/2"),
    makePRTask("t3", "https://github.com/org/frontend", "https://github.com/org/frontend/pull/5"),
  ];

  it("returns only PR nodes matching the given repositoryUrl", () => {
    const { nodes, edges } = createRepoPRLoaderResult(tasks, "", "r1", "https://github.com/org/backend");

    const nodeIds = nodes.map(n => n.id);
    expect(nodeIds).toContain("repo-r1-pr-t1");
    expect(nodeIds).toContain("repo-r1-pr-t2");
    expect(nodeIds).not.toContain("repo-r1-pr-t3");
    expect(nodes).toHaveLength(2);
  });

  it("returns only PRs for the other repo when a different URL is given", () => {
    const { nodes } = createRepoPRLoaderResult(tasks, "", "r2", "https://github.com/org/frontend");

    const nodeIds = nodes.map(n => n.id);
    expect(nodeIds).toContain("repo-r2-pr-t3");
    expect(nodeIds).not.toContain("repo-r2-pr-t1");
    expect(nodes).toHaveLength(1);
  });

  it("returns all PR tasks when repositoryUrl is empty (fallback)", () => {
    const { nodes } = createRepoPRLoaderResult(tasks, "", "", "");
    // all 3 tasks have PR urls so all 3 appear
    expect(nodes).toHaveLength(3);
  });

  it("edges source from the correct prs node id", () => {
    const { edges } = createRepoPRLoaderResult(tasks, "myws-", "r1", "https://github.com/org/backend");
    for (const edge of edges) {
      expect(edge.source).toBe("myws-repo-r1-prs");
    }
  });
});

describe("search match logic", () => {
  const graphNodes = [
    { label: "Alice Johnson" },
    { label: "Backend API" },
    { label: "Feature: Auth" },
    { label: "Pull Requests" },
    { label: "backend" },
  ];

  it("returns indices of nodes whose label matches case-insensitively", () => {
    const result = computeSearchMatches(graphNodes, "backend");
    expect(result).not.toBeNull();
    expect(result!.has(1)).toBe(true); // "Backend API"
    expect(result!.has(4)).toBe(true); // "backend"
    expect(result!.has(0)).toBe(false);
    expect(result!.has(2)).toBe(false);
  });

  it("returns null when search text is empty", () => {
    expect(computeSearchMatches(graphNodes, "")).toBeNull();
    expect(computeSearchMatches(graphNodes, "   ")).toBeNull();
  });

  it("returns null when no nodes match", () => {
    expect(computeSearchMatches(graphNodes, "zzz-no-match")).toBeNull();
  });

  it("matches partial substrings", () => {
    const result = computeSearchMatches(graphNodes, "lic");
    expect(result).not.toBeNull();
    expect(result!.has(0)).toBe(true); // "Alice Johnson"
  });
});
