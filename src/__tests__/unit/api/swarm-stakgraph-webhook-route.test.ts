import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/swarm/stakgraph/webhook/route";
import type { WebhookPayload } from "@/types";
import { 
  webhookFixtures,
  webhookTestHelpers,
  swarmWebhookFixtures,
} from "@/__tests__/support/fixtures";

// Mock encryption service with hoisted implementation
const mockEncryptionInstance = vi.hoisted(() => {
  const mockDecryptField = vi.fn((fieldType: string, encryptedValue: string) => {
    return `decrypted-${fieldType}`;
  });

  return {
    decryptField: mockDecryptField,
  };
});

// Mock all external dependencies
vi.mock("@/lib/db", () => ({
  db: {
    swarm: {
      findFirst: vi.fn(),
    },
    repository: {
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => mockEncryptionInstance),
  },
  computeHmacSha256Hex: vi.fn(),
  timingSafeEqual: vi.fn(),
}));

vi.mock("@/services/swarm/StakgraphWebhookService", () => ({
  StakgraphWebhookService: vi.fn(),
}));

// Import mocked modules
import { db } from "@/lib/db";
import { computeHmacSha256Hex, timingSafeEqual } from "@/lib/encryption";
import { StakgraphWebhookService } from "@/services/swarm/StakgraphWebhookService";

const mockDbSwarmFindFirst = db.swarm.findFirst as Mock;
const mockComputeHmacSha256Hex = computeHmacSha256Hex as Mock;
const mockTimingSafeEqual = timingSafeEqual as Mock;
const mockStakgraphWebhookService = StakgraphWebhookService as Mock;

// Test helpers
const TestHelpers = {
  createWebhookRequest: (payload: WebhookPayload, signature?: string) => {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    
    if (signature) {
      headers["x-signature"] = signature;
    }
    
    if (payload.request_id) {
      headers["x-request-id"] = payload.request_id;
    }

    return new NextRequest("http://localhost:3000/api/swarm/stakgraph/webhook", {
      method: "POST",
      headers,
      body,
    });
  },

  expectUnauthorizedResponse: async (response: Response) => {
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.message).toBe("Missing signature");
  },

  expectBadRequestResponse: async (response: Response, expectedMessage?: string) => {
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
    if (expectedMessage) {
      expect(data.message).toBe(expectedMessage);
    }
  },

  expectSuccessResponse: async (response: Response) => {
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
  },
};

// Mock setup helpers
const MockSetup = {
  reset: () => {
    vi.clearAllMocks();
  },

  setupSuccessfulWebhook: () => {
    const swarm = TestDataFactory.createValidSwarm();
    const mockProcessWebhook = vi.fn().mockResolvedValue({
      success: true,
      status: 200,
    });

    mockDbSwarmFindFirst.mockResolvedValue(swarm);
    mockComputeHmacSha256Hex.mockReturnValue("valid-signature-hash");
    mockTimingSafeEqual.mockReturnValue(true);
    
    mockStakgraphWebhookService.mockImplementation(() => ({
      processWebhook: mockProcessWebhook,
    }));

    return { swarm, mockProcessWebhook };
  },

  setupInvalidSignature: () => {
    const swarm = TestDataFactory.createValidSwarm();
    mockDbSwarmFindFirst.mockResolvedValue(swarm);
    mockComputeHmacSha256Hex.mockReturnValue("expected-signature");
    mockTimingSafeEqual.mockReturnValue(false);
  },
};

describe("POST /api/swarm/stakgraph/webhook - Unit Tests", () => {
  beforeEach(() => {
    MockSetup.reset();
  });

  describe("Request Validation", () => {
    test("should reject requests without signature header", async () => {
      const payload = TestDataFactory.createValidWebhookPayload();
      const request = TestHelpers.createWebhookRequest(payload);

      const response = await POST(request);

      await TestHelpers.expectUnauthorizedResponse(response);
      expect(mockDbSwarmFindFirst).not.toHaveBeenCalled();
    });

    test("should reject requests with invalid JSON body", async () => {
      const request = new NextRequest("http://localhost:3000/api/swarm/stakgraph/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-signature": "sha256=valid-signature",
        },
        body: "invalid-json{",
      });

      const response = await POST(request);

      await TestHelpers.expectBadRequestResponse(response, "Invalid JSON");
      expect(mockDbSwarmFindFirst).not.toHaveBeenCalled();
    });

    test("should accept requests with valid signature and payload", async () => {
      MockSetup.setupSuccessfulWebhook();
      const payload = TestDataFactory.createValidWebhookPayload();
      const request = TestHelpers.createWebhookRequest(payload, "sha256=valid-signature");

      const response = await POST(request);

      expect(response.status).toBe(200);
    });

    test("should extract request_id from x-request-id header", async () => {
      const { mockProcessWebhook } = MockSetup.setupSuccessfulWebhook();
      const payload = TestDataFactory.createValidWebhookPayload();
      const request = TestHelpers.createWebhookRequest(payload, "sha256=valid-signature");

      await POST(request);

      expect(mockProcessWebhook).toHaveBeenCalledWith(
        "sha256=valid-signature",
        expect.any(String),
        expect.objectContaining({ request_id: "ingest-req-123" }),
        "ingest-req-123"
      );
    });

    test("should extract request_id from idempotency-key header as fallback", async () => {
      const { mockProcessWebhook } = MockSetup.setupSuccessfulWebhook();
      const payload = TestDataFactory.createValidWebhookPayload();
      const body = JSON.stringify(payload);
      
      const request = new NextRequest("http://localhost:3000/api/swarm/stakgraph/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-signature": "sha256=valid-signature",
          "idempotency-key": "idempotency-123",
        },
        body,
      });

      await POST(request);

      expect(mockProcessWebhook).toHaveBeenCalledWith(
        "sha256=valid-signature",
        expect.any(String),
        expect.objectContaining({ request_id: "ingest-req-123" }),
        "idempotency-123"
      );
    });
  });

  describe("Webhook Payload Processing", () => {
    test("should process InProgress status payload", async () => {
      const { mockProcessWebhook } = MockSetup.setupSuccessfulWebhook();
      const payload = TestDataFactory.createValidWebhookPayload();
      const request = TestHelpers.createWebhookRequest(payload, "sha256=valid-signature");

      const response = await POST(request);

      await TestHelpers.expectSuccessResponse(response);
      expect(mockProcessWebhook).toHaveBeenCalledWith(
        "sha256=valid-signature",
        expect.any(String),
        expect.objectContaining({
          request_id: "ingest-req-123",
          status: "InProgress",
          progress: 50,
        }),
        "ingest-req-123"
      );
    });

    test("should process Complete status payload", async () => {
      const { mockProcessWebhook } = MockSetup.setupSuccessfulWebhook();
      const payload = TestDataFactory.createCompleteWebhookPayload();
      const request = TestHelpers.createWebhookRequest(payload, "sha256=valid-signature");

      const response = await POST(request);

      await TestHelpers.expectSuccessResponse(response);
      expect(mockProcessWebhook).toHaveBeenCalledWith(
        "sha256=valid-signature",
        expect.any(String),
        expect.objectContaining({
          request_id: "ingest-req-456",
          status: "Complete",
          progress: 100,
          result: { nodes: 1234, edges: 5678 },
        }),
        expect.any(String)
      );
    });

    test("should process Failed status payload", async () => {
      const { mockProcessWebhook } = MockSetup.setupSuccessfulWebhook();
      const payload = TestDataFactory.createFailedWebhookPayload();
      const request = TestHelpers.createWebhookRequest(payload, "sha256=valid-signature");

      const response = await POST(request);

      await TestHelpers.expectSuccessResponse(response);
      expect(mockProcessWebhook).toHaveBeenCalledWith(
        "sha256=valid-signature",
        expect.any(String),
        expect.objectContaining({
          request_id: "ingest-req-789",
          status: "Failed",
          error: "Repository not accessible",
        }),
        expect.any(String)
      );
    });

    test("should handle missing request_id in payload", async () => {
      const mockProcessWebhook = vi.fn().mockResolvedValue({
        success: false,
        status: 400,
        message: "Missing request_id",
      });

      mockStakgraphWebhookService.mockImplementation(() => ({
        processWebhook: mockProcessWebhook,
      }));

      const payload = { status: "Complete", progress: 100 } as WebhookPayload;
      const request = TestHelpers.createWebhookRequest(payload, "sha256=valid-signature");

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Missing request_id");
    });
  });

  describe("Signature Verification", () => {
    test("should reject webhooks with invalid signature", async () => {
      const mockProcessWebhook = vi.fn().mockResolvedValue({
        success: false,
        status: 401,
        message: "Unauthorized",
      });

      mockStakgraphWebhookService.mockImplementation(() => ({
        processWebhook: mockProcessWebhook,
      }));

      const payload = TestDataFactory.createValidWebhookPayload();
      const request = TestHelpers.createWebhookRequest(payload, "sha256=invalid-signature");

      const response = await POST(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
    });

    test("should handle signature with sha256= prefix", async () => {
      const { mockProcessWebhook } = MockSetup.setupSuccessfulWebhook();
      const payload = TestDataFactory.createValidWebhookPayload();
      const request = TestHelpers.createWebhookRequest(payload, "sha256=valid-signature-hash");

      const response = await POST(request);

      await TestHelpers.expectSuccessResponse(response);
      expect(mockProcessWebhook).toHaveBeenCalledWith(
        "sha256=valid-signature-hash",
        expect.any(String),
        expect.any(Object),
        expect.any(String)
      );
    });

    test("should handle signature without sha256= prefix", async () => {
      const { mockProcessWebhook } = MockSetup.setupSuccessfulWebhook();
      const payload = TestDataFactory.createValidWebhookPayload();
      const request = TestHelpers.createWebhookRequest(payload, "valid-signature-hash");

      const response = await POST(request);

      await TestHelpers.expectSuccessResponse(response);
      expect(mockProcessWebhook).toHaveBeenCalledWith(
        "valid-signature-hash",
        expect.any(String),
        expect.any(Object),
        expect.any(String)
      );
    });
  });

  describe("Service Integration", () => {
    test("should delegate processing to StakgraphWebhookService", async () => {
      const { mockProcessWebhook } = MockSetup.setupSuccessfulWebhook();
      const payload = TestDataFactory.createValidWebhookPayload();
      const request = TestHelpers.createWebhookRequest(payload, "sha256=valid-signature");

      await POST(request);

      expect(mockProcessWebhook).toHaveBeenCalledTimes(1);
      expect(mockProcessWebhook).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(Object),
        expect.any(String)
      );
    });

    test("should pass raw body string to processWebhook", async () => {
      const { mockProcessWebhook } = MockSetup.setupSuccessfulWebhook();
      const payload = TestDataFactory.createValidWebhookPayload();
      const expectedBody = JSON.stringify(payload);
      const request = TestHelpers.createWebhookRequest(payload, "sha256=valid-signature");

      await POST(request);

      expect(mockProcessWebhook).toHaveBeenCalledWith(
        expect.any(String),
        expectedBody,
        expect.any(Object),
        expect.any(String)
      );
    });

    test("should return service error responses", async () => {
      const mockProcessWebhook = vi.fn().mockResolvedValue({
        success: false,
        status: 404,
        message: "Swarm not found",
      });

      mockStakgraphWebhookService.mockImplementation(() => ({
        processWebhook: mockProcessWebhook,
      }));

      const payload = TestDataFactory.createValidWebhookPayload();
      const request = TestHelpers.createWebhookRequest(payload, "sha256=valid-signature");

      const response = await POST(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Swarm not found");
    });
  });

  describe("Error Handling", () => {
    test("should handle service processing errors", async () => {
      const mockProcessWebhook = vi.fn().mockRejectedValue(new Error("Database connection failed"));

      mockStakgraphWebhookService.mockImplementation(() => ({
        processWebhook: mockProcessWebhook,
      }));

      const payload = TestDataFactory.createValidWebhookPayload();
      const request = TestHelpers.createWebhookRequest(payload, "sha256=valid-signature");

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Failed to process webhook");
    });

    test("should handle unexpected errors gracefully", async () => {
      const mockProcessWebhook = vi.fn().mockImplementation(() => {
        throw new Error("Unexpected error");
      });

      mockStakgraphWebhookService.mockImplementation(() => ({
        processWebhook: mockProcessWebhook,
      }));

      const payload = TestDataFactory.createValidWebhookPayload();
      const request = TestHelpers.createWebhookRequest(payload, "sha256=valid-signature");

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toBe("Failed to process webhook");
    });

    test("should not expose internal error details in response", async () => {
      const mockProcessWebhook = vi.fn().mockRejectedValue(
        new Error("Internal error with sensitive data: api-key-12345")
      );

      mockStakgraphWebhookService.mockImplementation(() => ({
        processWebhook: mockProcessWebhook,
      }));

      const payload = TestDataFactory.createValidWebhookPayload();
      const request = TestHelpers.createWebhookRequest(payload, "sha256=valid-signature");

      const response = await POST(request);
      const responseText = await response.text();

      expect(responseText).not.toContain("api-key-12345");
      expect(responseText).toContain("Failed to process webhook");
    });
  });

  describe("Logging and Observability", () => {
    test("should log webhook receipt", async () => {
      const consoleSpy = vi.spyOn(console, "log");
      MockSetup.setupSuccessfulWebhook();
      
      const payload = TestDataFactory.createValidWebhookPayload();
      const request = TestHelpers.createWebhookRequest(payload, "sha256=valid-signature");

      await POST(request);

      expect(consoleSpy).toHaveBeenCalledWith("STAKGRAPH WEBHOOK RECEIVED");
      consoleSpy.mockRestore();
    });

    test("should log webhook payload", async () => {
      const consoleSpy = vi.spyOn(console, "log");
      MockSetup.setupSuccessfulWebhook();
      
      const payload = TestDataFactory.createValidWebhookPayload();
      const request = TestHelpers.createWebhookRequest(payload, "sha256=valid-signature");

      await POST(request);

      expect(consoleSpy).toHaveBeenCalledWith("HIVE - WEBHOOK PAYLOAD RECEIVED", expect.objectContaining({
        request_id: "ingest-req-123",
        status: "InProgress",
      }));
      consoleSpy.mockRestore();
    });

    test("should log JSON parsing errors", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error");
      
      const request = new NextRequest("http://localhost:3000/api/swarm/stakgraph/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-signature": "sha256=valid-signature",
        },
        body: "invalid{json",
      });

      await POST(request);

      expect(consoleErrorSpy).toHaveBeenCalledWith("Error parsing JSON:", expect.any(Error));
      consoleErrorSpy.mockRestore();
    });
  });
});