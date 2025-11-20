import { describe, it, expect, vi, beforeEach } from "vitest";
import { StakworkGenerationService } from "@/services/stakwork-generation";
import { HttpClient } from "@/lib/http-client";
import type { ServiceConfig } from "@/types";

vi.mock("@/lib/http-client");

describe("StakworkGenerationService", () => {
  const mockConfig: ServiceConfig = {
    baseURL: "https://api.test.com",
    apiKey: "test-api-key",
    timeout: 5000,
    serviceName: "stakwork-generation",
  };

  let service: StakworkGenerationService;
  let mockHttpClient: HttpClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpClient = new HttpClient({
      baseURL: mockConfig.baseURL,
      defaultHeaders: {},
    });
    (HttpClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockHttpClient);
    service = new StakworkGenerationService(mockConfig);
  });

  describe("constructor", () => {
    it("should initialize with config", () => {
      expect(service).toBeDefined();
      expect(service.serviceName).toBe("stakwork-generation");
    });
  });

  describe("createRun", () => {
    it("should create stakwork run successfully", async () => {
      const mockRun = {
        id: "run-123",
        type: "ARCHITECTURE",
        status: "PENDING",
        result: null,
      };

      mockHttpClient.post = vi.fn().mockResolvedValue({
        success: true,
        run: mockRun,
      });

      const input = {
        type: "ARCHITECTURE" as const,
        featureId: "feature-123",
        workspaceId: "workspace-123",
      };

      const result = await service.createRun(input);

      expect(result).toEqual({ run: mockRun });
      expect(mockHttpClient.post).toHaveBeenCalledWith(
        "/api/stakwork/ai/generate",
        input
      );
    });

    it("should handle creation errors", async () => {
      mockHttpClient.post = vi.fn().mockRejectedValue({
        message: "API error",
        status: 500,
      });

      const input = {
        type: "ARCHITECTURE" as const,
        featureId: "feature-123",
        workspaceId: "workspace-123",
      };

      await expect(service.createRun(input)).rejects.toMatchObject({
        message: expect.stringContaining("API error"),
        status: 500,
      });
    });
  });

  describe("getRuns", () => {
    it("should fetch runs successfully", async () => {
      const mockRuns = [
        { id: "run-1", status: "COMPLETED" },
        { id: "run-2", status: "PENDING" },
      ];

      mockHttpClient.get = vi.fn().mockResolvedValue({
        success: true,
        runs: mockRuns,
      });

      const params = {
        workspaceId: "workspace-123",
        featureId: "feature-123",
        type: "ARCHITECTURE" as const,
        limit: "10",
      };

      const result = await service.getRuns(params);

      expect(result).toEqual({ runs: mockRuns });
      expect(mockHttpClient.get).toHaveBeenCalledWith(
        expect.stringContaining("/api/stakwork/runs?")
      );
    });
  });

  describe("updateDecision", () => {
    it("should accept run successfully", async () => {
      const mockRun = {
        id: "run-123",
        decision: "ACCEPTED",
        status: "COMPLETED",
      };

      mockHttpClient.patch = vi.fn().mockResolvedValue({
        success: true,
        run: mockRun,
      });

      const decision = {
        decision: "ACCEPTED" as const,
        featureId: "feature-123",
      };

      const result = await service.updateDecision("run-123", decision);

      expect(result).toEqual({ run: mockRun });
      expect(mockHttpClient.patch).toHaveBeenCalledWith(
        "/api/stakwork/runs/run-123/decision",
        decision
      );
    });

    it("should reject run with feedback", async () => {
      const mockRun = {
        id: "run-123",
        decision: "REJECTED",
        feedback: "Not accurate",
      };

      mockHttpClient.patch = vi.fn().mockResolvedValue({
        success: true,
        run: mockRun,
      });

      const decision = {
        decision: "REJECTED" as const,
        feedback: "Not accurate",
      };

      const result = await service.updateDecision("run-123", decision);

      expect(result).toEqual({ run: mockRun });
      expect(mockHttpClient.patch).toHaveBeenCalledWith(
        "/api/stakwork/runs/run-123/decision",
        decision
      );
    });
  });
});