import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { POST, GET } from "@/app/api/swarm/stakgraph/ingest/route";
import { getServerSession } from "next-auth/next";
import { RepositoryStatus } from "@prisma/client";

// Mock dependencies
vi.mock("next-auth/next");
vi.mock("@/lib/db");
vi.mock("@/lib/auth/nextauth");
vi.mock("@/lib/helpers/repository");
vi.mock("@/services/swarm/stakgraph-actions");
vi.mock("@/services/swarm/api/swarm");
vi.mock("@/services/swarm/db");
vi.mock("@/lib/encryption");
vi.mock("@/services/github/WebhookService");

import { db } from "@/lib/db";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { getPrimaryRepository } from "@/lib/helpers/repository";
import { triggerIngestAsync } from "@/services/swarm/stakgraph-actions";
import { swarmApiRequest } from "@/services/swarm/api/swarm";
import { saveOrUpdateSwarm } from "@/services/swarm/db";

const mockSession = { user: { id: "user-123" } };
const mockSwarm = {
  id: "swarm-123",
  name: "test-swarm",
  workspaceId: "workspace-123",
  swarmUrl: "https://test.com",
  swarmApiKey: "encrypted-key"
};
const mockWorkspace = { id: "workspace-123", slug: "test-workspace" };
const mockRepository = { id: "repo-123", repositoryUrl: "https://github.com/user/repo" };
const mockGithubProfile = { username: "user", token: "token" };

describe("POST /api/swarm/stakgraph/ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as Mock).mockResolvedValue(mockSession);
    (db.swarm.findFirst as Mock).mockResolvedValue(mockSwarm);
    (getPrimaryRepository as Mock).mockResolvedValue(mockRepository);
    (db.repository.update as Mock).mockResolvedValue(mockRepository);
    (db.workspace.findUnique as Mock).mockResolvedValue(mockWorkspace);
    (getGithubUsernameAndPAT as Mock).mockResolvedValue(mockGithubProfile);
    (triggerIngestAsync as Mock).mockResolvedValue({ ok: true, status: 200, data: { request_id: "req-123" } });
    (saveOrUpdateSwarm as Mock).mockResolvedValue({});
  });

  test("should return 401 when not authenticated", async () => {
    (getServerSession as Mock).mockResolvedValue(null);

    const request = new NextRequest("http://localhost/api/swarm/stakgraph/ingest", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "workspace-123" })
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  test("should return 404 when swarm not found", async () => {
    (db.swarm.findFirst as Mock).mockResolvedValue(null);

    const request = new NextRequest("http://localhost/api/swarm/stakgraph/ingest", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "workspace-123" })
    });

    const response = await POST(request);
    expect(response.status).toBe(404);
  });

  test("should return 400 when GitHub credentials missing", async () => {
    (getGithubUsernameAndPAT as Mock).mockResolvedValue(null);

    const request = new NextRequest("http://localhost/api/swarm/stakgraph/ingest", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "workspace-123" })
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  test("should successfully trigger ingest", async () => {
    const request = new NextRequest("http://localhost/api/swarm/stakgraph/ingest", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "workspace-123" })
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(db.repository.update).toHaveBeenCalledWith({
      where: {
        repositoryUrl_workspaceId: {
          repositoryUrl: mockRepository.repositoryUrl,
          workspaceId: mockSwarm.workspaceId
        }
      },
      data: { status: RepositoryStatus.PENDING }
    });
    expect(triggerIngestAsync).toHaveBeenCalled();
  });
});

describe("GET /api/swarm/stakgraph/ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as Mock).mockResolvedValue(mockSession);
    (db.swarm.findUnique as Mock).mockResolvedValue(mockSwarm);
    (swarmApiRequest as Mock).mockResolvedValue({ ok: true, status: 200, data: {} });
  });

  test("should return 400 when missing required parameters", async () => {
    const request = new NextRequest("http://localhost/api/swarm/stakgraph/ingest");

    const response = await GET(request);
    expect(response.status).toBe(400);
  });

  test("should return 404 when swarm not found", async () => {
    (db.swarm.findUnique as Mock).mockResolvedValue(null);

    const request = new NextRequest("http://localhost/api/swarm/stakgraph/ingest?id=req-123&workspaceId=workspace-123");

    const response = await GET(request);
    expect(response.status).toBe(404);
  });

  test("should successfully get ingest status", async () => {
    const request = new NextRequest("http://localhost/api/swarm/stakgraph/ingest?id=req-123&workspaceId=workspace-123");

    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(swarmApiRequest).toHaveBeenCalled();
  });
});