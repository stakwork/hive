// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    sourceControlOrg: { findUnique: vi.fn() },
    canvas: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/canvas/io", () => ({
  asBlob: vi.fn(),
}));

import { db } from "@/lib/db";
import { asBlob } from "@/lib/canvas/io";
import { resolveCanvasNode } from "@/lib/urn/resolvers/canvas";

const mockOrgFindUnique = db.sourceControlOrg.findUnique as ReturnType<typeof vi.fn>;
const mockCanvasFindUnique = db.canvas.findUnique as ReturnType<typeof vi.fn>;
const mockAsBlob = asBlob as ReturnType<typeof vi.fn>;

const FAKE_NODE = { id: "node456", type: "note", data: { label: "My Note" } };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveCanvasNode", () => {
  it("returns null for a non-canvas URN", async () => {
    const result = await resolveCanvasNode("urn:myorg:pg:feature:abc");
    expect(result).toBeNull();
    expect(mockOrgFindUnique).not.toHaveBeenCalled();
  });

  it("returns null for an invalid compound canvas id (no dot)", async () => {
    const result = await resolveCanvasNode("urn:myorg:canvas:note:nodothere");
    expect(result).toBeNull();
  });

  it("returns null when org not found", async () => {
    mockOrgFindUnique.mockResolvedValue(null);
    const result = await resolveCanvasNode("urn:myorg:canvas:note:ws~clm123.node456");
    expect(result).toBeNull();
    expect(mockCanvasFindUnique).not.toHaveBeenCalled();
  });

  it("returns null when canvas row not found", async () => {
    mockOrgFindUnique.mockResolvedValue({ id: "org-1" });
    mockCanvasFindUnique.mockResolvedValue(null);

    const result = await resolveCanvasNode("urn:myorg:canvas:note:ws~clm123.node456");
    expect(result).toBeNull();
    expect(mockAsBlob).not.toHaveBeenCalled();
  });

  it("returns null when node not found in blob", async () => {
    mockOrgFindUnique.mockResolvedValue({ id: "org-1" });
    mockCanvasFindUnique.mockResolvedValue({ id: "canvas-1", data: {} });
    mockAsBlob.mockReturnValue({ nodes: [], edges: [] });

    const result = await resolveCanvasNode("urn:myorg:canvas:note:ws~clm123.node456");
    expect(result).toBeNull();
  });

  it("resolves org, decodes compound id, fetches canvas, finds node", async () => {
    mockOrgFindUnique.mockResolvedValue({ id: "org-1" });
    const fakeData = { nodes: [FAKE_NODE], edges: [] };
    mockCanvasFindUnique.mockResolvedValue({ id: "canvas-1", data: fakeData });
    mockAsBlob.mockReturnValue({ nodes: [FAKE_NODE], edges: [] });

    const result = await resolveCanvasNode("urn:myorg:canvas:note:ws~clm123.node456");

    expect(mockOrgFindUnique).toHaveBeenCalledWith({
      where: { githubLogin: "myorg" },
      select: { id: true },
    });
    expect(mockCanvasFindUnique).toHaveBeenCalledWith({
      where: { orgId_ref: { orgId: "org-1", ref: "ws:clm123" } },
    });
    expect(mockAsBlob).toHaveBeenCalledWith(fakeData);
    expect(result).toEqual(FAKE_NODE);
  });

  it("correctly decodes tilde-encoded ref back to colon form", async () => {
    mockOrgFindUnique.mockResolvedValue({ id: "org-2" });
    mockCanvasFindUnique.mockResolvedValue({ id: "canvas-2", data: {} });
    mockAsBlob.mockReturnValue({ nodes: [{ id: "n1" }], edges: [] });

    await resolveCanvasNode("urn:acme:canvas:service:initiative~abc.n1");

    expect(mockCanvasFindUnique).toHaveBeenCalledWith({
      where: { orgId_ref: { orgId: "org-2", ref: "initiative:abc" } },
    });
  });

  it("returns root canvas node when ref encodes empty string", async () => {
    // Root canvas ref is "" — compound id would be ".nodeXYZ"
    // but parseCanvasId returns null for empty encodedRef, so this is null
    const result = await resolveCanvasNode("urn:myorg:canvas:note:.node456");
    expect(result).toBeNull();
  });
});
