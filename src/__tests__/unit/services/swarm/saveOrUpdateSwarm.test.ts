import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { saveOrUpdateSwarm } from "@/services/swarm/db";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { SwarmStatus } from "@prisma/client";

// Mock the database
vi.mock("@/lib/db", () => ({
  db: {
    swarm: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// Mock the entire encryption module to ensure we get the same instance
vi.mock("@/lib/encryption", () => {
  const mockEncryptionService = {
    encryptField: vi.fn((field, value) => ({
      data: `encrypted_${value}`,
      iv: "mock_iv",
      tag: "mock_tag",
      keyId: "mock_key",
      version: "1",
      encryptedAt: new Date().toISOString(),
    })),
    decryptField: vi.fn((field, data) => {
      if (typeof data === "string") {
        try {
          const parsed = JSON.parse(data);
          return parsed.data?.replace("encrypted_", "") || data;
        } catch {
          return data;
        }
      }
      return data.data?.replace("encrypted_", "") || "";
    }),
  };

  return {
    EncryptionService: {
      getInstance: vi.fn(() => mockEncryptionService),
    },
    encryptEnvVars: vi.fn((vars) =>
      vars.map((v) => ({
        name: v.name,
        value: {
          data: `encrypted_${v.value}`,
          iv: "mock_iv",
          tag: "mock_tag",
          keyId: "mock_key",
          version: "1",
          encryptedAt: new Date().toISOString(),
        },
      })),
    ),
  };
});

describe("saveOrUpdateSwarm", () => {
  const mockEncryptionService = EncryptionService.getInstance();
  const mockWorkspaceId = "test-workspace-id";
  const mockSwarmId = "test-swarm-id";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("when creating a new swarm", () => {
    beforeEach(() => {
      (db.swarm.findUnique as any).mockResolvedValue(null);
      (db.swarm.create as any).mockResolvedValue({
        id: "new-swarm-id",
        workspaceId: mockWorkspaceId,
        name: "test-swarm",
        status: SwarmStatus.PENDING,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it("should create a new swarm with minimal required fields", async () => {
      const params = {
        workspaceId: mockWorkspaceId,
        name: "test-swarm",
      };

      const result = await saveOrUpdateSwarm(params);

      expect(db.swarm.findUnique).toHaveBeenCalledWith({
        where: { workspaceId: mockWorkspaceId },
      });

      expect(db.swarm.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspaceId: mockWorkspaceId,
          name: "test-swarm",
          status: SwarmStatus.PENDING,
          environmentVariables: [],
          services: [],
        }),
        select: expect.any(Object),
      });

      expect(result).toEqual({
        id: "new-swarm-id",
        workspaceId: mockWorkspaceId,
        name: "test-swarm",
        status: SwarmStatus.PENDING,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      });
    });

    it("should create a swarm with encrypted API key", async () => {
      const params = {
        workspaceId: mockWorkspaceId,
        name: "test-swarm",
        swarmApiKey: "secret-api-key",
      };

      await saveOrUpdateSwarm(params);

      expect(mockEncryptionService.encryptField).toHaveBeenCalledWith("swarmApiKey", "secret-api-key");

      expect(db.swarm.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            swarmApiKey: expect.stringContaining("encrypted_secret-api-key"),
          }),
          select: expect.any(Object),
        }),
      );
    });

    it("should create a swarm with encrypted password", async () => {
      const params = {
        workspaceId: mockWorkspaceId,
        name: "test-swarm",
        swarmPassword: "secret-password",
      };

      await saveOrUpdateSwarm(params);

      expect(mockEncryptionService.encryptField).toHaveBeenCalledWith("swarmPassword", "secret-password");

      expect(db.swarm.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            swarmPassword: expect.stringContaining("encrypted_secret-password"),
          }),
          select: expect.any(Object),
        }),
      );
    });

    it("should create a swarm with encrypted environment variables", async () => {
      const { encryptEnvVars } = await import("@/lib/encryption");
      const params = {
        workspaceId: mockWorkspaceId,
        name: "test-swarm",
        environmentVariables: [
          { name: "API_KEY", value: "secret-value" },
          { name: "DATABASE_URL", value: "postgresql://..." },
        ],
      };

      await saveOrUpdateSwarm(params);

      expect(encryptEnvVars).toHaveBeenCalledWith([
        { name: "API_KEY", value: "secret-value" },
        { name: "DATABASE_URL", value: "postgresql://..." },
      ]);

      expect(db.swarm.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          environmentVariables: [
            {
              name: "API_KEY",
              value: {
                data: "encrypted_secret-value",
                iv: "mock_iv",
                tag: "mock_tag",
                keyId: "mock_key",
                version: "1",
                encryptedAt: expect.any(String),
              },
            },
            {
              name: "DATABASE_URL",
              value: {
                data: "encrypted_postgresql://...",
                iv: "mock_iv",
                tag: "mock_tag",
                keyId: "mock_key",
                version: "1",
                encryptedAt: expect.any(String),
              },
            },
          ],
        }),
        select: expect.any(Object),
      });
    });

    it("should create a swarm with services configuration", async () => {
      const services = [
        {
          baseURL: "https://api.example.com",
          apiKey: "service-key",
          timeout: 5000,
          headers: { "Content-Type": "application/json" },
        },
      ];

      const params = {
        workspaceId: mockWorkspaceId,
        name: "test-swarm",
        services,
      };

      await saveOrUpdateSwarm(params);

      expect(db.swarm.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          services,
        }),
        select: expect.any(Object),
      });
    });
  });

  describe("when updating an existing swarm", () => {
    const existingSwarm = {
      id: "existing-swarm-id",
      workspaceId: mockWorkspaceId,
      name: "existing-swarm",
      status: SwarmStatus.PENDING,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    beforeEach(() => {
      (db.swarm.findUnique as any).mockResolvedValue(existingSwarm);
      (db.swarm.update as any).mockResolvedValue({
        ...existingSwarm,
        updatedAt: new Date(),
      });
    });

    it("should update an existing swarm with new fields", async () => {
      const params = {
        workspaceId: mockWorkspaceId,
        status: SwarmStatus.ACTIVE,
        swarmUrl: "https://test.sphinx.chat",
      };

      await saveOrUpdateSwarm(params);

      expect(db.swarm.findUnique).toHaveBeenCalledWith({
        where: { workspaceId: mockWorkspaceId },
      });

      expect(db.swarm.update).toHaveBeenCalledWith({
        where: { workspaceId: mockWorkspaceId },
        data: expect.objectContaining({
          status: SwarmStatus.ACTIVE,
          swarmUrl: "https://test.sphinx.chat",
          updatedAt: expect.any(Date),
        }),
        select: expect.any(Object),
      });
    });

    it("should update encrypted fields properly", async () => {
      const params = {
        workspaceId: mockWorkspaceId,
        swarmApiKey: "updated-api-key",
        swarmPassword: "updated-password",
      };

      await saveOrUpdateSwarm(params);

      expect(mockEncryptionService.encryptField).toHaveBeenCalledWith("swarmApiKey", "updated-api-key");
      expect(mockEncryptionService.encryptField).toHaveBeenCalledWith("swarmPassword", "updated-password");

      expect(db.swarm.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId: mockWorkspaceId },
          data: expect.objectContaining({
            swarmApiKey: expect.stringContaining("encrypted_updated-api-key"),
            swarmPassword: expect.stringContaining("encrypted_updated-password"),
            updatedAt: expect.any(Date),
          }),
          select: expect.any(Object),
        }),
      );
    });

    it("should only update provided fields", async () => {
      const params = {
        workspaceId: mockWorkspaceId,
        status: SwarmStatus.ACTIVE,
        // Only status is provided, other fields should not be updated
      };

      await saveOrUpdateSwarm(params);

      const updateCall = (db.swarm.update as any).mock.calls[0][0];
      const dataKeys = Object.keys(updateCall.data);

      expect(dataKeys).toContain("status");
      expect(dataKeys).toContain("updatedAt");
      expect(dataKeys).not.toContain("name");
      expect(dataKeys).not.toContain("swarmUrl");
      expect(dataKeys).not.toContain("swarmApiKey");
    });

    it("should handle undefined fields gracefully", async () => {
      const params = {
        workspaceId: mockWorkspaceId,
        name: undefined,
        status: SwarmStatus.ACTIVE,
        swarmApiKey: undefined,
        environmentVariables: undefined,
      };

      await saveOrUpdateSwarm(params);

      const updateCall = (db.swarm.update as any).mock.calls[0][0];
      const dataKeys = Object.keys(updateCall.data);

      // Only defined fields should be in the update
      expect(dataKeys).toContain("status");
      expect(dataKeys).toContain("updatedAt");
      expect(dataKeys).not.toContain("name");
      expect(dataKeys).not.toContain("swarmApiKey");
      expect(dataKeys).not.toContain("environmentVariables");
    });
  });

  describe("database operation handling", () => {
    it("should handle database errors gracefully", async () => {
      const dbError = new Error("Database connection failed");
      (db.swarm.findUnique as any).mockRejectedValue(dbError);

      const params = {
        workspaceId: mockWorkspaceId,
        name: "test-swarm",
      };

      await expect(saveOrUpdateSwarm(params)).rejects.toThrow("Database connection failed");
    });

    it("should handle create operation errors", async () => {
      (db.swarm.findUnique as any).mockResolvedValue(null);
      const createError = new Error("Failed to create swarm");
      (db.swarm.create as any).mockRejectedValue(createError);

      const params = {
        workspaceId: mockWorkspaceId,
        name: "test-swarm",
      };

      await expect(saveOrUpdateSwarm(params)).rejects.toThrow("Failed to create swarm");
    });

    it("should handle update operation errors", async () => {
      const existingSwarm = { id: "existing", workspaceId: mockWorkspaceId };
      (db.swarm.findUnique as any).mockResolvedValue(existingSwarm);
      const updateError = new Error("Failed to update swarm");
      (db.swarm.update as any).mockRejectedValue(updateError);

      const params = {
        workspaceId: mockWorkspaceId,
        status: SwarmStatus.ACTIVE,
      };

      await expect(saveOrUpdateSwarm(params)).rejects.toThrow("Failed to update swarm");
    });
  });

  describe("encryption service integration", () => {
    it("should handle encryption service errors", async () => {
      (db.swarm.findUnique as any).mockResolvedValue(null);
      (mockEncryptionService.encryptField as any).mockImplementation(() => {
        throw new Error("Encryption failed");
      });

      const params = {
        workspaceId: mockWorkspaceId,
        name: "test-swarm",
        swarmApiKey: "secret-key",
      };

      await expect(saveOrUpdateSwarm(params)).rejects.toThrow("Encryption failed");
    });

    it("should not call encryption for fields that are undefined", async () => {
      (db.swarm.findUnique as any).mockResolvedValue(null);
      (db.swarm.create as any).mockResolvedValue({
        id: "new-swarm-id",
        workspaceId: mockWorkspaceId,
      });

      const params = {
        workspaceId: mockWorkspaceId,
        name: "test-swarm",
        swarmApiKey: undefined,
        swarmPassword: undefined,
      };

      await saveOrUpdateSwarm(params);

      expect(mockEncryptionService.encryptField).not.toHaveBeenCalled();
    });
  });

  describe("complex parameter scenarios", () => {
    it("should handle all possible parameters in creation", async () => {
      (db.swarm.findUnique as any).mockResolvedValue(null);
      (db.swarm.create as any).mockResolvedValue({
        id: "comprehensive-swarm",
        workspaceId: mockWorkspaceId,
      });

      const params = {
        workspaceId: mockWorkspaceId,
        name: "comprehensive-swarm",
        instanceType: "m6i.xlarge",
        environmentVariables: [{ name: "ENV_VAR", value: "env_value" }],
        status: SwarmStatus.ACTIVE,
        swarmUrl: "https://test.sphinx.chat",
        repositoryName: "test-repo",
        repositoryDescription: "Test repository",
        repositoryUrl: "https://github.com/test/repo",
        swarmApiKey: "api-key",
        swarmPassword: "password",
        poolName: "test-pool",
        poolCpu: "4",
        poolMemory: "8Gi",
        services: [{ name: "test-service", port: 3000, scripts: { start: "npm start" } }],
        swarmId: "custom-swarm-id",
        swarmSecretAlias: "secret-alias",
        ingestRefId: "ingest-ref-123",
        containerFiles: { Dockerfile: "FROM node:18" },
        defaultBranch: "main",
      };

      await saveOrUpdateSwarm(params);

      expect(db.swarm.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspaceId: mockWorkspaceId,
          name: "comprehensive-swarm",
          instanceType: "m6i.xlarge",
          status: SwarmStatus.ACTIVE,
          swarmUrl: "https://test.sphinx.chat",
          repositoryName: "test-repo",
          repositoryDescription: "Test repository",
          repositoryUrl: "https://github.com/test/repo",
          poolName: "test-pool",
          poolCpu: "4",
          poolMemory: "8Gi",
          swarmSecretAlias: "secret-alias",
          containerFiles: { Dockerfile: "FROM node:18" },
          defaultBranch: "main",
          swarmId: "custom-swarm-id",
          ingestRefId: "ingest-ref-123",
          // Verify encrypted fields are JSON strings
          swarmApiKey: expect.stringMatching(/^{.*encrypted_api-key.*}$/),
          swarmPassword: expect.stringMatching(/^{.*encrypted_password.*}$/),
          // Verify encrypted environment variables structure
          environmentVariables: expect.arrayContaining([
            expect.objectContaining({
              name: "ENV_VAR",
              value: expect.objectContaining({
                data: "encrypted_env_value",
                iv: "mock_iv",
                tag: "mock_tag",
                keyId: "mock_key",
                version: "1",
                encryptedAt: expect.any(String),
              }),
            }),
          ]),
          services: [{ name: "test-service", port: 3000, scripts: { start: "npm start" } }],
        }),
        select: expect.any(Object),
      });
    });
  });
});
