import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST, GET } from "@/app/api/swarm/stakgraph/ingest/route";
import { auth } from "@/lib/auth/auth";
import { RepositoryStatus } from "@prisma/client";

// Mock dependencies
vi.mock("@/lib/auth/auth", () => ({
  auth: vi.fn(),
}));
    vi.mocked(saveOrUpdateSwarm).mockResolvedValue({});
  });

  test("should return 401 when not authenticated", async () => {
    vi.mocked(auth).mockResolvedValue(null);

    const request = new NextRequest("http://localhost/api/swarm/stakgraph/ingest", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "workspace-123" })
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  test("should return 404 when swarm not found", async () => {
    vi.mocked(db.swarm.findFirst).mockResolvedValue(null);

    const request = new NextRequest("http://localhost/api/swarm/stakgraph/ingest", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "workspace-123" })
    });

    const response = await POST(request);
    expect(response.status).toBe(404);
  });

  test("should return 400 when GitHub credentials missing", async () => {
    vi.mocked(getGithubUsernameAndPAT).mockResolvedValue(null);

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
    vi.mocked(auth).mockResolvedValue(mockSession);
    vi.mocked(db.swarm.findUnique).mockResolvedValue(mockSwarm);
    vi.mocked(swarmApiRequest).mockResolvedValue({ ok: true, status: 200, data: {} });
  });

  test("should return 400 when missing required parameters", async () => {
    const request = new NextRequest("http://localhost/api/swarm/stakgraph/ingest");

    const response = await GET(request);
    expect(response.status).toBe(400);
  });

  test("should return 404 when swarm not found", async () => {
    vi.mocked(db.swarm.findUnique).mockResolvedValue(null);

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