// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    urnEdge: {
      create: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";
import { createEdge, listEdges, deleteEdge, neighborsOf } from "@/lib/urn/edges";

const mockCreate = db.urnEdge.create as ReturnType<typeof vi.fn>;
const mockFindMany = db.urnEdge.findMany as ReturnType<typeof vi.fn>;
const mockDelete = db.urnEdge.delete as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createEdge", () => {
  it("calls db.urnEdge.create with correct data", async () => {
    const fakeEdge = { id: "e1", orgId: "org-1", fromUrn: "urn:a:pg:feature:1", toUrn: "urn:a:pg:task:2", type: "HAS_TASK", createdAt: new Date() };
    mockCreate.mockResolvedValue(fakeEdge);

    const result = await createEdge("org-1", "urn:a:pg:feature:1", "urn:a:pg:task:2", "HAS_TASK");

    expect(mockCreate).toHaveBeenCalledWith({
      data: { orgId: "org-1", fromUrn: "urn:a:pg:feature:1", toUrn: "urn:a:pg:task:2", type: "HAS_TASK" },
    });
    expect(result).toEqual(fakeEdge);
  });
});

describe("listEdges", () => {
  it("lists edges by orgId without filter", async () => {
    mockFindMany.mockResolvedValue([]);
    await listEdges("org-1");
    expect(mockFindMany).toHaveBeenCalledWith({ where: { orgId: "org-1" } });
  });

  it("lists edges filtered by fromUrn", async () => {
    mockFindMany.mockResolvedValue([]);
    await listEdges("org-1", { fromUrn: "urn:a:pg:feature:1" });
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { orgId: "org-1", fromUrn: "urn:a:pg:feature:1" },
    });
  });

  it("lists edges filtered by toUrn", async () => {
    mockFindMany.mockResolvedValue([]);
    await listEdges("org-1", { toUrn: "urn:a:pg:task:2" });
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { orgId: "org-1", toUrn: "urn:a:pg:task:2" },
    });
  });

  it("lists edges filtered by type", async () => {
    mockFindMany.mockResolvedValue([]);
    await listEdges("org-1", { type: "HAS_TASK" });
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { orgId: "org-1", type: "HAS_TASK" },
    });
  });
});

describe("deleteEdge", () => {
  it("calls db.urnEdge.delete with the correct id", async () => {
    mockDelete.mockResolvedValue({});
    await deleteEdge("edge-1");
    expect(mockDelete).toHaveBeenCalledWith({ where: { id: "edge-1" } });
  });
});

describe("neighborsOf", () => {
  const SOURCE_URN = "urn:myorg:pg:feature:f1";

  it("queries both fromUrn and toUrn directions", async () => {
    mockFindMany.mockResolvedValue([]);
    await neighborsOf(SOURCE_URN);
    expect(mockFindMany).toHaveBeenCalledTimes(2);
    expect(mockFindMany).toHaveBeenCalledWith({ where: { fromUrn: SOURCE_URN } });
    expect(mockFindMany).toHaveBeenCalledWith({ where: { toUrn: SOURCE_URN } });
  });

  it("returns forward neighbors with direction 'forward'", async () => {
    mockFindMany
      .mockResolvedValueOnce([
        { id: "e1", fromUrn: SOURCE_URN, toUrn: "urn:myorg:pg:task:t1", type: "HAS_TASK", orgId: "org-1", createdAt: new Date() },
      ])
      .mockResolvedValueOnce([]);

    const results = await neighborsOf(SOURCE_URN);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ urn: "urn:myorg:pg:task:t1", edgeType: "HAS_TASK", direction: "forward" });
  });

  it("returns reverse neighbors with direction 'reverse'", async () => {
    mockFindMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "e2", fromUrn: "urn:myorg:pg:initiative:i1", toUrn: SOURCE_URN, type: "HAS_FEATURE", orgId: "org-1", createdAt: new Date() },
      ]);

    const results = await neighborsOf(SOURCE_URN);

    expect(results).toHaveLength(1);
    expect(results[0]).toEqual({ urn: "urn:myorg:pg:initiative:i1", edgeType: "HAS_FEATURE", direction: "reverse" });
  });

  it("deduplicates when same URN appears in both forward and reverse", async () => {
    const DUPE_URN = "urn:myorg:pg:feature:f2";
    mockFindMany
      .mockResolvedValueOnce([
        { id: "e1", fromUrn: SOURCE_URN, toUrn: DUPE_URN, type: "DEPENDS_ON_FEATURE", orgId: "org-1", createdAt: new Date() },
      ])
      .mockResolvedValueOnce([
        { id: "e2", fromUrn: DUPE_URN, toUrn: SOURCE_URN, type: "DEPENDS_ON_FEATURE", orgId: "org-1", createdAt: new Date() },
      ]);

    const results = await neighborsOf(SOURCE_URN);

    const dupeCount = results.filter((r) => r.urn === DUPE_URN).length;
    expect(dupeCount).toBe(1);
    // First occurrence (forward) wins
    expect(results.find((r) => r.urn === DUPE_URN)?.direction).toBe("forward");
  });

  it("returns empty array when no edges exist", async () => {
    mockFindMany.mockResolvedValue([]);
    const results = await neighborsOf(SOURCE_URN);
    expect(results).toHaveLength(0);
  });

  it("combines forward and reverse results without duplicates", async () => {
    mockFindMany
      .mockResolvedValueOnce([
        { id: "e1", fromUrn: SOURCE_URN, toUrn: "urn:myorg:pg:task:t1", type: "HAS_TASK", orgId: "org-1", createdAt: new Date() },
        { id: "e2", fromUrn: SOURCE_URN, toUrn: "urn:myorg:pg:task:t2", type: "HAS_TASK", orgId: "org-1", createdAt: new Date() },
      ])
      .mockResolvedValueOnce([
        { id: "e3", fromUrn: "urn:myorg:pg:initiative:i1", toUrn: SOURCE_URN, type: "HAS_FEATURE", orgId: "org-1", createdAt: new Date() },
      ]);

    const results = await neighborsOf(SOURCE_URN);

    expect(results).toHaveLength(3);
    const urns = results.map((r) => r.urn);
    expect(urns).toContain("urn:myorg:pg:task:t1");
    expect(urns).toContain("urn:myorg:pg:task:t2");
    expect(urns).toContain("urn:myorg:pg:initiative:i1");
  });
});
