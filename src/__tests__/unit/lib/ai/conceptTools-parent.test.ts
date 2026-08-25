/**
 * Unit tests for the optional `parent` and `repo` fields on
 * `propose_new_concept`.
 *
 * Covers:
 *  - `parent` present → trimmed value emitted in payload
 *  - `parent` absent → key not in payload
 *  - `parent` whitespace-only → key not in payload
 *  - `parent` not mirrored into meta
 *  - `repo` absent → key not in payload (general concept — NOT defaulted
 *    to the workspace's primary repo)
 *  - `repo` present + configured → included in payload and meta
 *  - `repo` present + unknown → error naming the available repos
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ──────────────────────────────────────────────────────────
const { mockFindFirst } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
}));

vi.mock("nanoid", () => ({ nanoid: () => "proposal-abc" }));

vi.mock("@/lib/db", () => ({
  db: { workspace: { findFirst: mockFindFirst } },
}));

vi.mock("@/lib/helpers/swarm-access", () => ({
  getSwarmAccessByWorkspaceId: vi.fn(),
}));

vi.mock("@/lib/ai/utils", () => ({
  parseOwnerRepo: (url: string) => {
    const parts = url.replace("https://github.com/", "").split("/");
    return { owner: parts[0] ?? "", repo: parts[1] ?? "" };
  },
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────
import { buildConceptTools } from "@/lib/ai/conceptTools";
import { PROPOSE_NEW_CONCEPT_TOOL } from "@/lib/proposals/types";

type ToolExecute = (input: Record<string, unknown>) => Promise<Record<string, unknown>>;

function getProposeNewConcept(): ToolExecute {
  const tools = buildConceptTools("org-1", "user-1");
  return (tools[PROPOSE_NEW_CONCEPT_TOOL] as unknown as { execute: ToolExecute }).execute;
}

const WORKSPACE = {
  id: "ws-cuid-1",
  name: "Acme Workspace",
  slug: "acme",
  repositories: [{ repositoryUrl: "https://github.com/acme/hive" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockFindFirst.mockResolvedValue(WORKSPACE);
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("propose_new_concept — parent field", () => {
  it("includes trimmed parent in payload when provided", async () => {
    const execute = getProposeNewConcept();
    const result = await execute({
      workspaceSlug: "acme",
      name: "Auth Guide",
      documentation: "# Auth\nHow auth works.",
      parent: "  acme/hive/authentication  ",
    });

    expect(result.kind).toBe("conceptCreate");
    expect((result.payload as Record<string, unknown>).parent).toBe(
      "acme/hive/authentication",
    );
  });

  it("omits parent key when parent is absent", async () => {
    const execute = getProposeNewConcept();
    const result = await execute({
      workspaceSlug: "acme",
      name: "Deployment Guide",
      documentation: "# Deploy\nHow to deploy.",
    });

    expect(result.kind).toBe("conceptCreate");
    expect(result.payload).not.toHaveProperty("parent");
  });

  it("omits parent key when parent is whitespace-only", async () => {
    const execute = getProposeNewConcept();
    const result = await execute({
      workspaceSlug: "acme",
      name: "Testing Guide",
      documentation: "# Tests\nHow to test.",
      parent: "   ",
    });

    expect(result.kind).toBe("conceptCreate");
    expect(result.payload).not.toHaveProperty("parent");
  });

  it("does not mirror parent into meta", async () => {
    const execute = getProposeNewConcept();
    const result = await execute({
      workspaceSlug: "acme",
      name: "CI Guide",
      documentation: "# CI\nHow CI works.",
      parent: "acme/hive/devops",
    });

    expect(result.kind).toBe("conceptCreate");
    expect(result.meta).not.toHaveProperty("parent");
  });
});

describe("propose_new_concept — repo field", () => {
  it("omits repo when not provided — general concepts are NOT stamped with the primary repo", async () => {
    const execute = getProposeNewConcept();
    const result = await execute({
      workspaceSlug: "acme",
      name: "Code Review Preferences",
      documentation: "# Reviews\nAlways squash-merge.",
    });

    expect(result.kind).toBe("conceptCreate");
    expect(result.payload).not.toHaveProperty("repo");
    expect(result.meta).not.toHaveProperty("repo");
  });

  it("includes an explicitly-chosen configured repo in payload and meta", async () => {
    const execute = getProposeNewConcept();
    const result = await execute({
      workspaceSlug: "acme",
      name: "Auth Guide",
      documentation: "# Auth\nHow auth works.",
      repo: "acme/hive",
    });

    expect(result.kind).toBe("conceptCreate");
    expect((result.payload as Record<string, unknown>).repo).toBe("acme/hive");
    expect((result.meta as Record<string, unknown>).repo).toBe("acme/hive");
  });

  it("errors on a repo the workspace does not have", async () => {
    const execute = getProposeNewConcept();
    const result = await execute({
      workspaceSlug: "acme",
      name: "Auth Guide",
      documentation: "# Auth\nHow auth works.",
      repo: "acme/other-repo",
    });

    expect(result.kind).toBeUndefined();
    expect(result.error).toContain("not configured for this workspace");
    expect(result.error).toContain("acme/hive");
  });
});
