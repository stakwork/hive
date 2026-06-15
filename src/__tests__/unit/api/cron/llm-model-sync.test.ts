import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";

vi.mock("@/lib/db");
vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
    STAKWORK_API_KEY: "test-stakwork-api-key",
    STAKWORK_WORKFLOW_ID_LLM_SYNC: "12345",
  },
}));

const mockedDb = vi.mocked(db);

const mockModels = [
  { id: "1", name: "claude-3-5-sonnet", provider: "ANTHROPIC" },
  { id: "2", name: "gpt-4o", provider: "OPENAI" },
];

function makeRequest(authHeader?: string): NextRequest {
  return new NextRequest("http://localhost/api/cron/llm-model-sync", {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

describe("LLM Model Sync Cron — vercel.json configuration", () => {
  it("should have llm-model-sync cron job configured", () => {
    const vercelPath = path.join(process.cwd(), "vercel.json");
    expect(fs.existsSync(vercelPath)).toBe(true);

    const vercelConfig = JSON.parse(fs.readFileSync(vercelPath, "utf8"));
    expect(vercelConfig.crons).toBeDefined();
    expect(Array.isArray(vercelConfig.crons)).toBe(true);

    const cron = vercelConfig.crons.find(
      (c: { path: string; schedule: string }) => c.path === "/api/cron/llm-model-sync",
    );
    expect(cron).toBeDefined();
    expect(cron.schedule).toBe("0 1 * * *");
  });

  it("should have a valid 5-part cron schedule", () => {
    const vercelPath = path.join(process.cwd(), "vercel.json");
    const vercelConfig = JSON.parse(fs.readFileSync(vercelPath, "utf8"));
    const cron = vercelConfig.crons.find(
      (c: { path: string; schedule: string }) => c.path === "/api/cron/llm-model-sync",
    );
    expect(cron.schedule.split(" ")).toHaveLength(5);
  });
});

describe("GET /api/cron/llm-model-sync", () => {
  let GET: (req: NextRequest) => Promise<Response>;
  const originalCronSecret = process.env.CRON_SECRET;

  beforeEach(async () => {
    vi.resetModules();
    process.env.CRON_SECRET = "test-secret";
    vi.stubGlobal("fetch", vi.fn());
    const mod = await import("@/app/api/cron/llm-model-sync/route");
    GET = mod.GET;
  });

  afterEach(() => {
    process.env.CRON_SECRET = originalCronSecret;
    vi.unstubAllGlobals();
  });

  it("returns 401 when Authorization header is missing", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 401 when Authorization header has wrong secret", async () => {
    const res = await GET(makeRequest("Bearer wrong-secret"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
  });

  it("calls db.llmModel.findMany and POSTs correct payload to Stakwork on success", async () => {
    mockedDb.llmModel.findMany = vi.fn().mockResolvedValue(mockModels);
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 999 }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(200);

    expect(mockedDb.llmModel.findMany).toHaveBeenCalledWith({ orderBy: { name: "asc" } });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.stakwork.com/api/v1/projects");
    expect(opts.method).toBe("POST");
    expect(opts.headers["Authorization"]).toBe("Token token=test-stakwork-api-key");
    expect(opts.headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(opts.body);
    expect(body.name).toBe("llm-model-sync");
    expect(typeof body.workflow_id).toBe("number");
    expect(body.workflow_id).toBe(12345);
    expect(body.workflow_params.set_var.attributes.vars.models).toEqual(mockModels);
  });

  it("returns { success: true, modelCount, timestamp } on success", async () => {
    mockedDb.llmModel.findMany = vi.fn().mockResolvedValue(mockModels);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
    );

    const res = await GET(makeRequest("Bearer test-secret"));
    const body = await res.json();

    expect(body.success).toBe(true);
    expect(body.modelCount).toBe(mockModels.length);
    expect(typeof body.timestamp).toBe("string");
  });

  it("returns 500 when fetch throws", async () => {
    mockedDb.llmModel.findMany = vi.fn().mockResolvedValue(mockModels);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("Network error");
  });

  it("returns 500 when Stakwork responds with non-ok status", async () => {
    mockedDb.llmModel.findMany = vi.fn().mockResolvedValue(mockModels);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 422, statusText: "Unprocessable Entity" }),
    );

    const res = await GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("422");
  });

  it("returns 500 when STAKWORK_WORKFLOW_ID_LLM_SYNC is not set", async () => {
    vi.resetModules();
    vi.doMock("@/config/env", () => ({
      config: {
        STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
        STAKWORK_API_KEY: "test-stakwork-api-key",
        STAKWORK_WORKFLOW_ID_LLM_SYNC: undefined,
      },
    }));
    mockedDb.llmModel.findMany = vi.fn().mockResolvedValue(mockModels);
    const mod = await import("@/app/api/cron/llm-model-sync/route");

    const res = await mod.GET(makeRequest("Bearer test-secret"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain("STAKWORK_WORKFLOW_ID_LLM_SYNC");
  });
});
