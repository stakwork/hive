import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { EncryptionService } from "@/lib/encryption";

// Create the mock encryption service first
const mockEncryptionService = {
  encryptField: vi.fn(),
  decryptField: vi.fn(),
};

// Mock external dependencies
vi.mock("@/lib/db", () => ({
  db: {
    swarm: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => mockEncryptionService),
  },
}));

vi.mock("@/services/pool-manager", () => ({
  PoolManagerService: vi.fn(),
}));

vi.mock("@/utils/randomPassword", () => ({
  generateRandomPassword: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  env: {
    POOL_MANAGER_API_PASSWORD: "test-admin-password",
  },
}));

// Import after mocks
import { updateSwarmPoolApiKeyFor, getSwarmPoolApiKeyFor } from "@/services/swarm/secrets";
import { db } from "@/lib/db";
import { PoolManagerService } from "@/services/pool-manager";
import { generateRandomPassword } from "@/utils/randomPassword";
import { env } from "@/lib/env";

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock console methods to avoid noise in tests
const consoleSpy = {
  log: vi.spyOn(console, "log").mockImplementation(() => {}),
  error: vi.spyOn(console, "error").mockImplementation(() => {}),
};

describe("Swarm Secrets Service - Sensitive Data Handling", () => {
  const mockPoolManager = {
    createUser: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup PoolManagerService mock
    (PoolManagerService as any).mockImplementation(() => mockPoolManager);
  });

  afterEach(() => {
    consoleSpy.log.mockClear();
    consoleSpy.error.mockClear();
  });

  describe("updateSwarmPoolApiKeyFor", () => {
    const testSwarmId = "test-swarm-123";
    const testSwarm = {
      id: testSwarmId,
      swarmId: "SWARM123",
    };

    test("should successfully update swarm pool API key with encrypted credentials", async () => {
      // Mock database response for swarm lookup
      (db.swarm.findFirst as any).mockResolvedValue(testSwarm);

      // Mock fetch responses for login and pool user creation
      mockFetch
        .mockResolvedValueOnce({
          json: vi.fn().mockResolvedValue({
            token: "mock-admin-token",
          }),
        })
        .mockResolvedValueOnce({
          json: vi.fn().mockResolvedValue({
            authentication_token: "user-auth-token-456",
          }),
        });

      // Mock random password generation
      (generateRandomPassword as any).mockReturnValue("randompass123");

      // Mock pool manager createUser method
      mockPoolManager.createUser.mockResolvedValue({
        authentication_token: "user-auth-token-456",
        username: "swarm123",
        password: "randompass123",
      });

      // Mock database update
      (db.swarm.update as any).mockResolvedValue({
        ...testSwarm,
        poolApiKey: '{"data":"encrypted-user-token"}',
      });

      // Mock encryption service
      const mockEncryptedAdminKey = { data: "encrypted-admin-token" };
      const mockEncryptedUserKey = { data: "encrypted-user-token" };
      
      mockEncryptionService.encryptField
        .mockReturnValueOnce(mockEncryptedAdminKey)  // First call for admin token
        .mockReturnValueOnce(mockEncryptedUserKey);   // Second call for user token

      await updateSwarmPoolApiKeyFor(testSwarmId);

      // Verify admin login request
      expect(mockFetch).toHaveBeenCalledWith(
        "https://workspaces.sphinx.chat/api/auth/login",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: "admin",
            password: "test-admin-password",
          }),
        })
      );

      // Verify swarm database lookup
      expect(db.swarm.findFirst).toHaveBeenCalledWith({
        where: { id: testSwarmId },
        select: { swarmId: true },
      });

      // Verify pool manager instantiation
      expect(PoolManagerService).toHaveBeenCalledWith({
        baseURL: "https://workspaces.sphinx.chat/api",
        apiKey: JSON.stringify(mockEncryptedAdminKey),
        headers: {
          Authorization: "Bearer mock-admin-token",
        },
      });

      // Verify pool user creation
      expect(mockPoolManager.createUser).toHaveBeenCalledWith({
        password: "randompass123",
        username: "swarm123",
      });

      // Verify encryption was called for both admin and user tokens
      expect(mockEncryptionService.encryptField).toHaveBeenCalledWith(
        "poolApiKey",
        "mock-admin-token"
      );
      expect(mockEncryptionService.encryptField).toHaveBeenCalledWith(
        "poolApiKey",
        "user-auth-token-456"
      );

      // Verify database update with encrypted user token
      expect(db.swarm.update).toHaveBeenCalledWith({
        where: { id: testSwarmId },
        data: {
          poolApiKey: JSON.stringify(mockEncryptedUserKey),
        },
      });
    });

    test("should handle case when swarmId is not found", async () => {
      // Mock database response with no swarmId
      (db.swarm.findFirst as any).mockResolvedValue(null);

      // Mock login response
      mockFetch.mockResolvedValueOnce({
        json: vi.fn().mockResolvedValue({ token: "mock-admin-token" }),
      });

      // Mock encryption service
      const mockEncryptedAdminKey = { data: "encrypted-admin-token" };
      mockEncryptionService.encryptField.mockReturnValue(mockEncryptedAdminKey);

      await updateSwarmPoolApiKeyFor(testSwarmId);

      // Verify login still occurs
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Verify pool manager is not called for user creation
      expect(mockPoolManager.createUser).not.toHaveBeenCalled();

      // Verify database update is not called
      expect(db.swarm.update).not.toHaveBeenCalled();
    });
  });

  describe("getSwarmPoolApiKeyFor", () => {
    const testSwarmId = "test-swarm-123";

    test("should return poolApiKey when swarm exists", async () => {
      const mockSwarm = {
        id: testSwarmId,
        poolApiKey: "encrypted-api-key-data",
      };

      (db.swarm.findFirst as any).mockResolvedValue(mockSwarm);

      const result = await getSwarmPoolApiKeyFor(testSwarmId);

      expect(db.swarm.findFirst).toHaveBeenCalledWith({
        where: { id: testSwarmId },
        select: { id: true, poolApiKey: true },
      });

      expect(result).toBe("encrypted-api-key-data");
    });

    test("should return empty string when swarm does not exist", async () => {
      (db.swarm.findFirst as any).mockResolvedValue(null);

      const result = await getSwarmPoolApiKeyFor(testSwarmId);

      expect(result).toBe("");
    });

    test("should return empty string when poolApiKey is null", async () => {
      const mockSwarm = {
        id: testSwarmId,
        poolApiKey: null,
      };

      (db.swarm.findFirst as any).mockResolvedValue(mockSwarm);

      const result = await getSwarmPoolApiKeyFor(testSwarmId);

      expect(result).toBe("");
    });
  });
});
