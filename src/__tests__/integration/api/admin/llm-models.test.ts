import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { createTestUser, createTestLlmModel } from "@/__tests__/support/factories";
import {
  createAuthenticatedGetRequest,
  createAuthenticatedPostRequest,
  createAuthenticatedPatchRequest,
  createAuthenticatedDeleteRequest,
  createRequestWithHeaders,
} from "@/__tests__/support/helpers/request-builders";

const TEST_LLM_SYNC_TOKEN = "test-llm-sync-token";

function createRequestWithApiToken(url: string, token: string, body?: object) {
  return createRequestWithHeaders(
    url,
    body ? "POST" : "POST",
    { "x-api-token": token, "content-type": "application/json" },
    body,
  );
}

function createPatchRequestWithApiToken(url: string, token: string, body?: object) {
  return createRequestWithHeaders(
    url,
    "PATCH",
    { "x-api-token": token, "content-type": "application/json" },
    body,
  );
}

describe("Admin LLM Models API", () => {
  let superAdminUser: { id: string; email: string; name: string };
  let regularUser: { id: string; email: string; name: string };

  beforeEach(async () => {
    superAdminUser = await createTestUser({
      role: "SUPER_ADMIN",
      email: "superadmin-llm@test.com",
      name: "Super Admin LLM",
    });
    regularUser = await createTestUser({
      role: "USER",
      email: "regular-llm@test.com",
      name: "Regular LLM",
    });
  });

  describe("GET /api/admin/llm-models", () => {
    it("should return 403 for regular user", async () => {
      const request = createAuthenticatedGetRequest(
        "/api/admin/llm-models",
        regularUser
      );
      const { GET } = await import("@/app/api/admin/llm-models/route");
      const response = await GET(request);

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe("Forbidden");
    });

    it("should return 200 with models array for superadmin", async () => {
      await createTestLlmModel({ name: "gemini-1.5-pro", provider: "GOOGLE" });
      await createTestLlmModel({ name: "claude-3-5-sonnet", provider: "ANTHROPIC" });

      const request = createAuthenticatedGetRequest(
        "/api/admin/llm-models",
        superAdminUser
      );
      const { GET } = await import("@/app/api/admin/llm-models/route");
      const response = await GET(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data.models)).toBe(true);
      const names = data.models.map((m: { name: string }) => m.name);
      expect(names).toContain("gemini-1.5-pro");
      expect(names).toContain("claude-3-5-sonnet");
    });
  });

  describe("POST /api/admin/llm-models", () => {
    it("should return 403 for regular user", async () => {
      const request = createAuthenticatedPostRequest(
        "/api/admin/llm-models",
        regularUser,
        { name: "gpt-4o", provider: "OPENAI", inputPricePer1M: 5, outputPricePer1M: 15 }
      );
      const { POST } = await import("@/app/api/admin/llm-models/route");
      const response = await POST(request);

      expect(response.status).toBe(403);
    });

    it("should create a record and return it for superadmin", async () => {
      const request = createAuthenticatedPostRequest(
        "/api/admin/llm-models",
        superAdminUser,
        {
          name: "gpt-4o",
          provider: "OPENAI",
          inputPricePer1M: 5.0,
          outputPricePer1M: 15.0,
        }
      );
      const { POST } = await import("@/app/api/admin/llm-models/route");
      const response = await POST(request);

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.model.name).toBe("gpt-4o");
      expect(data.model.provider).toBe("OPENAI");
      expect(data.model.inputPricePer1M).toBe(5.0);
      expect(data.model.outputPricePer1M).toBe(15.0);

      const dbRecord = await db.llmModel.findUnique({ where: { id: data.model.id } });
      expect(dbRecord).not.toBeNull();
    });

    it("should create a record with isPublic: true and persist it", async () => {
      const request = createAuthenticatedPostRequest(
        "/api/admin/llm-models",
        superAdminUser,
        {
          name: "public-model",
          provider: "OPENAI",
          inputPricePer1M: 5.0,
          outputPricePer1M: 15.0,
          isPublic: true,
        }
      );
      const { POST } = await import("@/app/api/admin/llm-models/route");
      const response = await POST(request);

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.model.isPublic).toBe(true);

      const dbRecord = await db.llmModel.findUnique({ where: { id: data.model.id } });
      expect(dbRecord?.isPublic).toBe(true);
    });

    it("should default isPublic to false when not provided", async () => {
      const request = createAuthenticatedPostRequest(
        "/api/admin/llm-models",
        superAdminUser,
        {
          name: "default-public-model",
          provider: "OPENAI",
          inputPricePer1M: 5.0,
          outputPricePer1M: 15.0,
        }
      );
      const { POST } = await import("@/app/api/admin/llm-models/route");
      const response = await POST(request);

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.model.isPublic).toBe(false);
    });

    it("should return 400 when required fields are missing", async () => {
      const request = createAuthenticatedPostRequest(
        "/api/admin/llm-models",
        superAdminUser,
        { name: "incomplete-model" }
      );
      const { POST } = await import("@/app/api/admin/llm-models/route");
      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it("should create a record with optional fields", async () => {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      const request = createAuthenticatedPostRequest(
        "/api/admin/llm-models",
        superAdminUser,
        {
          name: "gemini-1.5-pro",
          provider: "GOOGLE",
          inputPricePer1M: 3.5,
          outputPricePer1M: 10.5,
          dateStart: sixMonthsAgo.toISOString(),
        }
      );
      const { POST } = await import("@/app/api/admin/llm-models/route");
      const response = await POST(request);

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(data.model.dateStart).toBeDefined();
      expect(data.model.dateEnd).toBeNull();
    });
  });

  describe("PATCH /api/admin/llm-models/[id]", () => {
    it("should return 403 for regular user", async () => {
      const model = await createTestLlmModel();
      const request = createAuthenticatedPatchRequest(
        `/api/admin/llm-models/${model.id}`,
        { name: "updated-name" },
        regularUser
      );
      const { PATCH } = await import("@/app/api/admin/llm-models/[id]/route");
      const response = await PATCH(request, {
        params: Promise.resolve({ id: model.id }),
      });

      expect(response.status).toBe(403);
    });

    it("should update and return the record for superadmin", async () => {
      const model = await createTestLlmModel({ name: "original-name", provider: "OPENAI" });
      const request = createAuthenticatedPatchRequest(
        `/api/admin/llm-models/${model.id}`,
        { name: "updated-name", inputPricePer1M: 7.5 },
        superAdminUser
      );
      const { PATCH } = await import("@/app/api/admin/llm-models/[id]/route");
      const response = await PATCH(request, {
        params: Promise.resolve({ id: model.id }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.model.name).toBe("updated-name");
      expect(data.model.inputPricePer1M).toBe(7.5);
    });

    it("should toggle isPublic to true via PATCH", async () => {
      const model = await createTestLlmModel({ name: "toggle-public-model", provider: "OPENAI" });
      expect(model.isPublic).toBe(false);

      const request = createAuthenticatedPatchRequest(
        `/api/admin/llm-models/${model.id}`,
        { isPublic: true },
        superAdminUser
      );
      const { PATCH } = await import("@/app/api/admin/llm-models/[id]/route");
      const response = await PATCH(request, {
        params: Promise.resolve({ id: model.id }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.model.isPublic).toBe(true);

      const dbRecord = await db.llmModel.findUnique({ where: { id: model.id } });
      expect(dbRecord?.isPublic).toBe(true);
    });

    it("should toggle isPublic back to false via PATCH", async () => {
      const model = await createTestLlmModel({ name: "revert-public-model", provider: "OPENAI", isPublic: true });
      expect(model.isPublic).toBe(true);

      const request = createAuthenticatedPatchRequest(
        `/api/admin/llm-models/${model.id}`,
        { isPublic: false },
        superAdminUser
      );
      const { PATCH } = await import("@/app/api/admin/llm-models/[id]/route");
      const response = await PATCH(request, {
        params: Promise.resolve({ id: model.id }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.model.isPublic).toBe(false);
    });

    it("should return 404 for unknown id", async () => {
      const fakeId = "cm00000000000000000000000";
      const request = createAuthenticatedPatchRequest(
        `/api/admin/llm-models/${fakeId}`,
        { name: "nope" },
        superAdminUser
      );
      const { PATCH } = await import("@/app/api/admin/llm-models/[id]/route");
      const response = await PATCH(request, {
        params: Promise.resolve({ id: fakeId }),
      });

      expect(response.status).toBe(404);
    });
  });

  describe("DELETE /api/admin/llm-models/[id]", () => {
    it("should return 403 for regular user", async () => {
      const model = await createTestLlmModel();
      const request = createAuthenticatedDeleteRequest(
        `/api/admin/llm-models/${model.id}`,
        regularUser
      );
      const { DELETE } = await import("@/app/api/admin/llm-models/[id]/route");
      const response = await DELETE(request, {
        params: Promise.resolve({ id: model.id }),
      });

      expect(response.status).toBe(403);
    });

    it("should delete the record for superadmin", async () => {
      const model = await createTestLlmModel({ name: "to-delete" });
      const request = createAuthenticatedDeleteRequest(
        `/api/admin/llm-models/${model.id}`,
        superAdminUser
      );
      const { DELETE } = await import("@/app/api/admin/llm-models/[id]/route");
      const response = await DELETE(request, {
        params: Promise.resolve({ id: model.id }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);

      const dbRecord = await db.llmModel.findUnique({ where: { id: model.id } });
      expect(dbRecord).toBeNull();
    });

    it("should return 404 for unknown id", async () => {
      const fakeId = "cm00000000000000000000000";
      const request = createAuthenticatedDeleteRequest(
        `/api/admin/llm-models/${fakeId}`,
        superAdminUser
      );
      const { DELETE } = await import("@/app/api/admin/llm-models/[id]/route");
      const response = await DELETE(request, {
        params: Promise.resolve({ id: fakeId }),
      });

      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/admin/llm-models — LLM_SYNC_API_TOKEN batch upsert", () => {
    beforeEach(() => {
      process.env.LLM_SYNC_API_TOKEN = TEST_LLM_SYNC_TOKEN;
    });

    it("should upsert all models and return 201 with valid token + batch body", async () => {
      const request = createRequestWithApiToken("/api/admin/llm-models", TEST_LLM_SYNC_TOKEN, {
        models: [
          { name: "sync-model-a", provider: "OPENAI", inputPricePer1M: 1.0, outputPricePer1M: 2.0 },
          { name: "sync-model-b", provider: "ANTHROPIC", inputPricePer1M: 3.0, outputPricePer1M: 6.0, providerLabel: "Anthropic" },
        ],
      });
      const { POST } = await import("@/app/api/admin/llm-models/route");
      const response = await POST(request);

      expect(response.status).toBe(201);
      const data = await response.json();
      expect(Array.isArray(data.models)).toBe(true);
      expect(data.models).toHaveLength(2);
      const names = data.models.map((m: { name: string }) => m.name);
      expect(names).toContain("sync-model-a");
      expect(names).toContain("sync-model-b");

      const dbA = await db.llmModel.findUnique({ where: { name: "sync-model-a" } });
      expect(dbA).not.toBeNull();
      expect(dbA?.inputPricePer1M).toBe(1.0);
    });

    it("should update pricing but leave admin flags unchanged on second upsert call", async () => {
      // First upsert — creates records
      const firstRequest = createRequestWithApiToken("/api/admin/llm-models", TEST_LLM_SYNC_TOKEN, {
        models: [
          { name: "sync-idempotent-model", provider: "GOOGLE", inputPricePer1M: 1.0, outputPricePer1M: 2.0 },
        ],
      });
      const { POST } = await import("@/app/api/admin/llm-models/route");
      await POST(firstRequest);

      // Manually set admin flags
      await db.llmModel.update({
        where: { name: "sync-idempotent-model" },
        data: { isPlanDefault: true, isPublic: true },
      });

      // Second upsert — should update pricing, not overwrite flags
      const secondRequest = createRequestWithApiToken("/api/admin/llm-models", TEST_LLM_SYNC_TOKEN, {
        models: [
          { name: "sync-idempotent-model", provider: "GOOGLE", inputPricePer1M: 9.99, outputPricePer1M: 19.99 },
        ],
      });
      const response = await POST(secondRequest);

      expect(response.status).toBe(201);
      const dbRecord = await db.llmModel.findUnique({ where: { name: "sync-idempotent-model" } });
      expect(dbRecord?.inputPricePer1M).toBe(9.99);
      expect(dbRecord?.outputPricePer1M).toBe(19.99);
      expect(dbRecord?.isPlanDefault).toBe(true);
      expect(dbRecord?.isPublic).toBe(true);
    });

    it("should return 400 when a batch item is missing a required field", async () => {
      const request = createRequestWithApiToken("/api/admin/llm-models", TEST_LLM_SYNC_TOKEN, {
        models: [
          { name: "missing-provider-model", inputPricePer1M: 1.0, outputPricePer1M: 2.0 },
        ],
      });
      const { POST } = await import("@/app/api/admin/llm-models/route");
      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBeDefined();
    });

    it("should return 401 with invalid token and no session", async () => {
      const request = createRequestWithApiToken("/api/admin/llm-models", "wrong-token", {
        models: [
          { name: "should-not-create", provider: "OPENAI", inputPricePer1M: 1.0, outputPricePer1M: 2.0 },
        ],
      });
      const { POST } = await import("@/app/api/admin/llm-models/route");
      const response = await POST(request);

      expect(response.status).toBe(401);
    });
  });

  describe("PATCH /api/admin/llm-models/[id] — LLM_SYNC_API_TOKEN auth", () => {
    beforeEach(() => {
      process.env.LLM_SYNC_API_TOKEN = TEST_LLM_SYNC_TOKEN;
    });

    it("should update and return 200 with valid LLM_SYNC_API_TOKEN", async () => {
      const model = await createTestLlmModel({ name: "sync-patch-model", provider: "OPENAI" });
      const request = createPatchRequestWithApiToken(
        `/api/admin/llm-models/${model.id}`,
        TEST_LLM_SYNC_TOKEN,
        { inputPricePer1M: 42.0 },
      );
      const { PATCH } = await import("@/app/api/admin/llm-models/[id]/route");
      const response = await PATCH(request, {
        params: Promise.resolve({ id: model.id }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.model.inputPricePer1M).toBe(42.0);
    });

    it("should return 401 with invalid token and no session", async () => {
      const model = await createTestLlmModel({ name: "sync-patch-unauthorized", provider: "OPENAI" });
      const request = createPatchRequestWithApiToken(
        `/api/admin/llm-models/${model.id}`,
        "wrong-token",
        { inputPricePer1M: 99.0 },
      );
      const { PATCH } = await import("@/app/api/admin/llm-models/[id]/route");
      const response = await PATCH(request, {
        params: Promise.resolve({ id: model.id }),
      });

      expect(response.status).toBe(401);
    });
  });
});
