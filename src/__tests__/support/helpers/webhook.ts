import { NextRequest } from "next/server";
import type { WebhookPayload } from "@/types";

/**
 * Webhook test helpers for creating requests and asserting responses
 */
export const webhookTestHelpers = {
  /**
   * Create a webhook request for testing
   */
  createWebhookRequest: (payload: WebhookPayload, signature?: string): NextRequest => {
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

  /**
   * Create a webhook request with explicit headers (for integration tests)
   */
  createIntegrationWebhookRequest: (payload: WebhookPayload, signature: string): Request => {
    const body = JSON.stringify(payload);
    return new Request("http://localhost:3000/api/swarm/stakgraph/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-signature": signature,
        "x-request-id": payload.request_id,
      },
      body,
    }) as any;
  },

  /**
   * Assert unauthorized response
   */
  expectUnauthorizedResponse: async (response: Response, expectedMessage: string = "Missing signature") => {
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.message).toBe(expectedMessage);
  },

  /**
   * Assert bad request response
   */
  expectBadRequestResponse: async (response: Response, expectedMessage?: string) => {
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.success).toBe(false);
    if (expectedMessage) {
      expect(data.message).toBe(expectedMessage);
    }
  },

  /**
   * Assert success response
   */
  expectSuccessResponse: async (response: Response) => {
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
  },

  /**
   * Assert error response with specific status
   */
  expectErrorResponse: async (response: Response, expectedStatus: number, expectedMessage?: string) => {
    expect(response.status).toBe(expectedStatus);
    const data = await response.json();
    expect(data.success).toBe(false);
    if (expectedMessage) {
      expect(data.message).toBe(expectedMessage);
    }
  },
};
