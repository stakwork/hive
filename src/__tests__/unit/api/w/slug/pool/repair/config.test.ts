import { NextRequest } from "next/server";
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/db", () => ({
  db: {
    swarm: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccess: vi.fn(),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────

import { GET, PUT } from "@/app/api/w/[slug]/pool/repair/config/route";
import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";
import { validateWorkspaceAccess } from "@/services/workspace";

// ── Test data ──────────────────────────────────────────────────────────────

const MOCK_USER = { id: "user-1", email: "u@test.com", name: "Test" };
const MOCK_WORKSPACE = { id: "ws-001", slug: "my-workspace" };
const MOCK_SWARM = { id: "swarm-001", repairAgentDisabled: false };

// ── Helpers ────────────────────────────────────────────────────────────────

function makeGetRequest(slug = "my-workspace") {
  return new NextRequest(`http://localhost/api/w/${slug}/pool/repair/config`, {
    method: "GET",
  });
}

function makePutRequest(body: unknown, slug = "my-workspace") {
  return new NextRequest(`http://localhost/api/w/${slug}/pool/repair/config`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function mockParams(slug = "my-workspace") {
  return { params: Promise.resolve({ slug }) };
}

function authenticated() {
  vi.mocked(getServerSession).mockResolvedValue({ user: MOCK_USER } as any);
}

function unauthenticated() {
  vi.mocked(getServerSession).mockResolvedValue(null);
}

function workspaceFound(overrides: Record<string, unknown> = {}) {
  vi.mocked(validateWorkspaceAccess).mockResolvedValue({
    hasAccess: true,
    workspace: MOCK_WORKSPACE,
    canWrite: true,
    ...overrides,
  } as any);
}

function workspaceNotFound() {
  vi.mocked(validateWorkspaceAccess).mockResolvedValue({
    hasAccess: false,
    workspace: null,
    canWrite: false,
  } as any);
}

// ── GET tests ──────────────────────────────────────────────────────────────

describe("GET /api/w/[slug]/pool/repair/config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    unauthenticated();

    const res = await GET(makeGetRequest(), mockParams());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 404 when workspace not found", async () => {
    authenticated();
    workspaceNotFound();

    const res = await GET(makeGetRequest(), mockParams());
    expect(res.status).toBe(404);
  });

  it("returns repairAgentDisabled: false for a valid swarm", async () => {
    authenticated();
    workspaceFound();
    vi.mocked(db.swarm.findUnique).mockResolvedValue(MOCK_SWARM as any);

    const res = await GET(makeGetRequest(), mockParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config).toEqual({ repairAgentDisabled: false });
  });

  it("returns repairAgentDisabled: false when no swarm exists", async () => {
    authenticated();
    workspaceFound();
    vi.mocked(db.swarm.findUnique).mockResolvedValue(null);

    const res = await GET(makeGetRequest(), mockParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config).toEqual({ repairAgentDisabled: false });
  });

  it("returns repairAgentDisabled: true when flag is set", async () => {
    authenticated();
    workspaceFound();
    vi.mocked(db.swarm.findUnique).mockResolvedValue({
      ...MOCK_SWARM,
      repairAgentDisabled: true,
    } as any);

    const res = await GET(makeGetRequest(), mockParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config).toEqual({ repairAgentDisabled: true });
  });
});

// ── PUT tests ──────────────────────────────────────────────────────────────

describe("PUT /api/w/[slug]/pool/repair/config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when unauthenticated", async () => {
    unauthenticated();

    const res = await PUT(makePutRequest({ repairAgentDisabled: true }), mockParams());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 404 when workspace not found", async () => {
    authenticated();
    workspaceNotFound();

    const res = await PUT(makePutRequest({ repairAgentDisabled: true }), mockParams());
    expect(res.status).toBe(404);
  });

  it("returns 403 when user lacks write permission", async () => {
    authenticated();
    workspaceFound({ canWrite: false });

    const res = await PUT(makePutRequest({ repairAgentDisabled: true }), mockParams());
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("Insufficient permissions");
  });

  it("returns 400 for invalid payload (non-boolean)", async () => {
    authenticated();
    workspaceFound();

    const res = await PUT(makePutRequest({ repairAgentDisabled: "yes" }), mockParams());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Validation failed");
  });

  it("returns 400 for missing payload field", async () => {
    authenticated();
    workspaceFound();

    const res = await PUT(makePutRequest({}), mockParams());
    expect(res.status).toBe(400);
  });

  it("toggles repairAgentDisabled to true and returns updated config", async () => {
    authenticated();
    workspaceFound();
    vi.mocked(db.swarm.findUnique).mockResolvedValue(MOCK_SWARM as any);
    vi.mocked(db.swarm.update).mockResolvedValue({
      ...MOCK_SWARM,
      repairAgentDisabled: true,
    } as any);

    const res = await PUT(makePutRequest({ repairAgentDisabled: true }), mockParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.config).toEqual({ repairAgentDisabled: true });

    expect(vi.mocked(db.swarm.update)).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: MOCK_SWARM.id },
        data: { repairAgentDisabled: true },
      })
    );
  });

  it("toggles repairAgentDisabled back to false", async () => {
    authenticated();
    workspaceFound();
    vi.mocked(db.swarm.findUnique).mockResolvedValue({
      ...MOCK_SWARM,
      repairAgentDisabled: true,
    } as any);
    vi.mocked(db.swarm.update).mockResolvedValue({
      ...MOCK_SWARM,
      repairAgentDisabled: false,
    } as any);

    const res = await PUT(makePutRequest({ repairAgentDisabled: false }), mockParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.config).toEqual({ repairAgentDisabled: false });
  });

  it("returns 404 when swarm not configured for workspace", async () => {
    authenticated();
    workspaceFound();
    vi.mocked(db.swarm.findUnique).mockResolvedValue(null);

    const res = await PUT(makePutRequest({ repairAgentDisabled: true }), mockParams());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Swarm not configured for this workspace");
  });
});
