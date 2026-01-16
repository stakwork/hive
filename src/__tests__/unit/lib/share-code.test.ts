import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateShareCode, ensureUniqueShareCode } from "@/lib/share-code";
import { db } from "@/lib/db";

// Mock the database
vi.mock("@/lib/db", () => ({
  db: {
    sharedConversation: {
      findUnique: vi.fn(),
    },
  },
}));

describe("share-code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("generateShareCode", () => {
    it("should generate an 8-character code", () => {
      const code = generateShareCode();
      expect(code).toHaveLength(8);
    });

    it("should only contain alphanumeric characters", () => {
      const code = generateShareCode();
      const alphanumericRegex = /^[a-zA-Z0-9]+$/;
      expect(code).toMatch(alphanumericRegex);
    });

    it("should contain mixed case and digits", () => {
      // Generate multiple codes to increase chance of getting all character types
      const codes = Array.from({ length: 100 }, () => generateShareCode());
      const combinedCodes = codes.join("");
      
      // Check that at least some codes contain uppercase, lowercase, and digits
      expect(combinedCodes).toMatch(/[a-z]/);
      expect(combinedCodes).toMatch(/[A-Z]/);
      expect(combinedCodes).toMatch(/[0-9]/);
    });

    it("should generate different codes on subsequent calls", () => {
      const code1 = generateShareCode();
      const code2 = generateShareCode();
      const code3 = generateShareCode();
      
      // While theoretically possible to get duplicates, it's extremely unlikely
      const uniqueCodes = new Set([code1, code2, code3]);
      expect(uniqueCodes.size).toBeGreaterThan(1);
    });
  });

  describe("ensureUniqueShareCode", () => {
    it("should return a code if no collision occurs", async () => {
      // Mock database to return null (no existing code)
      vi.mocked(db.sharedConversation.findUnique).mockResolvedValue(null);

      const code = await ensureUniqueShareCode();
      
      expect(code).toHaveLength(8);
      expect(db.sharedConversation.findUnique).toHaveBeenCalledTimes(1);
      expect(db.sharedConversation.findUnique).toHaveBeenCalledWith({
        where: { shareCode: code },
        select: { id: true },
      });
    });

    it("should retry on collision and return unique code", async () => {
      // Mock first call to return existing code, second call to return null
      vi.mocked(db.sharedConversation.findUnique)
        .mockResolvedValueOnce({ id: "existing-id" } as any)
        .mockResolvedValueOnce(null);

      const code = await ensureUniqueShareCode();
      
      expect(code).toHaveLength(8);
      expect(db.sharedConversation.findUnique).toHaveBeenCalledTimes(2);
    });

    it("should handle multiple collisions before finding unique code", async () => {
      // Mock first 3 calls to return existing codes, 4th call to return null
      vi.mocked(db.sharedConversation.findUnique)
        .mockResolvedValueOnce({ id: "existing-1" } as any)
        .mockResolvedValueOnce({ id: "existing-2" } as any)
        .mockResolvedValueOnce({ id: "existing-3" } as any)
        .mockResolvedValueOnce(null);

      const code = await ensureUniqueShareCode();
      
      expect(code).toHaveLength(8);
      expect(db.sharedConversation.findUnique).toHaveBeenCalledTimes(4);
    });

    it("should throw error after maximum retries", async () => {
      // Mock all calls to return existing codes (simulating constant collision)
      vi.mocked(db.sharedConversation.findUnique).mockResolvedValue({ id: "existing-id" } as any);

      await expect(ensureUniqueShareCode()).rejects.toThrow(
        "Failed to generate unique share code after maximum retries"
      );
      
      // Should try exactly 10 times (MAX_RETRIES)
      expect(db.sharedConversation.findUnique).toHaveBeenCalledTimes(10);
    });

    it("should throw error if database query fails", async () => {
      // Mock database to throw error
      const dbError = new Error("Database connection failed");
      vi.mocked(db.sharedConversation.findUnique).mockRejectedValue(dbError);

      await expect(ensureUniqueShareCode()).rejects.toThrow("Database connection failed");
    });
  });
});
