import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  db: {
    protectReviewRun: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/services/protect", async () => {
  const actual = await vi.importActual<typeof import("@/services/protect")>("@/services/protect");
  return {
    ...actual,
    completeProtectReview: vi.fn(),
  };
});

import { db } from "@/lib/db";
import { completeProtectReview } from "@/services/protect";
import { POST } from "@/app/api/protect/webhook/route";

const TOKEN = "protect-webhook-token";

function request(body: unknown, token = TOKEN) {
  return new NextRequest("http://localhost:3000/api/protect/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-token": token,
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/protect/webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.API_TOKEN = TOKEN;
    vi.mocked(completeProtectReview).mockResolvedValue({
      run: { id: "run-1", status: "completed" } as never,
      counts: { created: 1, updated: 0, skipped: 0, stale: 0 },
      errors: [],
    });
  });

  it("rejects missing or wrong x-api-token", async () => {
    const missing = await POST(
      new NextRequest("http://localhost:3000/api/protect/webhook", {
        method: "POST",
        body: JSON.stringify({ runId: "run-1" }),
      }),
    );
    expect(missing.status).toBe(401);

    const wrong = await POST(request({ runId: "run-1" }, "nope"));
    expect(wrong.status).toBe(401);
  });

  it("rejects a missing or completed run id", async () => {
    vi.mocked(db.protectReviewRun.findUnique).mockResolvedValue(null);
    const missing = await POST(request({ runId: "missing" }));
    expect(missing.status).toBe(404);

    vi.mocked(db.protectReviewRun.findUnique).mockResolvedValue({
      id: "run-1",
      workspaceId: "ws-1",
      status: "completed",
      workspace: { repositories: [] },
    } as never);
    const completed = await POST(request({ runId: "run-1" }));
    expect(completed.status).toBe(404);
  });

  it("ignores body workspaceId and uses the run's workspace", async () => {
    vi.mocked(db.protectReviewRun.findUnique).mockResolvedValue({
      id: "run-1",
      workspaceId: "ws-from-run",
      status: "running",
      workspace: {
        repositories: [{ repositoryUrl: "https://github.com/acme/hive" }],
      },
    } as never);

    const response = await POST(
      request({
        runId: "run-1",
        workspaceId: "attacker-workspace",
        findings: [
          {
            category: "bug",
            severity: "low",
            file: "a.ts",
            title: "Issue",
            repositoryUrl: "https://github.com/acme/hive",
          },
        ],
      }),
    );

    expect(response.status).toBe(200);
    expect(completeProtectReview).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run-1" }),
    );
  });

  it("rejects a repositoryUrl not owned by the run workspace", async () => {
    vi.mocked(db.protectReviewRun.findUnique).mockResolvedValue({
      id: "run-1",
      workspaceId: "ws-1",
      status: "running",
      workspace: {
        repositories: [{ repositoryUrl: "https://github.com/acme/hive" }],
      },
    } as never);

    const response = await POST(
      request({
        runId: "run-1",
        findings: [
          {
            category: "bug",
            severity: "low",
            file: "a.ts",
            title: "Issue",
            repositoryUrl: "https://github.com/evil/repo",
          },
        ],
      }),
    );

    expect(response.status).toBe(400);
    expect(completeProtectReview).not.toHaveBeenCalled();
  });

  it("strips unknown finding keys before upsert", async () => {
    vi.mocked(db.protectReviewRun.findUnique).mockResolvedValue({
      id: "run-1",
      workspaceId: "ws-1",
      status: "running",
      workspace: {
        repositories: [{ repositoryUrl: "https://github.com/acme/hive" }],
      },
    } as never);

    await POST(
      request({
        runId: "run-1",
        findings: [
          {
            category: "bug",
            severity: "low",
            file: "a.ts",
            title: "Issue",
            repositoryUrl: "https://github.com/acme/hive",
            extraEvil: "nope",
            verification: "confirmed",
          },
        ],
      }),
    );

    const payload = vi.mocked(completeProtectReview).mock.calls[0][0];
    const findings = payload.findings ?? [];
    expect(findings[0]).not.toHaveProperty("extraEvil");
    expect(findings[0]).not.toHaveProperty("verification");
  });
});
