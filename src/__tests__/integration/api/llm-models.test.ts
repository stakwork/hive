/**
 * Integration tests for GET /api/llm-models
 *
 * Tests the LLM model pricing endpoint including:
 * - Authentication via x-api-token header
 * - Authentication via session (middleware context)
 * - Returns only active LLM model records
 * - Expired models are excluded
 * - Only models with isPublic: true are returned
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { createTestLlmModel } from "@/__tests__/support/factories/llm-model.factory";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import {
  createAuthenticatedGetRequest,
} from "@/__tests__/support/helpers/request-builders";
import { GET } from "@/app/api/llm-models/route";
import type { LlmModel, User } from "@prisma/client";

const VALID_API_TOKEN = "test-api-token";

function createGetRequest(token?: string) {
  const headers: Record<string, string> = {};
  if (token !== undefined) {
    headers["x-api-token"] = token;
  }
  return new Request("http://localhost:3000/api/llm-models", { headers });
}

describe("GET /api/llm-models - Integration Tests", () => {
  let seededModels: LlmModel[] = [];
  let testUser: User;

  beforeEach(async () => {
    process.env.API_TOKEN = VALID_API_TOKEN;

    testUser = await createTestUser();

    const now = new Date();
    const pastDate = new Date(now.getTime() - 1000 * 60 * 60 * 24); // yesterday
    const futureDate = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 30); // 30 days from now

    seededModels = await Promise.all([
      createTestLlmModel({
        name: "gpt-4o",
        provider: "OPENAI",
        providerLabel: "OpenAI",
        inputPricePer1M: 5.0,
        outputPricePer1M: 15.0,
        dateEnd: null,
        isPublic: true,
      }),
      createTestLlmModel({
        name: "claude-3-5-sonnet",
        provider: "ANTHROPIC",
        providerLabel: "Anthropic",
        inputPricePer1M: 3.0,
        outputPricePer1M: 15.0,
        dateEnd: futureDate,
        isPublic: true,
      }),
      createTestLlmModel({
        name: "expired-model",
        provider: "GOOGLE",
        providerLabel: "Google",
        inputPricePer1M: 1.0,
        outputPricePer1M: 2.0,
        dateEnd: pastDate,
        isPublic: true,
      }),
    ]);
  });

  afterEach(async () => {
    await db.llmModel.deleteMany({
      where: { id: { in: seededModels.map((m) => m.id) } },
    });
    await db.user.deleteMany({ where: { id: testUser.id } });
    seededModels = [];
  });

  describe("Authentication", () => {
    test("returns 401 when no token and no session", async () => {
      const request = createGetRequest();
      const response = await GET(request as any);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toHaveProperty("error");
    });

    test("returns 401 when x-api-token is invalid", async () => {
      const request = createGetRequest("invalid-token");
      const response = await GET(request as any);

      expect(response.status).toBe(401);
    });

    test("returns 200 with valid x-api-token", async () => {
      const request = createGetRequest(VALID_API_TOKEN);
      const response = await GET(request as any);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty("models");
    });

    test("returns 200 with valid session auth", async () => {
      const request = createAuthenticatedGetRequest(
        "http://localhost:3000/api/llm-models",
        testUser
      );
      const response = await GET(request as any);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty("models");
      expect(Array.isArray(data.models)).toBe(true);
    });
  });

  describe("Active-only filter", () => {
    test("excludes models with dateEnd in the past", async () => {
      const request = createGetRequest(VALID_API_TOKEN);
      const response = await GET(request as any);

      const data = await response.json();
      const returnedIds = data.models.map((m: { id: string }) => m.id);
      const expiredModel = seededModels.find((m) => m.name === "expired-model")!;

      expect(returnedIds).not.toContain(expiredModel.id);
    });

    test("includes models with dateEnd: null", async () => {
      const request = createGetRequest(VALID_API_TOKEN);
      const response = await GET(request as any);

      const data = await response.json();
      const returnedIds = data.models.map((m: { id: string }) => m.id);
      const nullEndModel = seededModels.find((m) => m.name === "gpt-4o")!;

      expect(returnedIds).toContain(nullEndModel.id);
    });

    test("includes models with future dateEnd", async () => {
      const request = createGetRequest(VALID_API_TOKEN);
      const response = await GET(request as any);

      const data = await response.json();
      const returnedIds = data.models.map((m: { id: string }) => m.id);
      const futureModel = seededModels.find((m) => m.name === "claude-3-5-sonnet")!;

      expect(returnedIds).toContain(futureModel.id);
    });

    test("session auth also returns only active models", async () => {
      const request = createAuthenticatedGetRequest(
        "http://localhost:3000/api/llm-models",
        testUser
      );
      const response = await GET(request as any);

      const data = await response.json();
      const returnedIds = data.models.map((m: { id: string }) => m.id);
      const expiredModel = seededModels.find((m) => m.name === "expired-model")!;

      expect(returnedIds).not.toContain(expiredModel.id);
    });
  });

  describe("isPublic filter", () => {
    test("excludes models with isPublic: false even when date is active", async () => {
      const privateModel = await createTestLlmModel({
        name: "private-model",
        provider: "OPENAI",
        inputPricePer1M: 1.0,
        outputPricePer1M: 2.0,
        dateEnd: null,
        isPublic: false,
      });
      seededModels.push(privateModel);

      const request = createGetRequest(VALID_API_TOKEN);
      const response = await GET(request as any);

      const data = await response.json();
      const returnedIds = data.models.map((m: { id: string }) => m.id);

      expect(returnedIds).not.toContain(privateModel.id);
    });

    test("includes models with isPublic: true and active date range", async () => {
      const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
      const publicModel = await createTestLlmModel({
        name: "public-active-model",
        provider: "GOOGLE",
        inputPricePer1M: 2.0,
        outputPricePer1M: 4.0,
        dateEnd: futureDate,
        isPublic: true,
      });
      seededModels.push(publicModel);

      const request = createGetRequest(VALID_API_TOKEN);
      const response = await GET(request as any);

      const data = await response.json();
      const returnedIds = data.models.map((m: { id: string }) => m.id);

      expect(returnedIds).toContain(publicModel.id);
    });

    test("returned models include isPublic field", async () => {
      const request = createGetRequest(VALID_API_TOKEN);
      const response = await GET(request as any);

      const data = await response.json();
      const seededActiveIds = seededModels
        .filter((m) => m.name !== "expired-model")
        .map((m) => m.id);
      const returnedModels = data.models.filter((m: { id: string }) =>
        seededActiveIds.includes(m.id)
      );

      for (const model of returnedModels) {
        expect(model).toHaveProperty("isPublic");
        expect(model.isPublic).toBe(true);
      }
    });
  });

  describe("Response shape", () => {
    test("returned models contain only selected fields", async () => {
      const request = createGetRequest(VALID_API_TOKEN);
      const response = await GET(request as any);

      const data = await response.json();
      const seededActiveIds = seededModels
        .filter((m) => m.name !== "expired-model")
        .map((m) => m.id);
      const returnedModels = data.models.filter((m: { id: string }) =>
        seededActiveIds.includes(m.id)
      );

      expect(returnedModels).toHaveLength(2);

      for (const model of returnedModels) {
        expect(model).toHaveProperty("id");
        expect(model).toHaveProperty("name");
        expect(model).toHaveProperty("provider");
        expect(model).toHaveProperty("providerLabel");
        expect(model).toHaveProperty("isPublic");
        // Pricing fields should NOT be in the response (select only returns id/name/provider/providerLabel)
        expect(model).not.toHaveProperty("inputPricePer1M");
        expect(model).not.toHaveProperty("outputPricePer1M");
        expect(model).not.toHaveProperty("createdAt");
      }
    });

    test("returns correct data for seeded models", async () => {
      const request = createGetRequest(VALID_API_TOKEN);
      const response = await GET(request as any);

      const data = await response.json();
      const seededIds = seededModels.map((m) => m.id);
      const returnedModels = data.models.filter((m: { id: string }) =>
        seededIds.includes(m.id)
      );

      const gpt4o = returnedModels.find((m: { name: string }) => m.name === "gpt-4o");
      expect(gpt4o).toBeDefined();
      expect(gpt4o.provider).toBe("OPENAI");
      expect(gpt4o.providerLabel).toBe("OpenAI");

      const claude = returnedModels.find(
        (m: { name: string }) => m.name === "claude-3-5-sonnet"
      );
      expect(claude).toBeDefined();
      expect(claude.provider).toBe("ANTHROPIC");
      expect(claude.providerLabel).toBe("Anthropic");
    });
  });
});
