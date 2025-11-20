import { vi } from "vitest";
import type { User, Workspace, Repository } from "@prisma/client";

/**
 * Helper functions for mocking Ask API dependencies in tests
 */

export interface MockAuthSetupOptions {
  user: User;
  workspaceAccess?: {
    hasAccess: boolean;
    workspace?: { id: string; slug: string };
    canRead?: boolean;
    canWrite?: boolean;
    canAdmin?: boolean;
  };
}

export interface MockAIServicesOptions {
  swarmApiKey?: string;
  repository?: Repository | null;
  githubPAT?: string;
  anthropicKey?: string;
  modelId?: string;
}

/**
 * Sets up authentication and workspace access mocks
 */
export async function setupAuthMocks(
  options: MockAuthSetupOptions
) {
  const { requireAuth } = await import("@/lib/middleware/utils");
  const { validateWorkspaceAccess } = await import("@/services/workspace");

  requireAuth.mockReturnValue({
    id: options.user.id,
    email: options.user.email,
    name: options.user.name,
  });

  if (options.workspaceAccess) {
    validateWorkspaceAccess.mockResolvedValue(options.workspaceAccess);
  }
}

/**
 * Sets up AI service mocks (encryption, GitHub, AI provider, tools, streaming)
 */
export async function setupAIServiceMocks(
  options: MockAIServicesOptions
) {
  const { EncryptionService } = await import("@/lib/encryption");
  const { getPrimaryRepository } = await import("@/lib/helpers/repository");
  const { getGithubUsernameAndPAT } = await import("@/auth");
  const { getApiKeyForProvider, getModel } = await import("aieo");
  const { askTools } = await import("@/lib/ai/askTools");
  const { streamText } = await import("ai");

  // Encryption mock
  if (options.swarmApiKey !== undefined) {
    const encryptionService = EncryptionService.getInstance();
    vi.spyOn(encryptionService, "decryptField").mockReturnValue(options.swarmApiKey);
  }

  // Repository mock
  if (options.repository !== undefined) {
    getPrimaryRepository.mockResolvedValue(options.repository);
  }

  // GitHub PAT mock
  if (options.githubPAT !== undefined) {
    if (options.githubPAT) {
      getGithubUsernameAndPAT.mockResolvedValue({
        username: "testuser",
        token: options.githubPAT,
      });
    } else {
      getGithubUsernameAndPAT.mockResolvedValue(null);
    }
  }

  // AI provider mocks
  if (options.anthropicKey !== undefined) {
    getApiKeyForProvider.mockReturnValue(options.anthropicKey);
  }

  if (options.modelId !== undefined) {
    getModel.mockResolvedValue({ modelId: options.modelId });
  }

  // AI tools mock
  askTools.mockReturnValue([
    { name: "get_learnings" },
    { name: "recent_commits" },
    { name: "final_answer" },
  ]);

  // StreamText mock - returns a successful streaming response
  streamText.mockReturnValue({
    toUIMessageStreamResponse: vi.fn().mockReturnValue(
      new Response("Mock AI response", {
        headers: { "content-type": "text/plain; charset=utf-8" },
      })
    ),
  });
}

/**
 * Sets up a complete successful Ask API flow with all necessary mocks
 */
export async function setupSuccessfulAskFlow(
  user: User,
  workspace: Workspace,
  repository: Repository,
  options: {
    canRead?: boolean;
    canWrite?: boolean;
    canAdmin?: boolean;
  } = {}
) {
  await setupAuthMocks({
    user,
    workspaceAccess: {
      hasAccess: true,
      workspace: { id: workspace.id, slug: workspace.slug },
      canRead: options.canRead ?? true,
      canWrite: options.canWrite ?? true,
      canAdmin: options.canAdmin ?? true,
    },
  });

  await setupAIServiceMocks({
    swarmApiKey: "test-swarm-api-key",
    repository,
    githubPAT: "test-pat-token",
    anthropicKey: "anthropic-key",
    modelId: "claude-3-5-sonnet-20241022",
  });
}

/**
 * Mocks streamText to throw an error (for error testing)
 */
export async function mockStreamTextError(errorMessage: string = "AI service unavailable") {
  const { streamText } = await import("ai");
  streamText.mockRejectedValue(new Error(errorMessage));
}
