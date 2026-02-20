import { describe, it, expect, beforeEach, vi } from "vitest";
import { useStakgraphStore } from "@/stores/useStakgraphStore";

// Mock toast
vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// Mock devContainerUtils
vi.mock("@/utils/devContainerUtils", () => ({
  getPM2AppsContent: vi.fn(() => ({ content: "" })),
  maskEnvVarsInPM2Config: vi.fn((content) => content),
}));

// Mock repositoryParser
vi.mock("@/utils/repositoryParser", () => ({
  parseGithubOwnerRepo: vi.fn(() => ({ owner: "test", repo: "test-repo" })),
}));

// Mock request-manager
vi.mock("@/utils/request-manager", () => ({
  createRequestManager: vi.fn(() => ({
    getSignal: vi.fn(() => new AbortController().signal),
    isAborted: vi.fn(() => false),
    reset: vi.fn(),
  })),
  isAbortError: vi.fn(() => false),
}));

describe("useStakgraphStore - repoValidationErrors", () => {
  beforeEach(() => {
    // Reset the store state before each test
    const { resetForm } = useStakgraphStore.getState();
    resetForm();
    
    // Clear all mocks
    vi.clearAllMocks();
  });

  describe("setRepoValidationErrors", () => {
    it("should update repoValidationErrors in state", () => {
      const store = useStakgraphStore.getState();
      
      // Initial state should be empty
      expect(store.repoValidationErrors).toEqual({});
      
      // Set validation errors
      const errors = {
        "repositories.0.adminVerification": "Admin access required",
        "repositories.1.adminVerification": "Admin access required",
      };
      
      store.setRepoValidationErrors(errors);
      
      // Check that the errors were set
      const updatedStore = useStakgraphStore.getState();
      expect(updatedStore.repoValidationErrors).toEqual(errors);
    });

    it("should allow clearing repoValidationErrors by passing empty object", () => {
      const store = useStakgraphStore.getState();
      
      // Set some errors first
      store.setRepoValidationErrors({
        "repositories.0.adminVerification": "Admin access required",
      });
      
      expect(useStakgraphStore.getState().repoValidationErrors).not.toEqual({});
      
      // Clear errors
      store.setRepoValidationErrors({});
      
      expect(useStakgraphStore.getState().repoValidationErrors).toEqual({});
    });
  });

  describe("saveSettings with repoValidationErrors", () => {
    it("should return early and set errors when repoValidationErrors is non-empty", async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock;
      
      const store = useStakgraphStore.getState();
      
      // Set up valid form data
      store.handleProjectInfoChange({ name: "Test Project" });
      store.handleRepositoryChange({
        repositories: [
          {
            repositoryUrl: "https://github.com/test/repo",
            branch: "main",
            name: "repo",
            codeIngestionEnabled: true,
            docsEnabled: true,
            mocksEnabled: true,
            embeddingsEnabled: true,
          },
        ],
      });
      store.handleSwarmChange({
        swarmUrl: "https://swarm.example.com",
        swarmSecretAlias: "test-secret",
      });
      store.handleEnvironmentChange({ poolName: "test-pool" });
      
      // Set repo validation errors
      const repoErrors = {
        "repositories.0.adminVerification": "Admin access required",
      };
      store.setRepoValidationErrors(repoErrors);
      
      // Attempt to save
      await store.saveSettings("test-workspace");
      
      // Assert that fetch was NOT called
      expect(fetchMock).not.toHaveBeenCalled();
      
      // Assert that the errors were set in the store
      const updatedStore = useStakgraphStore.getState();
      expect(updatedStore.errors).toEqual(repoErrors);
      
      // Assert that saved is false
      expect(updatedStore.saved).toBe(false);
    });

    it("should proceed with save when repoValidationErrors is empty", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            status: "active",
            updatedAt: new Date().toISOString(),
          },
        }),
      });
      global.fetch = fetchMock;
      
      const store = useStakgraphStore.getState();
      
      // Set up valid form data
      store.handleProjectInfoChange({ name: "Test Project" });
      store.handleRepositoryChange({
        repositories: [
          {
            repositoryUrl: "https://github.com/test/repo",
            branch: "main",
            name: "repo",
            codeIngestionEnabled: true,
            docsEnabled: true,
            mocksEnabled: true,
            embeddingsEnabled: true,
          },
        ],
      });
      store.handleSwarmChange({
        swarmUrl: "https://swarm.example.com",
        swarmSecretAlias: "test-secret",
      });
      store.handleEnvironmentChange({ poolName: "test-pool" });
      
      // Ensure repoValidationErrors is empty
      store.setRepoValidationErrors({});
      
      // Attempt to save
      await store.saveSettings("test-workspace");
      
      // Assert that fetch WAS called
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workspaces/test-workspace/stakgraph",
        expect.objectContaining({
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
        })
      );
      
      // Assert that saved is true
      const updatedStore = useStakgraphStore.getState();
      expect(updatedStore.saved).toBe(true);
    });

    it("should merge multiple repoValidationErrors into errors", async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock;
      
      const store = useStakgraphStore.getState();
      
      // Set up valid form data
      store.handleProjectInfoChange({ name: "Test Project" });
      store.handleRepositoryChange({
        repositories: [
          {
            repositoryUrl: "https://github.com/test/repo1",
            branch: "main",
            name: "repo1",
            codeIngestionEnabled: true,
            docsEnabled: true,
            mocksEnabled: true,
            embeddingsEnabled: true,
          },
          {
            repositoryUrl: "https://github.com/test/repo2",
            branch: "main",
            name: "repo2",
            codeIngestionEnabled: true,
            docsEnabled: true,
            mocksEnabled: true,
            embeddingsEnabled: true,
          },
        ],
      });
      store.handleSwarmChange({
        swarmUrl: "https://swarm.example.com",
        swarmSecretAlias: "test-secret",
      });
      store.handleEnvironmentChange({ poolName: "test-pool" });
      
      // Set multiple repo validation errors
      const repoErrors = {
        "repositories.0.adminVerification": "Admin access required",
        "repositories.1.adminVerification": "Admin access required",
      };
      store.setRepoValidationErrors(repoErrors);
      
      // Attempt to save
      await store.saveSettings("test-workspace");
      
      // Assert that fetch was NOT called
      expect(fetchMock).not.toHaveBeenCalled();
      
      // Assert that all errors were merged
      const updatedStore = useStakgraphStore.getState();
      expect(updatedStore.errors).toEqual(repoErrors);
      expect(Object.keys(updatedStore.errors)).toHaveLength(2);
    });

    it("should check repoValidationErrors before other validation", async () => {
      const fetchMock = vi.fn();
      global.fetch = fetchMock;
      
      const store = useStakgraphStore.getState();
      
      // Set up INVALID form data (missing required fields)
      store.handleProjectInfoChange({ name: "" }); // Invalid - empty name
      store.handleRepositoryChange({
        repositories: [
          {
            repositoryUrl: "https://github.com/test/repo",
            branch: "main",
            name: "repo",
            codeIngestionEnabled: true,
            docsEnabled: true,
            mocksEnabled: true,
            embeddingsEnabled: true,
          },
        ],
      });
      store.handleSwarmChange({
        swarmUrl: "",  // Invalid - empty URL
        swarmSecretAlias: "test-secret",
      });
      store.handleEnvironmentChange({ poolName: "test-pool" });
      
      // Set repo validation errors (should be checked FIRST)
      const repoErrors = {
        "repositories.0.adminVerification": "Admin access required",
      };
      store.setRepoValidationErrors(repoErrors);
      
      // Attempt to save
      await store.saveSettings("test-workspace");
      
      // Assert that fetch was NOT called
      expect(fetchMock).not.toHaveBeenCalled();
      
      // Assert that ONLY repo validation errors are set (not other validation errors)
      const updatedStore = useStakgraphStore.getState();
      expect(updatedStore.errors).toEqual(repoErrors);
      expect(updatedStore.errors).not.toHaveProperty("name");
      expect(updatedStore.errors).not.toHaveProperty("swarmUrl");
    });
  });
});
