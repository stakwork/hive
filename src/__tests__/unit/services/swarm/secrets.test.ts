import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getSwarmPoolApiKeyFor } from "@/services/swarm/secrets";
import { db } from "@/lib/db";

// Mock the database module
vi.mock("@/lib/db", () => ({
  db: {
    swarm: {
      findFirst: vi.fn(),
    },
  },
}));

describe("getSwarmPoolApiKeyFor", () => {
  const mockSwarmId = "test-swarm-123";
  const mockApiKey = "encrypted-api-key-data";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Happy Path", () => {
    it("should return pool API key for valid swarm ID", async () => {
      // Arrange
      const mockSwarm = {
        id: mockSwarmId,
        poolApiKey: mockApiKey,
      };
      (db.swarm.findFirst as any).mockResolvedValue(mockSwarm);

      // Act
      const result = await getSwarmPoolApiKeyFor(mockSwarmId);

      // Assert
      expect(result).toBe(mockApiKey);
      expect(db.swarm.findFirst).toHaveBeenCalledOnce();
      expect(db.swarm.findFirst).toHaveBeenCalledWith({
        where: { id: mockSwarmId },
        select: { id: true, poolApiKey: true },
      });
    });

    it("should handle encrypted API key data correctly", async () => {
      // Arrange
      const encryptedApiKey = JSON.stringify({
        data: "encrypted-content",
        iv: "initialization-vector",
        tag: "auth-tag",
        keyId: "key-1",
        version: "1",
        encryptedAt: "2024-01-01T00:00:00Z",
      });
      const mockSwarm = {
        id: mockSwarmId,
        poolApiKey: encryptedApiKey,
      };
      (db.swarm.findFirst as any).mockResolvedValue(mockSwarm);

      // Act
      const result = await getSwarmPoolApiKeyFor(mockSwarmId);

      // Assert
      expect(result).toBe(encryptedApiKey);
      expect(typeof result).toBe("string");
    });
  });

  describe("Error Scenarios", () => {
    it("should return empty string when swarm is not found", async () => {
      // Arrange
      (db.swarm.findFirst as any).mockResolvedValue(null);

      // Act
      const result = await getSwarmPoolApiKeyFor(mockSwarmId);

      // Assert
      expect(result).toBe("");
      expect(db.swarm.findFirst).toHaveBeenCalledOnce();
    });

    it("should return empty string when swarm exists but poolApiKey is null", async () => {
      // Arrange
      const mockSwarm = {
        id: mockSwarmId,
        poolApiKey: null,
      };
      (db.swarm.findFirst as any).mockResolvedValue(mockSwarm);

      // Act
      const result = await getSwarmPoolApiKeyFor(mockSwarmId);

      // Assert
      expect(result).toBe("");
    });

    it("should return empty string when swarm exists but poolApiKey is undefined", async () => {
      // Arrange
      const mockSwarm = {
        id: mockSwarmId,
        poolApiKey: undefined,
      };
      (db.swarm.findFirst as any).mockResolvedValue(mockSwarm);

      // Act
      const result = await getSwarmPoolApiKeyFor(mockSwarmId);

      // Assert
      expect(result).toBe("");
    });

    it("should return empty string when swarm exists but poolApiKey is empty string", async () => {
      // Arrange
      const mockSwarm = {
        id: mockSwarmId,
        poolApiKey: "",
      };
      (db.swarm.findFirst as any).mockResolvedValue(mockSwarm);

      // Act
      const result = await getSwarmPoolApiKeyFor(mockSwarmId);

      // Assert
      expect(result).toBe("");
    });

    it("should propagate database errors", async () => {
      // Arrange
      const dbError = new Error("Database connection failed");
      (db.swarm.findFirst as any).mockRejectedValue(dbError);

      // Act & Assert
      await expect(getSwarmPoolApiKeyFor(mockSwarmId)).rejects.toThrow(
        "Database connection failed"
      );
      expect(db.swarm.findFirst).toHaveBeenCalledOnce();
    });

    it("should handle database timeout errors", async () => {
      // Arrange
      const timeoutError = new Error("Query timeout");
      timeoutError.name = "QueryTimeoutError";
      (db.swarm.findFirst as any).mockRejectedValue(timeoutError);

      // Act & Assert
      await expect(getSwarmPoolApiKeyFor(mockSwarmId)).rejects.toThrow(
        "Query timeout"
      );
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty string swarm ID", async () => {
      // Arrange
      (db.swarm.findFirst as any).mockResolvedValue(null);

      // Act
      const result = await getSwarmPoolApiKeyFor("");

      // Assert
      expect(result).toBe("");
      expect(db.swarm.findFirst).toHaveBeenCalledWith({
        where: { id: "" },
        select: { id: true, poolApiKey: true },
      });
    });

    it("should handle whitespace-only swarm ID", async () => {
      // Arrange
      const whitespaceId = "   ";
      (db.swarm.findFirst as any).mockResolvedValue(null);

      // Act
      const result = await getSwarmPoolApiKeyFor(whitespaceId);

      // Assert
      expect(result).toBe("");
      expect(db.swarm.findFirst).toHaveBeenCalledWith({
        where: { id: whitespaceId },
        select: { id: true, poolApiKey: true },
      });
    });

    it("should handle very long swarm ID", async () => {
      // Arrange
      const longId = "a".repeat(1000);
      (db.swarm.findFirst as any).mockResolvedValue(null);

      // Act
      const result = await getSwarmPoolApiKeyFor(longId);

      // Assert
      expect(result).toBe("");
      expect(db.swarm.findFirst).toHaveBeenCalledWith({
        where: { id: longId },
        select: { id: true, poolApiKey: true },
      });
    });

    it("should handle special characters in swarm ID", async () => {
      // Arrange
      const specialId = "swarm-123!@#$%^&*()";
      (db.swarm.findFirst as any).mockResolvedValue(null);

      // Act
      const result = await getSwarmPoolApiKeyFor(specialId);

      // Assert
      expect(result).toBe("");
      expect(db.swarm.findFirst).toHaveBeenCalledWith({
        where: { id: specialId },
        select: { id: true, poolApiKey: true },
      });
    });
  });

  describe("Security Considerations", () => {
    it("should not expose internal database structure in return value", async () => {
      // Arrange
      const mockSwarm = {
        id: mockSwarmId,
        poolApiKey: mockApiKey,
        // Additional fields that should not be exposed
        internalSecret: "should-not-be-returned",
        adminPassword: "secret-admin-pass",
      };
      (db.swarm.findFirst as any).mockResolvedValue(mockSwarm);

      // Act
      const result = await getSwarmPoolApiKeyFor(mockSwarmId);

      // Assert
      expect(result).toBe(mockApiKey);
      expect(result).not.toContain("should-not-be-returned");
      expect(result).not.toContain("secret-admin-pass");
    });

    it("should only select required fields from database", async () => {
      // Arrange
      const mockSwarm = {
        id: mockSwarmId,
        poolApiKey: mockApiKey,
      };
      (db.swarm.findFirst as any).mockResolvedValue(mockSwarm);

      // Act
      await getSwarmPoolApiKeyFor(mockSwarmId);

      // Assert
      expect(db.swarm.findFirst).toHaveBeenCalledWith({
        where: { id: mockSwarmId },
        select: { id: true, poolApiKey: true },
      });
    });

    it("should handle null poolApiKey securely without throwing", async () => {
      // Arrange
      const mockSwarm = {
        id: mockSwarmId,
        poolApiKey: null,
      };
      (db.swarm.findFirst as any).mockResolvedValue(mockSwarm);

      // Act
      const result = await getSwarmPoolApiKeyFor(mockSwarmId);

      // Assert
      expect(result).toBe("");
      expect(typeof result).toBe("string");
    });
  });

  describe("Performance Considerations", () => {
    it("should make exactly one database call", async () => {
      // Arrange
      const mockSwarm = {
        id: mockSwarmId,
        poolApiKey: mockApiKey,
      };
      (db.swarm.findFirst as any).mockResolvedValue(mockSwarm);

      // Act
      await getSwarmPoolApiKeyFor(mockSwarmId);

      // Assert
      expect(db.swarm.findFirst).toHaveBeenCalledTimes(1);
    });

    it("should not cache results between calls", async () => {
      // Arrange
      const mockSwarm1 = { id: "swarm-1", poolApiKey: "key-1" };
      const mockSwarm2 = { id: "swarm-2", poolApiKey: "key-2" };

      (db.swarm.findFirst as any)
        .mockResolvedValueOnce(mockSwarm1)
        .mockResolvedValueOnce(mockSwarm2);

      // Act
      const result1 = await getSwarmPoolApiKeyFor("swarm-1");
      const result2 = await getSwarmPoolApiKeyFor("swarm-2");

      // Assert
      expect(result1).toBe("key-1");
      expect(result2).toBe("key-2");
      expect(db.swarm.findFirst).toHaveBeenCalledTimes(2);
    });
  });
});