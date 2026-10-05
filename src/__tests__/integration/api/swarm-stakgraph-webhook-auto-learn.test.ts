import { describe, test, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { RepositoryStatus } from "@prisma/client";
import { POST } from "@/app/api/swarm/stakgraph/webhook/route";
import { computeHmacSha256Hex } from "@/lib/encryption";
import { db } from "@/lib/db";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { createWebhookTestScenario } from "@/__tests__/support/factories/github-webhook.factory";
import { resetDatabase } from "@/__tests__/support/utilities/database";

/**
 * The stakgraph completion webhook is what starts the gitree auto-learn run that the push
 * webhook deferred. The swarm API key from the factory is "sk_test_swarm_123"; the HMAC over the
 * raw body is what authorizes the request, and the repository lookup is scoped to that swarm's
 * workspace.
 */

vi.mock("@/lib/auth/nextauth");

const SWARM_API_KEY = "sk_test_swarm_123";
const GITREE_URL_PREFIX = "https://test-swarm.sphinx.chat:3355/gitree/process?";

function gitreeCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([url]) => String(url).startsWith(GITREE_URL_PREFIX));
}

function webhookRequest(payload: Record<string, unknown>, secret = SWARM_API_KEY) {
  const rawBody = JSON.stringify(payload);
  return new NextRequest("http://localhost/api/swarm/stakgraph/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-signature": `sha256=${computeHmacSha256Hex(secret, rawBody)}`,
    },
    body: rawBody,
  });
}

describe("POST /api/swarm/stakgraph/webhook - deferred auto-learn", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
    vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({ username: "owner", token: "owner-pat-token" });
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  async function setup(
    options: { ingestRefId?: string; pendingRequestId?: string | null; autoLearnEnabled?: boolean } = {},
  ) {
    const scenario = await createWebhookTestScenario({ status: RepositoryStatus.PENDING });
    await db.swarm.update({
      where: { id: scenario.swarm.id },
      data: {
        ingestRefId: options.ingestRefId ?? "sync-req-123",
        autoLearnEnabled: options.autoLearnEnabled ?? true,
      },
    });
    const pendingRequestId = options.pendingRequestId === undefined ? "sync-req-123" : options.pendingRequestId;
    await db.repository.update({
      where: { id: scenario.repository.id },
      data: {
        pendingAutoLearnRequestId: pendingRequestId,
        pendingAutoLearnAt: pendingRequestId ? new Date() : null,
      },
    });
    return scenario;
  }

  test("Complete fires gitree once for the waiting repository and clears the marker", async () => {
    const scenario = await setup();

    const response = await POST(webhookRequest({ request_id: "sync-req-123", status: "Complete", progress: 100 }));

    expect(response.status).toBe(200);
    const calls = gitreeCalls(fetchMock);
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0] as [string, RequestInit];
    expect(url).toBe(
      `${GITREE_URL_PREFIX}owner=test-owner&repo=test-repo&token=owner-pat-token&summarize=true&link=true`,
    );
    expect((init.headers as Record<string, string>)["x-api-token"]).toBe(SWARM_API_KEY);
    expect(getGithubUsernameAndPAT).toHaveBeenCalledWith(scenario.workspace.ownerId, scenario.workspace.slug);

    const repository = await db.repository.findUniqueOrThrow({ where: { id: scenario.repository.id } });
    expect(repository.status).toBe(RepositoryStatus.SYNCED);
    expect(repository.pendingAutoLearnRequestId).toBeNull();
    expect(repository.pendingAutoLearnAt).toBeNull();
  });

  test("Failed also fires gitree, so a failed sync does not starve auto-learn", async () => {
    const scenario = await setup();

    const response = await POST(
      webhookRequest({
        request_id: "sync-req-123",
        status: "Failed",
        progress: 80,
        error: "Neo4j error: connection timed out",
      }),
    );

    expect(response.status).toBe(200);
    expect(gitreeCalls(fetchMock)).toHaveLength(1);
    const repository = await db.repository.findUniqueOrThrow({ where: { id: scenario.repository.id } });
    expect(repository.status).toBe(RepositoryStatus.FAILED);
    expect(repository.pendingAutoLearnRequestId).toBeNull();
  });

  test("an in-progress update keeps the marker and does not call gitree", async () => {
    const scenario = await setup();

    const response = await POST(webhookRequest({ request_id: "sync-req-123", status: "InProgress", progress: 40 }));

    expect(response.status).toBe(200);
    expect(gitreeCalls(fetchMock)).toHaveLength(0);
    const repository = await db.repository.findUniqueOrThrow({ where: { id: scenario.repository.id } });
    expect(repository.pendingAutoLearnRequestId).toBe("sync-req-123");
  });

  test("a redelivered Complete webhook fires nothing a second time", async () => {
    await setup();
    const payload = { request_id: "sync-req-123", status: "Complete", progress: 100 };

    await POST(webhookRequest(payload));
    const second = await POST(webhookRequest(payload));

    expect(second.status).toBe(200);
    expect(gitreeCalls(fetchMock)).toHaveLength(1);
  });

  test("a completion for another request leaves the marker alone", async () => {
    const scenario = await setup({ ingestRefId: "sync-req-999", pendingRequestId: "sync-req-123" });

    const response = await POST(webhookRequest({ request_id: "sync-req-999", status: "Complete", progress: 100 }));

    expect(response.status).toBe(200);
    expect(gitreeCalls(fetchMock)).toHaveLength(0);
    const repository = await db.repository.findUniqueOrThrow({ where: { id: scenario.repository.id } });
    expect(repository.pendingAutoLearnRequestId).toBe("sync-req-123");
  });

  test("a bad signature is rejected before anything runs", async () => {
    const scenario = await setup();

    const response = await POST(
      webhookRequest({ request_id: "sync-req-123", status: "Complete", progress: 100 }, "wrong-secret"),
    );

    expect(response.status).toBe(401);
    expect(gitreeCalls(fetchMock)).toHaveLength(0);
    const repository = await db.repository.findUniqueOrThrow({ where: { id: scenario.repository.id } });
    expect(repository.status).toBe(RepositoryStatus.PENDING);
    expect(repository.pendingAutoLearnRequestId).toBe("sync-req-123");
  });
});
