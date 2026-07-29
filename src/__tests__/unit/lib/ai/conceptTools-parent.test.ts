/**
 * Unit tests for the optional `parent` field on `propose_new_concept`.
 *
 * Covers:
 *  - `parent` present → trimmed value emitted in payload
 *  - `parent` absent → key not in payload
 *  - `parent` whitespace-only → key not in payload
 *  - `parent` not mirrored into meta
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
