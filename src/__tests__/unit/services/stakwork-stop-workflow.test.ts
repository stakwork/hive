import { describe, test, expect, vi, beforeEach } from "vitest";
import { StakworkService } from "@/services/stakwork";
import type { ServiceConfig } from "@/types";

// Mock dependencies
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: () => ({
      decryptField: vi.fn((field: string, value: string) => `decrypted-${value}`),
    }),
  },
}));

vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_BASE_URL: "https://test-stakwork.com/api/v1",
    STAKWORK_API_KEY: "test-encrypted-key",
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("StakworkService.stopWorkflow", () => {
  let service: StakworkService;
  let mockPost: ReturnType<typeof vi.fn>;
  let mockClient: { post: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();

    mockPost = vi.fn();
    mockClient = { post: mockPost };

    const config: ServiceConfig = {
      baseURL: "https://test-stakwork.com/api/v1",
      apiKey: "test-encrypted-key",
      timeout: 20000,
    };

    service = new StakworkService(config);

    // Mock getClient to return our mock client
    vi.spyOn(service as any, "getClient").mockReturnValue(mockClient);
  });

  describe("Successful workflow stop", () => {
    test("should make POST request with correct headers and endpoint", async () => {
      mockPost.mockResolvedValue({ success: true });

      await service.stopWorkflow(12345);

      expect(mockPost).toHaveBeenCalledWith(
        "https://test-stakwork.com/api/v1/projects/12345/stop",
        {},
        {
          "Content-Type": "application/json",
          Authorization: "Token token=decrypted-test-encrypted-key",
        },
        "stakwork"
      );
    });

    test("should not throw error on successful stop", async () => {
      mockPost.mockResolvedValue({ success: true });

      await expect(service.stopWorkflow(12345)).resolves.toBeUndefined();
    });

    test("should handle different project IDs", async () => {
      mockPost.mockResolvedValue({ success: true });

      await service.stopWorkflow(99999);

      expect(mockPost).toHaveBeenCalledWith(
        expect.stringContaining("/projects/99999/stop"),
        expect.anything(),
        expect.anything(),
        expect.anything()
      );
    });
  });

  describe("Error handling - graceful failures", () => {
    test("should not throw when workflow already stopped (404)", async () => {
      const error404 = { message: "Not found", status: 404 };
      mockPost.mockRejectedValue(error404);

      await expect(service.stopWorkflow(12345)).resolves.toBeUndefined();
    });

    test("should not throw when workflow already completed (410)", async () => {
      const error410 = { message: "Gone", status: 410 };
      mockPost.mockRejectedValue(error410);

      await expect(service.stopWorkflow(12345)).resolves.toBeUndefined();
    });

    test("should not throw on other API errors but log warning", async () => {
      const error500 = { message: "Server error", status: 500 };
      mockPost.mockRejectedValue(error500);

      await expect(service.stopWorkflow(12345)).resolves.toBeUndefined();
    });

    test("should not throw on network errors", async () => {
      mockPost.mockRejectedValue(new Error("Network error"));

      await expect(service.stopWorkflow(12345)).resolves.toBeUndefined();
    });

    test("should handle non-error object rejections", async () => {
      mockPost.mockRejectedValue("string error");

      await expect(service.stopWorkflow(12345)).resolves.toBeUndefined();
    });
  });

  describe("Authorization header format", () => {
    test("should use correct Token authorization format", async () => {
      mockPost.mockResolvedValue({ success: true });

      await service.stopWorkflow(12345);

      const callArgs = mockPost.mock.calls[0];
      const headers = callArgs[2];

      expect(headers.Authorization).toMatch(/^Token token=.+$/);
      expect(headers.Authorization).toBe("Token token=decrypted-test-encrypted-key");
    });

    test("should decrypt API key before using in header", async () => {
      mockPost.mockResolvedValue({ success: true });

      await service.stopWorkflow(12345);

      const callArgs = mockPost.mock.calls[0];
      const headers = callArgs[2];

      // Should contain the decrypted key
      expect(headers.Authorization).toContain("decrypted-test-encrypted-key");
    });
  });

  describe("Method signature", () => {
    test("should accept number projectId", async () => {
      mockPost.mockResolvedValue({ success: true });

      await expect(service.stopWorkflow(12345)).resolves.toBeUndefined();
    });

    test("should return void (Promise<void>)", async () => {
      mockPost.mockResolvedValue({ success: true });

      const result = await service.stopWorkflow(12345);

      expect(result).toBeUndefined();
    });
  });
});
