import { NextRequest, NextResponse } from "next/server";
import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(),
  requireAuth: vi.fn(),
}));

vi.mock("@/services/workspace", () => ({
  getWorkspaceBySlug: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    swarm: { findFirst: vi.fn() },
  },
}));

vi.mock("@/services/pod-repair-cron", () => ({
  isRepairInProgress: vi.fn(),
  triggerPodRepair: vi.fn(),
}));

vi.mock("@/lib/service-factory", () => ({
  poolManagerService: vi.fn(),
}));

// ── Imports (after mocks) ──────────────────────────────────────────────────

import { POST } from "@/app/api/w/[slug]/pool/repair/route";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceBySlug } from "@/services/workspace";
import { db } from "@/lib/db";
import { isRepairInProgress, triggerPodRepair } from "@/services/pod-repair-cron";
import { poolManagerService } from "@/lib/service-factory";

// ── Test data ─────────────────────────────────────────────────────────────

const MOCK_USER = { id: "user-1", email: "u@test.com", name: "Test" };

const MOCK_WORKSPACE = {
  id: "ws-001",
  slug: "my-workspace",
  userRole: "OWNER",
};

const MOCK_SWARM_BASE = {
  id: "swarm-001",
  poolApiKey: "enc-pool-api-key",
  description: "My project",
};

const MOCK_POD = {
  subdomain: "pod-abc",
  password: "s3cr3t",
  state: "running",
  usage_status: "unused",
};

// ── Helpers ────────────────────────────────────────────────────────────────

function makeRequest(body?: unknown, slug = "my-workspace"): NextRequest {
  return new NextRequest(`http://localhost/api/w/${slug}/pool/repair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function mockParams(slug = "my-workspace") {
  return { params: Promise.resolve({ slug }) };
}

function authenticated() {
  vi.mocked(getMiddlewareContext).mockReturnValue({
    authStatus: "authenticated",
    user: MOCK_USER,
  } as any);
  vi.mocked(requireAuth).mockReturnValue(MOCK_USER as any);
}

function setupPoolManager(pods = [MOCK_POD]) {
  vi.mocked(poolManagerService).mockReturnValue({
    getPoolWorkspaces: vi.fn().mockResolvedValue({ workspaces: pods }),
  } as any);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("POST /api/w/[slug]/pool/repair", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticated();
    vi.mocked(getWorkspaceBySlug).mockResolvedValue(MOCK_WORKSPACE as any);
    vi.mocked(isRepairInProgress).mockResolvedValue(false);
    vi.mocked(triggerPodRepair).mockResolvedValue({ runId: "run-001", projectId: 123 });
    setupPoolManager();
  });

  describe("swarmUrl and swarmSecretAlias forwarding", () => {
    it("passes swarmUrl and swarmSecretAlias to triggerPodRepair when swarm has them", async () => {
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        ...MOCK_SWARM_BASE,
        swarmUrl: "https://swarm.example.com",
        swarmSecretAlias: "my-secret-alias",
      } as any);

      const res = await POST(makeRequest({}), mockParams());

      expect(res.status).toBe(200);
      expect(triggerPodRepair).toHaveBeenCalledWith(
        MOCK_WORKSPACE.id,
        "my-workspace",
        MOCK_POD.subdomain,
        MOCK_POD.password,
        [],
        undefined,
        MOCK_SWARM_BASE.description,
        "https://swarm.example.com",
        "my-secret-alias"
      );
    });

    it("passes null for swarmUrl and swarmSecretAlias when swarm has neither", async () => {
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        ...MOCK_SWARM_BASE,
        swarmUrl: null,
        swarmSecretAlias: null,
      } as any);

      const res = await POST(makeRequest({}), mockParams());

      expect(res.status).toBe(200);
      expect(triggerPodRepair).toHaveBeenCalledWith(
        MOCK_WORKSPACE.id,
        "my-workspace",
        MOCK_POD.subdomain,
        MOCK_POD.password,
        [],
        undefined,
        MOCK_SWARM_BASE.description,
        null,
        null
      );
    });

    it("passes message from request body when provided", async () => {
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        ...MOCK_SWARM_BASE,
        swarmUrl: "https://swarm.example.com",
        swarmSecretAlias: "alias",
      } as any);

      const res = await POST(makeRequest({ message: "fix the backend" }), mockParams());

      expect(res.status).toBe(200);
      expect(triggerPodRepair).toHaveBeenCalledWith(
        MOCK_WORKSPACE.id,
        "my-workspace",
        MOCK_POD.subdomain,
        MOCK_POD.password,
        [],
        "fix the backend",
        MOCK_SWARM_BASE.description,
        "https://swarm.example.com",
        "alias"
      );
    });
  });

  describe("guard checks", () => {
    it("returns 409 when a repair is already in progress", async () => {
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        ...MOCK_SWARM_BASE,
        swarmUrl: null,
        swarmSecretAlias: null,
      } as any);
      vi.mocked(isRepairInProgress).mockResolvedValue(true);

      const res = await POST(makeRequest({}), mockParams());

      expect(res.status).toBe(409);
      expect(triggerPodRepair).not.toHaveBeenCalled();
    });

    it("returns 403 for non-admin/owner roles", async () => {
      vi.mocked(getWorkspaceBySlug).mockResolvedValue({
        ...MOCK_WORKSPACE,
        userRole: "DEVELOPER",
      } as any);

      const res = await POST(makeRequest({}), mockParams());

      expect(res.status).toBe(403);
      expect(triggerPodRepair).not.toHaveBeenCalled();
    });

    it("returns 404 when swarm has no poolApiKey", async () => {
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        ...MOCK_SWARM_BASE,
        poolApiKey: null,
        swarmUrl: null,
        swarmSecretAlias: null,
      } as any);

      const res = await POST(makeRequest({}), mockParams());

      expect(res.status).toBe(404);
      expect(triggerPodRepair).not.toHaveBeenCalled();
    });

    it("returns 404 when no pods are available", async () => {
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        ...MOCK_SWARM_BASE,
        swarmUrl: null,
        swarmSecretAlias: null,
      } as any);
      setupPoolManager([]); // no pods

      const res = await POST(makeRequest({}), mockParams());

      expect(res.status).toBe(404);
      expect(triggerPodRepair).not.toHaveBeenCalled();
    });
  });

  describe("success response", () => {
    it("returns runId and projectId on success", async () => {
      vi.mocked(db.swarm.findFirst).mockResolvedValue({
        ...MOCK_SWARM_BASE,
        swarmUrl: "https://swarm.example.com",
        swarmSecretAlias: "alias",
      } as any);

      const res = await POST(makeRequest({}), mockParams());
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body).toEqual({ success: true, runId: "run-001", projectId: 123 });
    });
  });
});
