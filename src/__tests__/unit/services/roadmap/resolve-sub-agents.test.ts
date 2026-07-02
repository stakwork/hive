/**
 * Unit tests for workspaceToSubAgent, resolveOrgMemberSwarms, and resolveSubAgents
 * in src/services/roadmap/feature-chat.ts
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    workspace: { findFirst: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("@/lib/utils/swarm", () => ({
  transformSwarmUrlToRepo2Graph: vi.fn((url: string) =>
    url ? url.replace("/api", ":3355") : "",
  ),
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn((_field: string, value: string) => `decrypted:${value}`),
    })),
  },
}));

vi.mock("@/lib/runtime", () => ({
  isDevelopmentMode: vi.fn(() => false),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import { db } from "@/lib/db";
import {
  workspaceToSubAgent,
  resolveOrgMemberSwarms,
  resolveSubAgents,
} from "@/services/roadmap/feature-chat";
import { isDevelopmentMode } from "@/lib/runtime";

const mockFindMany = vi.mocked(db.workspace.findMany as ReturnType<typeof vi.fn>);
const mockFindFirst = vi.mocked(db.workspace.findFirst as ReturnType<typeof vi.fn>);
const mockIsDev = vi.mocked(isDevelopmentMode);

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    id: "ws-1",
    slug: "my-workspace",
    description: "My workspace",
    deleted: false,
    ownerId: "user-1",
    sourceControlOrgId: "org-1",
    swarm: {
      id: "swarm-1",
      swarmUrl: "https://swarm.example.com/api",
      swarmApiKey: "encrypted-key",
    },
    repositories: [
      { repositoryUrl: "https://github.com/org/repo1" },
      { repositoryUrl: "https://github.com/org/repo2" },
    ],
    ...overrides,
  };
}

// ── workspaceToSubAgent ───────────────────────────────────────────────────────

describe("workspaceToSubAgent", () => {
  it("maps a workspace with swarm and repos to a SubAgent", () => {
    const ws = makeWorkspace();
    const agent = workspaceToSubAgent(ws);
    expect(agent).toEqual({
      name: "my-workspace",
      description: "My workspace",
      url: "https://swarm.example.com:3355",
      apiKey: "decrypted:encrypted-key",
      repoUrls: "https://github.com/org/repo1,https://github.com/org/repo2",
      toolsConfig: { learn_concepts: true },
    });
  });

  it("returns null when swarm is null", () => {
    const ws = makeWorkspace({ swarm: null });
    expect(workspaceToSubAgent(ws)).toBeNull();
  });

  it("returns null when swarm has no swarmUrl", () => {
    const ws = makeWorkspace({ swarm: { id: "s1", swarmUrl: null, swarmApiKey: "key" } });
    expect(workspaceToSubAgent(ws)).toBeNull();
  });

  it("returns null when repositories is empty", () => {
    const ws = makeWorkspace({ repositories: [] });
    expect(workspaceToSubAgent(ws)).toBeNull();
  });

  it("omits description when workspace.description is null", () => {
    const ws = makeWorkspace({ description: null });
    const agent = workspaceToSubAgent(ws);
    expect(agent).not.toBeNull();
    expect(agent!.description).toBeUndefined();
  });
});

// ── resolveOrgMemberSwarms ────────────────────────────────────────────────────

describe("resolveOrgMemberSwarms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls db.workspace.findMany exactly once (batched, not per-workspace)", async () => {
    mockFindMany.mockResolvedValueOnce([
      makeWorkspace({ slug: "ws-a" }),
      makeWorkspace({ slug: "ws-b", repositories: [{ repositoryUrl: "https://github.com/org/b" }] }),
    ]);

    await resolveOrgMemberSwarms("user-1", "org-1");

    expect(mockFindMany).toHaveBeenCalledTimes(1);
  });

  it("queries with correct authorization filter (owner OR active member, leftAt:null)", async () => {
    mockFindMany.mockResolvedValueOnce([]);

    await resolveOrgMemberSwarms("user-1", "org-1");

    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceControlOrgId: "org-1",
          deleted: false,
          OR: [
            { ownerId: "user-1" },
            { members: { some: { userId: "user-1", leftAt: null } } },
          ],
        }),
      }),
    );
  });

  it("maps valid workspaces to SubAgents", async () => {
    mockFindMany.mockResolvedValueOnce([
      makeWorkspace({ slug: "ws-a" }),
      makeWorkspace({ slug: "ws-b", repositories: [{ repositoryUrl: "https://github.com/org/b" }] }),
    ]);

    const result = await resolveOrgMemberSwarms("user-1", "org-1");

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("ws-a");
    expect(result[1].name).toBe("ws-b");
  });

  it("silently skips workspaces with no swarm", async () => {
    mockFindMany.mockResolvedValueOnce([
      makeWorkspace({ slug: "no-swarm", swarm: null }),
      makeWorkspace({ slug: "ok-ws" }),
    ]);

    const result = await resolveOrgMemberSwarms("user-1", "org-1");

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("ok-ws");
  });

  it("silently skips workspaces with no repositories", async () => {
    mockFindMany.mockResolvedValueOnce([
      makeWorkspace({ slug: "no-repos", repositories: [] }),
      makeWorkspace({ slug: "ok-ws" }),
    ]);

    const result = await resolveOrgMemberSwarms("user-1", "org-1");

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("ok-ws");
  });

  it("returns empty array for an org with no accessible workspaces", async () => {
    mockFindMany.mockResolvedValueOnce([]);

    const result = await resolveOrgMemberSwarms("user-1", "org-1");

    expect(result).toHaveLength(0);
  });
});

// ── resolveSubAgents ──────────────────────────────────────────────────────────

describe("resolveSubAgents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDev.mockReturnValue(false);
  });

  it("unions mention-based and org-member agents", async () => {
    // resolveExtraSwarms finds mention workspace
    mockFindFirst.mockResolvedValueOnce(makeWorkspace({ slug: "mentioned-ws" }));
    // resolveOrgMemberSwarms returns two workspaces
    mockFindMany.mockResolvedValueOnce([
      makeWorkspace({ slug: "org-ws-1" }),
      makeWorkspace({ slug: "org-ws-2" }),
    ]);

    const result = await resolveSubAgents({
      message: "@mentioned-ws do something",
      userId: "user-1",
      sourceControlOrgId: "org-1",
    });

    expect(result).toHaveLength(3);
    expect(result.map((a) => a.name)).toContain("mentioned-ws");
    expect(result.map((a) => a.name)).toContain("org-ws-1");
    expect(result.map((a) => a.name)).toContain("org-ws-2");
  });

  it("deduplicates by slug — manual @mention wins over org auto-attach", async () => {
    // The same slug appears in both resolvers
    const mentionWs = makeWorkspace({ slug: "shared-ws", description: "from-mention" });
    const orgWs = makeWorkspace({ slug: "shared-ws", description: "from-org" });

    mockFindFirst.mockResolvedValueOnce(mentionWs);
    mockFindMany.mockResolvedValueOnce([orgWs]);

    const result = await resolveSubAgents({
      message: "@shared-ws do something",
      userId: "user-1",
      sourceControlOrgId: "org-1",
    });

    expect(result).toHaveLength(1);
    // Manual mention entry is preserved (comes first, org duplicate dropped)
    expect(result[0].description).toBe("from-mention");
  });

  it("returns only mention agents when org returns nothing new", async () => {
    mockFindFirst.mockResolvedValueOnce(makeWorkspace({ slug: "mention-ws" }));
    mockFindMany.mockResolvedValueOnce([]);

    const result = await resolveSubAgents({
      message: "@mention-ws hi",
      userId: "user-1",
      sourceControlOrgId: "org-1",
    });

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("mention-ws");
  });

  it("returns only org agents when no @mentions in message", async () => {
    mockFindMany.mockResolvedValueOnce([makeWorkspace({ slug: "org-ws" })]);

    const result = await resolveSubAgents({
      message: "no mentions here",
      userId: "user-1",
      sourceControlOrgId: "org-1",
    });

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("org-ws");
  });

  it("returns empty array when both resolvers find nothing", async () => {
    mockFindMany.mockResolvedValueOnce([]);

    const result = await resolveSubAgents({
      message: "no mentions",
      userId: "user-1",
      sourceControlOrgId: "org-1",
    });

    expect(result).toHaveLength(0);
  });

  it("accumulates mentions across array of messages", async () => {
    mockFindFirst
      .mockResolvedValueOnce(makeWorkspace({ slug: "ws-a" }))
      .mockResolvedValueOnce(makeWorkspace({ slug: "ws-b" }));
    mockFindMany.mockResolvedValueOnce([]);

    const result = await resolveSubAgents({
      message: ["turn 1 @ws-a", "turn 2 @ws-b"],
      userId: "user-1",
      sourceControlOrgId: "org-1",
    });

    expect(result).toHaveLength(2);
    expect(result.map((a) => a.name)).toContain("ws-a");
    expect(result.map((a) => a.name)).toContain("ws-b");
  });
});
