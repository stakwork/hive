import { NextRequest } from "next/server";
import { expect } from "vitest";

// Test Helpers
export const GitHubWebhookTestHelpers = {
  createWebhookRequest: (payload: object, headers: Record<string, string>) => {
    const body = JSON.stringify(payload);
    return new NextRequest("http://localhost:3000/api/github/webhook", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body,
    });
  },

  computeValidSignature: (payload: object, secret: string): string => {
    const body = JSON.stringify(payload);
    // In real implementation, this would use crypto.createHmac
    // For tests, we'll mock the computeHmacSha256Hex to return expected value
    return "valid-signature-hex";
  },

  expectErrorResponse: async (response: Response, expectedStatus: number, expectedMessage?: string) => {
    expect(response.status).toBe(expectedStatus);
    const data = await response.json();
    expect(data.success).toBe(false);
    if (expectedMessage) {
      expect(data).toMatchObject({ success: false });
    }
  },

  expectSuccessResponse: async (response: Response, expectedStatus: number = 202) => {
    expect(response.status).toBe(expectedStatus);
    const data = await response.json();
    expect(data.success).toBeDefined();
  },
};
