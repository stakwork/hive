import { describe, it, expect, beforeEach } from "vitest";
import { db } from "@/lib/db";
import { createTestUser, createTestLlmModel } from "@/__tests__/support/factories";
import {
  createAuthenticatedGetRequest,
  createAuthenticatedPostRequest,
  createAuthenticatedPatchRequest,
  createAuthenticatedDeleteRequest,
} from "@/__tests__/support/helpers/request-builders";

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
});
