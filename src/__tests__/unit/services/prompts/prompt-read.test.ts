/**
 * Unit tests for src/services/prompts/prompt-read.ts
 *
 * Uses vi.mock('@/lib/db') to stub Prisma so no real DB is required.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";

// ─── Mock Prisma ──────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    prompt: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  getResolvedPrompt,
  listPromptVersions,
  getResolvedPromptVersion,
} from "@/services/prompts/prompt-read";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockFindFirst = vi.mocked(db.prompt.findFirst);
const mockFindUnique = vi.mocked(db.prompt.findUnique);

function makePrompt(overrides: {
  id?: string;
  name?: string;
  publishedVersionId?: string | null;
  versions?: Array<{ id: string; versionNumber: number; value: string; createdAt?: Date }>;
} = {}) {
  const versions = overrides.versions ?? [
    { id: "v1", versionNumber: 1, value: "Hello world", createdAt: new Date("2026-01-01") },
  ];
  return {
    id: overrides.id ?? "prompt-1",
    name: overrides.name ?? "MY_PROMPT",
    publishedVersionId:
      overrides.publishedVersionId !== undefined
        ? overrides.publishedVersionId
        : (versions[0]?.id ?? null),
    versions,
  };
}

// ─── getResolvedPrompt ────────────────────────────────────────────────────────

describe("getResolvedPrompt", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns resolved text when fetched by cuid id", async () => {
    mockFindFirst.mockResolvedValue(makePrompt() as any);

    const result = await getResolvedPrompt("prompt-1", {});

    expect("notFound" in result).toBe(false);
    expect("error" in result).toBe(false);
    const ok = result as { resolvedText: string; name: string };
    expect(ok.resolvedText).toBe("Hello world");
    expect(ok.name).toBe("MY_PROMPT");
  });

  it("returns resolved text when fetched by name", async () => {
    mockFindFirst.mockResolvedValue(makePrompt({ name: "MY_PROMPT" }) as any);

    const result = await getResolvedPrompt("MY_PROMPT", {});

    const ok = result as { name: string };
    expect(ok.name).toBe("MY_PROMPT");
  });

  it("selects the published version by default", async () => {
    const prompt = makePrompt({
      publishedVersionId: "v2",
      versions: [
        { id: "v2", versionNumber: 2, value: "published text" },
        { id: "v3", versionNumber: 3, value: "latest text" },
        { id: "v1", versionNumber: 1, value: "old text" },
      ],
    });
    mockFindFirst.mockResolvedValue(prompt as any);

    const result = await getResolvedPrompt("MY_PROMPT", {});

    const ok = result as { versionId: string; resolvedText: string };
    expect(ok.versionId).toBe("v2");
    expect(ok.resolvedText).toBe("published text");
  });

  it("falls back to highest-numbered version (first in desc order) when no publishedVersionId", async () => {
    const prompt = makePrompt({
      publishedVersionId: null,
      // Simulating what the DB returns: ordered desc by versionNumber
      versions: [
        { id: "v3", versionNumber: 3, value: "newest" },
        { id: "v2", versionNumber: 2, value: "middle" },
        { id: "v1", versionNumber: 1, value: "old" },
      ],
    });
    mockFindFirst.mockResolvedValue(prompt as any);

    const result = await getResolvedPrompt("MY_PROMPT", {});

    const ok = result as { versionId: string; resolvedText: string };
    expect(ok.versionId).toBe("v3");
    expect(ok.resolvedText).toBe("newest");
  });

  it("interpolates supplied variables", async () => {
    mockFindFirst.mockResolvedValue(
      makePrompt({
        versions: [{ id: "v1", versionNumber: 1, value: "Hello {{user_name}}!" }],
      }) as any,
    );

    const result = await getResolvedPrompt("MY_PROMPT", { user_name: "Alice" });

    const ok = result as { resolvedText: string; missingVariables: string[] };
    expect(ok.resolvedText).toBe("Hello Alice!");
    expect(ok.missingVariables).toEqual([]);
  });

  it("leaves unfilled placeholder intact and reports missingVariables", async () => {
    mockFindFirst.mockResolvedValue(
      makePrompt({
        versions: [{ id: "v1", versionNumber: 1, value: "Hello {{user_name}}!" }],
      }) as any,
    );
    // {{user_name}} is not a known prompt either.
    mockFindUnique.mockResolvedValue(null);

    const result = await getResolvedPrompt("MY_PROMPT", {});

    const ok = result as { resolvedText: string; missingVariables: string[] };
    expect(ok.resolvedText).toBe("Hello {{user_name}}!");
    expect(ok.missingVariables).toContain("user_name");
  });

  it("expands nested {{CHILD_PROMPT}} reference via recursive DB lookup", async () => {
    const parentPrompt = makePrompt({
      name: "PARENT",
      versions: [{ id: "v1", versionNumber: 1, value: "Parent: {{CHILD}}" }],
    });
    const childPromptData = {
      id: "child-1",
      name: "CHILD",
      publishedVersionId: "cv1",
      versions: [{ id: "cv1", versionNumber: 1, value: "child content" }],
    };

    mockFindFirst.mockResolvedValue(parentPrompt as any);
    mockFindUnique.mockResolvedValue(childPromptData as any);

    const result = await getResolvedPrompt("PARENT", {});

    const ok = result as { resolvedText: string; missingVariables: string[] };
    expect(ok.resolvedText).toBe("Parent: child content");
    expect(ok.missingVariables).toEqual([]);
  });

  it("returns { notFound: true } when prompt not found", async () => {
    mockFindFirst.mockResolvedValue(null);

    const result = await getResolvedPrompt("UNKNOWN", {});

    expect("notFound" in result).toBe(true);
    expect((result as { notFound: boolean }).notFound).toBe(true);
  });

  it("detects a cycle and returns { error } instead of throwing", async () => {
    // PARENT references CHILD which references PARENT → cycle
    const parentPrompt = makePrompt({
      name: "PARENT",
      versions: [{ id: "v1", versionNumber: 1, value: "{{CHILD}}" }],
    });
    const childPromptData = {
      id: "child-1",
      name: "CHILD",
      publishedVersionId: "cv1",
      versions: [{ id: "cv1", versionNumber: 1, value: "{{PARENT}} text" }],
    };

    mockFindFirst.mockResolvedValue(parentPrompt as any);
    // First findUnique resolves CHILD; when resolving CHILD it would try PARENT which is in visitedNames.
    mockFindUnique.mockResolvedValue(childPromptData as any);

    const result = await getResolvedPrompt("PARENT", {});

    expect("error" in result).toBe(true);
    const err = result as { error: string };
    expect(err.error).toMatch(/circular/i);
  });
});

// ─── listPromptVersions ───────────────────────────────────────────────────────

describe("listPromptVersions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns all versions with correct published/current markers", async () => {
    const prompt = {
      id: "prompt-1",
      publishedVersionId: "v2",
      versions: [
        { id: "v1", versionNumber: 1, createdAt: new Date("2026-01-01") },
        { id: "v2", versionNumber: 2, createdAt: new Date("2026-06-01") },
        { id: "v3", versionNumber: 3, createdAt: new Date("2026-06-24") },
      ],
    };
    mockFindFirst.mockResolvedValue(prompt as any);

    const result = await listPromptVersions("MY_PROMPT");

    expect(Array.isArray(result)).toBe(true);
    const versions = result as Array<{
      versionId: string;
      versionNumber: number;
      published: boolean;
      current: boolean;
    }>;
    expect(versions).toHaveLength(3);
    expect(versions.find((v) => v.versionId === "v1")).toMatchObject({
      published: false,
      current: false,
    });
    expect(versions.find((v) => v.versionId === "v2")).toMatchObject({
      published: true,
      current: false,
    });
    expect(versions.find((v) => v.versionId === "v3")).toMatchObject({
      published: false,
      current: true,
    });
  });

  it("returns { notFound: true } when prompt not found", async () => {
    mockFindFirst.mockResolvedValue(null);

    const result = await listPromptVersions("UNKNOWN");

    expect("notFound" in result).toBe(true);
    expect((result as { notFound: boolean }).notFound).toBe(true);
  });
});

// ─── getResolvedPromptVersion ─────────────────────────────────────────────────

describe("getResolvedPromptVersion", () => {
  beforeEach(() => vi.clearAllMocks());

  it("resolves a specific version by versionId", async () => {
    const prompt = makePrompt({
      publishedVersionId: "v2",
      versions: [
        { id: "v1", versionNumber: 1, value: "version 1 text" },
        { id: "v2", versionNumber: 2, value: "version 2 text" },
      ],
    });
    mockFindFirst.mockResolvedValue(prompt as any);

    const result = await getResolvedPromptVersion("MY_PROMPT", "v1", {});

    const ok = result as { versionId: string; resolvedText: string; versionNumber: number };
    expect(ok.versionId).toBe("v1");
    expect(ok.resolvedText).toBe("version 1 text");
    expect(ok.versionNumber).toBe(1);
  });

  it("interpolates variables in the pinned version", async () => {
    mockFindFirst.mockResolvedValue(
      makePrompt({
        versions: [{ id: "v1", versionNumber: 1, value: "Hi {{name}}" }],
      }) as any,
    );

    const result = await getResolvedPromptVersion("MY_PROMPT", "v1", { name: "Bob" });

    const ok = result as { resolvedText: string };
    expect(ok.resolvedText).toBe("Hi Bob");
  });

  it("returns { notFound: true } for a versionId belonging to a different prompt (IDOR guard)", async () => {
    const prompt = makePrompt({
      versions: [{ id: "v1", versionNumber: 1, value: "text" }],
    });
    mockFindFirst.mockResolvedValue(prompt as any);

    // "other-version-id" does not exist in this prompt's versions.
    const result = await getResolvedPromptVersion("MY_PROMPT", "other-version-id", {});

    expect("notFound" in result).toBe(true);
    expect((result as { notFound: boolean }).notFound).toBe(true);
  });

  it("returns { notFound: true } when prompt not found", async () => {
    mockFindFirst.mockResolvedValue(null);

    const result = await getResolvedPromptVersion("UNKNOWN", "v1", {});

    expect("notFound" in result).toBe(true);
    expect((result as { notFound: boolean }).notFound).toBe(true);
  });

  it("returns { error } on direct self-cycle in a pinned version", async () => {
    // CYCLIC references itself — CYCLIC is in visitedNames when resolver starts.
    const prompt = makePrompt({
      name: "CYCLIC",
      versions: [{ id: "v1", versionNumber: 1, value: "{{CYCLIC}}" }],
    });
    mockFindFirst.mockResolvedValue(prompt as any);

    const result = await getResolvedPromptVersion("CYCLIC", "v1", {});

    expect("error" in result).toBe(true);
    const err = result as { error: string };
    expect(err.error).toMatch(/circular/i);
  });
});
