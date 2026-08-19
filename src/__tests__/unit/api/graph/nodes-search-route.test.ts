/**
 * Unit tests for the Jarvis-backed search + ontology routes:
 *   GET /api/workspaces/[slug]/graph/nodes/search
 *   GET /api/workspaces/[slug]/graph/node-types
 *
 * The Jarvis HTTP calls belong to kg-adapter (covered separately); these tests
 * own the routes' own logic — the shared access gate, param parsing, and the
 * response shapes the search UI consumes.
 */

import { describe, test, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/helpers/graph-jarvis", () => ({
  resolveJarvisAccess: vi.fn(),
}));

vi.mock("@/lib/ai/kg-adapter", () => ({
  kgSearch: vi.fn(),
  kgGetOntology: vi.fn(),
}));

import { GET as searchGET } from "@/app/api/workspaces/[slug]/graph/nodes/search/route";
import { GET as typesGET } from "@/app/api/workspaces/[slug]/graph/node-types/route";
import { resolveJarvisAccess } from "@/lib/helpers/graph-jarvis";
import { kgSearch, kgGetOntology } from "@/lib/ai/kg-adapter";

const params = Promise.resolve({ slug: "ws" });

function searchRequest(query: Record<string, string>) {
  const url = new URL("http://localhost/api/workspaces/ws/graph/nodes/search");
  Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url.toString());
}

function grantAccess() {
  (resolveJarvisAccess as Mock).mockResolvedValue({
    jarvisUrl: "https://swarm-x.sphinx.chat:8444",
    apiKey: "decrypted-key",
  });
}

describe("GET /api/workspaces/[slug]/graph/nodes/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.USE_MOCKS;
    (kgSearch as Mock).mockResolvedValue([]);
  });

  test("propagates the access gate's response", async () => {
    (resolveJarvisAccess as Mock).mockResolvedValue(
      NextResponse.json({ success: false, message: "Forbidden" }, { status: 403 }),
    );

    const res = await searchGET(searchRequest({ q: "auth" }), { params });

    expect(res.status).toBe(403);
    expect(kgSearch).not.toHaveBeenCalled();
  });

  test("returns 400 when q is missing or blank", async () => {
    grantAccess();

    expect((await searchGET(searchRequest({}), { params })).status).toBe(400);
    expect((await searchGET(searchRequest({ q: "   " }), { params })).status).toBe(400);
    expect(kgSearch).not.toHaveBeenCalled();
  });

  test("passes the type filter through and maps hits", async () => {
    grantAccess();
    (kgSearch as Mock).mockResolvedValue([
      {
        ref_id: "ref-1",
        node_type: "Concept",
        name: "Auth Flow",
        description: "How login works",
        edges: { DESCRIBES: 3 },
      },
    ]);

    const res = await searchGET(
      searchRequest({ q: "auth", types: "Concept,Function" }),
      { params },
    );

    expect(res.status).toBe(200);
    // `edges` is dropped — the search list doesn't render connectivity.
    expect(await res.json()).toEqual({
      results: [
        {
          ref_id: "ref-1",
          node_type: "Concept",
          name: "Auth Flow",
          description: "How login works",
        },
      ],
    });

    expect(kgSearch).toHaveBeenCalledWith(
      "https://swarm-x.sphinx.chat:8444",
      "decrypted-key",
      "auth",
      { limit: 25, type: "Concept,Function" },
    );
  });

  test("omits the type filter entirely when no types are given", async () => {
    grantAccess();

    await searchGET(searchRequest({ q: "auth" }), { params });

    expect(kgSearch).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      "auth",
      { limit: 25 },
    );
  });

  test("drops blank entries from the types list", async () => {
    grantAccess();

    await searchGET(searchRequest({ q: "auth", types: "Concept, ,," }), { params });

    expect((kgSearch as Mock).mock.calls[0][3]).toEqual({ limit: 25, type: "Concept" });
  });

  test("clamps the limit to the maximum", async () => {
    grantAccess();

    await searchGET(searchRequest({ q: "auth", limit: "5000" }), { params });

    expect((kgSearch as Mock).mock.calls[0][3]).toEqual({ limit: 50 });
  });

  test("falls back to the default limit for junk values", async () => {
    grantAccess();

    await searchGET(searchRequest({ q: "auth", limit: "-3" }), { params });
    await searchGET(searchRequest({ q: "auth", limit: "abc" }), { params });

    expect((kgSearch as Mock).mock.calls[0][3]).toEqual({ limit: 25 });
    expect((kgSearch as Mock).mock.calls[1][3]).toEqual({ limit: 25 });
  });
});

describe("GET /api/workspaces/[slug]/graph/node-types", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.USE_MOCKS;
  });

  test("propagates the access gate's response", async () => {
    (resolveJarvisAccess as Mock).mockResolvedValue(
      NextResponse.json({ success: false, message: "Unauthorized" }, { status: 401 }),
    );

    const res = await typesGET(new NextRequest("http://localhost/x"), { params });

    expect(res.status).toBe(401);
    expect(kgGetOntology).not.toHaveBeenCalled();
  });

  test("returns the ontology's node types", async () => {
    grantAccess();
    (kgGetOntology as Mock).mockResolvedValue({
      domains: ["code", "knowledge"],
      node_types: [
        { type: "Concept", domain: "knowledge", description: "An idea." },
        { type: "File", domain: "code", description: "A file." },
      ],
    });

    const res = await typesGET(new NextRequest("http://localhost/x"), { params });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      node_types: [
        { type: "Concept", domain: "knowledge", description: "An idea." },
        { type: "File", domain: "code", description: "A file." },
      ],
    });
  });

  test("returns an empty list when the ontology is unavailable", async () => {
    grantAccess();
    (kgGetOntology as Mock).mockResolvedValue({ domains: [], node_types: [] });

    const res = await typesGET(new NextRequest("http://localhost/x"), { params });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ node_types: [] });
  });
});
