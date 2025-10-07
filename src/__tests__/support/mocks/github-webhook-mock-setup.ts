import { vi, type Mock } from "vitest";
import { RepositoryStatus } from "@prisma/client";
import { GitHubWebhookTestData } from "../fixtures/github-webhook-test-data";

// Mock Setup Helpers
export const GitHubWebhookMockSetup = {
  createMockInstances: () => {
    // Import mocked modules - these need to be available in the test file
    const { db } = require("@/lib/db");
    const { computeHmacSha256Hex, timingSafeEqual } = require("@/lib/encryption");
    const { triggerAsyncSync } = require("@/services/swarm/stakgraph-actions");
    const { getGithubUsernameAndPAT } = require("@/lib/auth/nextauth");

    return {
      mockDbRepositoryFindFirst: db.repository.findFirst as Mock,
      mockDbRepositoryUpdate: db.repository.update as Mock,
      mockDbSwarmFindUnique: db.swarm.findUnique as Mock,
      mockDbSwarmUpdate: db.swarm.update as Mock,
      mockDbWorkspaceFindUnique: db.workspace.findUnique as Mock,
      mockComputeHmac: computeHmacSha256Hex as Mock,
      mockTimingSafeEqual: timingSafeEqual as Mock,
      mockTriggerAsyncSync: triggerAsyncSync as Mock,
      mockGetGithubUsernameAndPAT: getGithubUsernameAndPAT as Mock,
    };
  },

  reset: () => {
    vi.clearAllMocks();
  },

  setupSuccessfulWebhookProcessing: () => {
    const mocks = GitHubWebhookMockSetup.createMockInstances();
    const repository = GitHubWebhookTestData.createValidRepository();
    const swarm = GitHubWebhookTestData.createValidSwarm();
    const workspace = GitHubWebhookTestData.createValidWorkspace();
    const workspaceWithSlug = GitHubWebhookTestData.createWorkspaceWithSlug();
    const githubCreds = GitHubWebhookTestData.createGithubCredentials();
    const asyncResult = GitHubWebhookTestData.createAsyncSyncResult();

    mocks.mockDbRepositoryFindFirst.mockResolvedValue(repository);
    mocks.mockDbSwarmFindUnique.mockResolvedValue(swarm);
    mocks.mockDbWorkspaceFindUnique
      .mockResolvedValueOnce(workspace)
      .mockResolvedValueOnce(workspaceWithSlug);
    mocks.mockGetGithubUsernameAndPAT.mockResolvedValue(githubCreds);
    mocks.mockComputeHmac.mockReturnValue("valid-signature-hex");
    mocks.mockTimingSafeEqual.mockReturnValue(true);
    mocks.mockTriggerAsyncSync.mockResolvedValue(asyncResult);
    mocks.mockDbRepositoryUpdate.mockResolvedValue({ ...repository, status: RepositoryStatus.PENDING });
    mocks.mockDbSwarmUpdate.mockResolvedValue({ ...swarm, ingestRefId: "sync-req-123" });

    return { repository, swarm, workspace, workspaceWithSlug, githubCreds, asyncResult, ...mocks };
  },

  setupSignatureVerification: (isValid: boolean) => {
    const mocks = GitHubWebhookMockSetup.createMockInstances();
    mocks.mockComputeHmac.mockReturnValue("expected-signature");
    mocks.mockTimingSafeEqual.mockReturnValue(isValid);
    return mocks;
  },

  setupWorkspaceDataMocks: (
    repository = GitHubWebhookTestData.createValidRepository(),
    swarm = GitHubWebhookTestData.createValidSwarm(),
    workspace = GitHubWebhookTestData.createValidWorkspace(),
    workspaceWithSlug = GitHubWebhookTestData.createWorkspaceWithSlug(),
    githubCreds = GitHubWebhookTestData.createGithubCredentials(),
    asyncResult = GitHubWebhookTestData.createAsyncSyncResult()
  ) => {
    const mocks = GitHubWebhookMockSetup.createMockInstances();

    mocks.mockDbRepositoryFindFirst.mockResolvedValue(repository);
    mocks.mockDbSwarmFindUnique.mockResolvedValue(swarm);
    mocks.mockDbWorkspaceFindUnique
      .mockResolvedValueOnce(workspace)
      .mockResolvedValueOnce(workspaceWithSlug);
    mocks.mockGetGithubUsernameAndPAT.mockResolvedValue(githubCreds);
    mocks.mockComputeHmac.mockReturnValue("valid-signature-hex");
    mocks.mockTimingSafeEqual.mockReturnValue(true);
    mocks.mockTriggerAsyncSync.mockResolvedValue(asyncResult);
    mocks.mockDbRepositoryUpdate.mockResolvedValue({ ...repository, status: RepositoryStatus.PENDING });
    mocks.mockDbSwarmUpdate.mockResolvedValue({ ...swarm, ingestRefId: "sync-req-123" });

    return { repository, swarm, workspace, workspaceWithSlug, githubCreds, asyncResult, ...mocks };
  },
};
