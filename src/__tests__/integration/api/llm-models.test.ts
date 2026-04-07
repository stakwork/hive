/**
 * Integration tests for GET /api/llm-models
 *
 * Tests the LLM model pricing endpoint including:
 * - Authentication via x-api-token header
 * - Returns all LLM model records for a valid token
 * - Returned records contain all expected fields
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { createTestLlmModel } from "@/__tests__/support/factories/llm-model.factory";
import { GET } from "@/app/api/llm-models/route";
import type { LlmModel } from "@prisma/client";

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

  beforeEach(async () => {
    process.env.API_TOKEN = VALID_API_TOKEN;

    seededModels = await Promise.all([
      createTestLlmModel({
        name: "gpt-4o",
        provider: "OPENAI",
        providerLabel: "OpenAI",
        inputPricePer1M: 5.0,
        outputPricePer1M: 15.0,
      }),
      createTestLlmModel({
        name: "claude-3-5-sonnet",
        provider: "ANTHROPIC",
        providerLabel: "Anthropic",
        inputPricePer1M: 3.0,
        outputPricePer1M: 15.0,
      }),
    ]);
  });

  afterEach(async () => {
    await db.llmModel.deleteMany({
      where: { id: { in: seededModels.map((m) => m.id) } },
    });
    seededModels = [];
  });

  describe("Authentication", () => {
    test("returns 401 when x-api-token header is missing", async () => {
      const request = createGetRequest();
      const response = await GET(request as any);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toEqual({ error: "Unauthorized" });
    });

    test("returns 401 when x-api-token is invalid", async () => {
      const request = createGetRequest("invalid-token");
      const response = await GET(request as any);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toEqual({ error: "Unauthorized" });
    });
  });

  describe("Successful retrieval", () => {
    test("returns 200 with { models: [...] } for a valid token", async () => {
      const request = createGetRequest(VALID_API_TOKEN);
      const response = await GET(request as any);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty("models");
      expect(Array.isArray(data.models)).toBe(true);
    });

    test("returned models contain all expected fields", async () => {
      const request = createGetRequest(VALID_API_TOKEN);
      const response = await GET(request as any);

      const data = await response.json();
      const seededIds = seededModels.map((m) => m.id);
      const returnedModels = data.models.filter((m: LlmModel) =>
        seededIds.includes(m.id)
      );

      expect(returnedModels).toHaveLength(2);

      for (const model of returnedModels) {
        expect(model).toHaveProperty("id");
        expect(model).toHaveProperty("name");
        expect(model).toHaveProperty("provider");
        expect(model).toHaveProperty("providerLabel");
        expect(model).toHaveProperty("inputPricePer1M");
        expect(model).toHaveProperty("outputPricePer1M");
        expect(model).toHaveProperty("dateStart");
        expect(model).toHaveProperty("dateEnd");
        expect(model).toHaveProperty("createdAt");
        expect(model).toHaveProperty("updatedAt");
      }
    });

    test("returns seeded models with correct data", async () => {
      const request = createGetRequest(VALID_API_TOKEN);
      const response = await GET(request as any);

      const data = await response.json();
      const seededIds = seededModels.map((m) => m.id);
      const returnedModels = data.models.filter((m: LlmModel) =>
        seededIds.includes(m.id)
      );

      const gpt4o = returnedModels.find((m: LlmModel) => m.name === "gpt-4o");
      expect(gpt4o).toBeDefined();
      expect(gpt4o.provider).toBe("OPENAI");
      expect(gpt4o.providerLabel).toBe("OpenAI");
      expect(gpt4o.inputPricePer1M).toBe(5.0);
      expect(gpt4o.outputPricePer1M).toBe(15.0);

      const claude = returnedModels.find(
        (m: LlmModel) => m.name === "claude-3-5-sonnet"
      );
      expect(claude).toBeDefined();
      expect(claude.provider).toBe("ANTHROPIC");
      expect(claude.providerLabel).toBe("Anthropic");
    });
  });
});
