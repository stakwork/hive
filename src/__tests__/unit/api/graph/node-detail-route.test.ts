/**
 * Unit tests for GET /api/workspaces/[slug]/graph/node/[ref_id].
 *
 * The Jarvis call itself is owned by kg-adapter (covered in
 * unit/lib/ai/kg-adapter.test.ts), so this stays on the route's own
 * responsibilities: the admin gate, swarm resolution, and the response shape
 * the node panel consumes.
 */

import { describe, test, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccess: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    workspace: { findFirst: vi.fn() },
    swarm: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: () => ({ decryptField: () => "decrypted-key" }),
  },
}));

vi.mock("@/lib/ai/kg-adapter", () => ({
  kgGetNeighbors: vi.fn(),
  kgGetNode: vi.fn(),
}));

import { GET } from "@/app/api/workspaces/[slug]/graph/node/[ref_id]/route";
import { getServerSession } from "next-auth/next";
import { validateWorkspaceAccess } from "@/services/workspace";
import { db } from "@/lib/db";
import { kgGetNeighbors, kgGetNode } from "@/lib/ai/kg-adapter";

function makeRequest(query: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/workspaces/ws/graph/node/ref-1");
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url.toString());
}

const params = Promise.resolve({ slug: "ws", ref_id: "ref-1" });

function grantAccess({ canAdmin = true } = {}) {
  (getServerSession as Mock).mockResolvedValue({ user: { id: "user-1" } });
  (validateWorkspaceAccess as Mock).mockResolvedValue({ hasAccess: true, canAdmin });
  (db.workspace.findFirst as Mock).mockResolvedValue({ id: "ws-1" });
  (db.swarm.findUnique as Mock).mockResolvedValue({
    name: "swarm-x",
    swarmApiKey: "encrypted",
  });
}

describe("GET /api/workspaces/[slug]/graph/node/[ref_id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.USE_MOCKS;
  });

  test("returns 401 when unauthenticated", async () => {
    (getServerSession as Mock).mockResolvedValue(null);

    const res = await GET(makeRequest(), { params });

    expect(res.status).toBe(401);
    expect(kgGetNeighbors).not.toHaveBeenCalled();
  });

  test("returns 404 when the user has no workspace access", async () => {
    (getServerSession as Mock).mockResolvedValue({ user: { id: "user-1" } });
    (validateWorkspaceAccess as Mock).mockResolvedValue({ hasAccess: false });

    const res = await GET(makeRequest(), { params });

    expect(res.status).toBe(404);
    expect(kgGetNeighbors).not.toHaveBeenCalled();
  });

  test("returns 403 for non-admin members", async () => {
    grantAccess({ canAdmin: false });

    const res = await GET(makeRequest(), { params });

    expect(res.status).toBe(403);
    expect(kgGetNeighbors).not.toHaveBeenCalled();
  });

  test("returns 400 when the workspace has no swarm", async () => {
    grantAccess();
    (db.swarm.findUnique as Mock).mockResolvedValue(null);

    const res = await GET(makeRequest(), { params });

    expect(res.status).toBe(400);
  });

  test("maps the node and its neighbors onto the panel's shape", async () => {
    grantAccess();
    (kgGetNeighbors as Mock).mockResolvedValue({
      reachable: true,
      root: {
        ref_id: "ref-1",
        node_type: "Concept",
        name: "Auth Flow",
        properties: { name: "Auth Flow", description: "How login works" },
      },
      neighbors: [
        {
          urn: "",
          ref_id: "ref-2",
          node_type: "File",
          name: "auth.ts",
          edgeType: "DESCRIBES",
          direction: "forward",
          importance: 0.8,
        },
        {
          urn: "",
          ref_id: "ref-3",
          node_type: "Function",
          name: "login",
          edgeType: "CALLS",
          direction: "reverse",
        },
      ],
    });

    const res = await GET(makeRequest(), { params });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      node: {
        ref_id: "ref-1",
        node_type: "Concept",
        name: "Auth Flow",
        properties: { name: "Auth Flow", description: "How login works" },
      },
      neighbors: [
        {
          ref_id: "ref-2",
          node_type: "File",
          name: "auth.ts",
          edge_type: "DESCRIBES",
          direction: "forward",
          importance: 0.8,
        },
        {
          ref_id: "ref-3",
          node_type: "Function",
          name: "login",
          edge_type: "CALLS",
          direction: "reverse",
        },
      ],
    });

    // Jarvis is addressed at the KG port, and the root rides along with the
    // neighbors in one call.
    expect(kgGetNeighbors).toHaveBeenCalledWith(
      "https://swarm-x.sphinx.chat:8444",
      "decrypted-key",
      "ref-1",
      { includeRoot: true },
    );
  });

  test("returns 502 when Jarvis is unreachable", async () => {
    grantAccess();
    (kgGetNeighbors as Mock).mockResolvedValue({ neighbors: [], reachable: false });

    const res = await GET(makeRequest(), { params });

    expect(res.status).toBe(502);
  });

  test("returns 404 when the node is not in the graph", async () => {
    grantAccess();
    (kgGetNeighbors as Mock).mockResolvedValue({ neighbors: [], reachable: true });

    const res = await GET(makeRequest(), { params });

    expect(res.status).toBe(404);
    // No filter was applied, so there's nothing to second-guess.
    expect(kgGetNode).not.toHaveBeenCalled();
  });

  test("passes the neighbor-type filter through to Jarvis", async () => {
    grantAccess();
    (kgGetNeighbors as Mock).mockResolvedValue({
      reachable: true,
      root: { ref_id: "ref-1", node_type: "Concept", name: "A", properties: {} },
      neighbors: [],
    });

    await GET(makeRequest({ types: "Concept, ,File" }), { params });

    expect((kgGetNeighbors as Mock).mock.calls[0][3]).toEqual({
      includeRoot: true,
      nodeTypes: ["Concept", "File"],
    });
  });

  test("still resolves the node when a type filter matches no neighbors", async () => {
    grantAccess();
    // A narrow enough filter can drop the queried node from the payload too.
    (kgGetNeighbors as Mock).mockResolvedValue({ neighbors: [], reachable: true });
    (kgGetNode as Mock).mockResolvedValue({
      ref_id: "ref-1",
      node_type: "Concept",
      name: "Auth Flow",
      properties: { name: "Auth Flow" },
    });

    const res = await GET(makeRequest({ types: "Datamodel" }), { params });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      node: {
        ref_id: "ref-1",
        node_type: "Concept",
        name: "Auth Flow",
        properties: { name: "Auth Flow" },
      },
      neighbors: [],
    });
  });

  test("returns 404 when the filtered fallback also finds nothing", async () => {
    grantAccess();
    (kgGetNeighbors as Mock).mockResolvedValue({ neighbors: [], reachable: true });
    (kgGetNode as Mock).mockResolvedValue(null);

    const res = await GET(makeRequest({ types: "Datamodel" }), { params });

    expect(res.status).toBe(404);
  });
});
