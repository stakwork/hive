import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { POST, GET } from "@/app/api/swarm/stakgraph/ingest/route";
import { getServerSession } from "next-auth/next";
import { RepositoryStatus } from "@prisma/client";

// Mock dependencies
vi.mock("next-auth/next");
vi.mock("@/lib/db", () => ({
  db: {
    swarm: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    repository: {
      update: vi.fn(),
    },
    workspace: {
      findUnique: vi.fn(),
    },
  },
}));
vi.mock("@/lib/auth/nextauth");
vi.mock("@/lib/helpers/repository");
vi.mock("@/services/swarm/stakgraph-actions");
vi.mock("@/services/swarm/api/swarm");
vi.mock("@/services/swarm/db");
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn(() => "decrypted-key"),
    })),
  },
}));
vi.mock("@/services/github/WebhookService", () => ({
  WebhookService: vi.fn().mockImplementation(() => ({
    ensureRepoWebhook: vi.fn().mockResolvedValue({ id: 123, secret: "webhook-secret" }),
  })),
}));
vi.mock("@/config/services", () => ({
  getServiceConfig: vi.fn(() => ({
    baseURL: "https://github.com",
    apiKey: "test-api-key",
    timeout: 30000,
  })),
}));
vi.mock("@/lib/constants", () => ({
  getSwarmVanityAddress: vi.fn((name: string) => `${name}.sphinx.chat`),
}));
vi.mock("@/lib/url", () => ({
  getGithubWebhookCallbackUrl: vi.fn(() => "https://app.example.com/api/github/webhook"),
  getStakgraphWebhookCallbackUrl: vi.fn(() => "https://app.example.com/api/swarm/stakgraph/webhook"),
}));

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
  swarmApiKey: "encrypted-key",
  ingestRequestInProgress: false,
  status: "ACTIVE" as const,
  swarmId: "external-swarm-id",
  createdAt: new Date(),
  updatedAt: new Date(),
  poolApiKey: null,
  poolState: "NOT_STARTED" as const,
  poolName: null,
  poolCpu: null,
  poolMemory: null,
  swarmSecretAlias: null,
  environmentVariables: [],
  services: [],
  ingestRefId: null,
  containerFiles: null,
  containerFilesSetUp: false,
  agentRequestId: null,
  agentStatus: null,
  swarmPassword: null,
  instanceType: "XL",
  ec2Id: null
};
const mockWorkspace = {
  id: "workspace-123",
  slug: "test-workspace",
  name: "Test Workspace",
  description: null,
  mission: null,
  deleted: false,
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ownerId: "user-123",
  originalSlug: null,
  sourceControlOrgId: null,
  stakworkApiKey: null,
  repositoryDraft: null,
  logoUrl: null,
  logoKey: null
};
const mockRepository = {
  id: "repo-123",
  repositoryUrl: "https://github.com/user/repo",
  name: "test-repo",
  description: null,
  workspaceId: "workspace-123",
  status: "PENDING" as const,
  branch: "main",
  createdAt: new Date(),
  updatedAt: new Date(),
  githubWebhookId: null,
  githubWebhookSecret: null,
  testingFrameworkSetup: false,
  playwrightSetup: false,
  ignoreDirs: "",
  unitGlob: "",
  integrationGlob: "",
  e2eGlob: ""
};
const mockGithubProfile = { username: "user", token: "token" };

describe("POST /api/swarm/stakgraph/ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
    vi.mocked(db.swarm.findFirst).mockResolvedValue(mockSwarm);
    vi.mocked(db.swarm.update).mockResolvedValue(mockSwarm);
    vi.mocked(getPrimaryRepository).mockResolvedValue(mockRepository);
    vi.mocked(db.repository.update).mockResolvedValue(mockRepository);
    vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspace);
    vi.mocked(getGithubUsernameAndPAT).mockResolvedValue(mockGithubProfile);
    vi.mocked(triggerIngestAsync).mockResolvedValue({ ok: true, status: 200, data: { request_id: "req-123" } });
    vi.mocked(saveOrUpdateSwarm).mockResolvedValue(mockSwarm as any);
  });

  test("should return 401 when not authenticated", async () => {
    vi.mocked(getServerSession).mockResolvedValue(null);

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

  test("should return 409 when ingest request already in progress", async () => {
    vi.mocked(db.swarm.findFirst).mockResolvedValue({
      ...mockSwarm,
      ingestRequestInProgress: true
    });

    const request = new NextRequest("http://localhost/api/swarm/stakgraph/ingest", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "workspace-123" })
    });

    const response = await POST(request);
    expect(response.status).toBe(409);

    const responseData = await response.json();
    expect(responseData.success).toBe(false);
    expect(responseData.message).toBe("Ingest request already in progress for this swarm");
  });

  test("should successfully trigger ingest", async () => {
    const request = new NextRequest("http://localhost/api/swarm/stakgraph/ingest", {
      method: "POST",
      body: JSON.stringify({ workspaceId: "workspace-123" })
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(triggerIngestAsync).toHaveBeenCalled();

    // Verify repository status is updated to PENDING
    expect(db.repository.update).toHaveBeenCalledWith({
      where: {
        repositoryUrl_workspaceId: {
          repositoryUrl: mockRepository.repositoryUrl,
          workspaceId: mockSwarm.workspaceId
        }
      },
      data: { status: RepositoryStatus.PENDING }
    });

    // Verify saveOrUpdateSwarm is called to set and reset the flag
    expect(saveOrUpdateSwarm).toHaveBeenCalledWith({
      workspaceId: mockSwarm.workspaceId,
      ingestRequestInProgress: true,
    });
    expect(saveOrUpdateSwarm).toHaveBeenCalledWith({
      workspaceId: mockSwarm.workspaceId,
      ingestRequestInProgress: false,
    });
  });
});

describe("GET /api/swarm/stakgraph/ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getServerSession).mockResolvedValue(mockSession);
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