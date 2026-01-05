import { describe, it, expect, vi, beforeEach } from "vitest";
import { BaseServiceClass } from "@/lib/base-service";
import { HttpClient } from "@/lib/http-client";
import type { ServiceConfig } from "@/types";

vi.mock("@/lib/http-client");

class TestService extends BaseServiceClass {
  readonly serviceName = "test-service";

  async testMethod() {
    return this.handleRequest(async () => {
      return { success: true };
    }, "testMethod");
  }

  async testError() {
    return this.handleRequest(async () => {
      throw new Error("Test error");
    }, "testError");
  }
}

describe("BaseServiceClass", () => {
  const mockConfig: ServiceConfig = {
    baseURL: "https://api.test.com",
    apiKey: "test-api-key",
    timeout: 5000,
    serviceName: "test-service",
  };

  let service: TestService;
  let mockHttpClient: HttpClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpClient = new HttpClient({
      baseURL: mockConfig.baseURL,
      defaultHeaders: {},
    });
    (HttpClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(mockHttpClient);
    service = new TestService(mockConfig);
  });

  describe("constructor", () => {
    it("should initialize with config", () => {
      expect(service).toBeDefined();
      expect(service.serviceName).toBe("test-service");
    });

    it("should create HttpClient with correct configuration", () => {
      expect(HttpClient).toHaveBeenCalledWith({
        baseURL: mockConfig.baseURL,
        defaultHeaders: {
          Authorization: `Bearer ${mockConfig.apiKey}`,
        },
        timeout: mockConfig.timeout,
      });
    });

    it("should handle config with custom headers", () => {
      const configWithHeaders: ServiceConfig = {
        ...mockConfig,
        headers: {
          "X-Custom-Header": "custom-value",
        },
      };

      new TestService(configWithHeaders);

      expect(HttpClient).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultHeaders: expect.objectContaining({
            Authorization: `Bearer ${configWithHeaders.apiKey}`,
            "X-Custom-Header": "custom-value",
          }),
        })
      );
    });

    it("should use default timeout if not provided", () => {
      const configWithoutTimeout: ServiceConfig = {
        baseURL: mockConfig.baseURL,
        apiKey: mockConfig.apiKey,
        serviceName: "test",
      };

      new TestService(configWithoutTimeout);

      expect(HttpClient).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 20000,
        })
      );
    });
  });

  describe("getConfig", () => {
    it("should return config copy", () => {
      const config = service.getConfig();

      expect(config).toEqual(mockConfig);
      expect(config).not.toBe(mockConfig);
    });

    it("should return independent config copies", () => {
      const config1 = service.getConfig();
      const config2 = service.getConfig();

      config1.apiKey = "modified";

      expect(config2.apiKey).toBe(mockConfig.apiKey);
    });
  });

  describe("updateApiKey", () => {
    it("should update config api key", () => {
      const newApiKey = "new-api-key";
      mockHttpClient.updateApiKey = vi.fn();

      service.updateApiKey(newApiKey);

      const config = service.getConfig();
      expect(config.apiKey).toBe(newApiKey);
    });

    it("should call HttpClient updateApiKey", () => {
      const newApiKey = "new-api-key";
      mockHttpClient.updateApiKey = vi.fn();

      service.updateApiKey(newApiKey);

      expect(mockHttpClient.updateApiKey).toHaveBeenCalledWith(newApiKey);
    });
  });

  describe("getClient", () => {
    it("should return HttpClient instance", () => {
      const client = (service as any).getClient();

      expect(client).toBe(mockHttpClient);
    });
  });

  describe("handleRequest", () => {
    it("should execute request successfully", async () => {
      const result = await service.testMethod();

      expect(result).toEqual({ success: true });
    });

    it("should wrap errors with service context", async () => {
      const apiError = {
        message: "API error",
        status: 500,
      };

      service.testError = vi.fn().mockRejectedValue(apiError);

      await expect(
        service.handleRequest(async () => {
          throw apiError;
        }, "testContext")
      ).rejects.toMatchObject({
        message: "test-service testContext: API error",
        status: 500,
        service: "test-service",
      });
    });

    it("should handle unknown errors", async () => {
      const unknownError = new Error("Unknown error");

      await expect(
        service.handleRequest(async () => {
          throw unknownError;
        }, "testContext")
      ).rejects.toMatchObject({
        message: "test-service testContext: An unexpected error occurred",
        status: 500,
        service: "test-service",
        details: {
          originalError: unknownError,
        },
      });
    });

    it("should use default context if not provided", async () => {
      await expect(
        service.handleRequest(async () => {
          throw { message: "Error", status: 400 };
        })
      ).rejects.toMatchObject({
        message: "test-service request: Error",
      });
    });

    it("should preserve error status codes", async () => {
      const errors = [
        { message: "Bad Request", status: 400 },
        { message: "Unauthorized", status: 401 },
        { message: "Forbidden", status: 403 },
        { message: "Not Found", status: 404 },
      ];

      for (const error of errors) {
        await expect(
          service.handleRequest(async () => {
            throw error;
          })
        ).rejects.toMatchObject({
          status: error.status,
        });
      }
    });
  });
});