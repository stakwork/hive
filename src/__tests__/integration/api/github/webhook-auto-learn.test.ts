import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/github/webhook/[workspaceId]/route";
import { RepositoryStatus } from "@prisma/client";
import {
  createWebhookTestScenario,
  createGitHubPushPayload,
  computeValidWebhookSignature,
  createWebhookRequest,
} from "@/__tests__/support/factories/github-webhook.factory";
import { resetDatabase } from "@/__tests__/support/utilities/database";
import { db } from "@/lib/db";
import { triggerAsyncSync } from "@/services/swarm/stakgraph-actions";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { AUTO_LEARN_STALE_MS } from "@/services/swarm/auto-learn";

/**
 * The push webhook must not start the gitree auto-learn run alongside the stakgraph sync it
 * triggers: it records the sync's request_id on the repository and the stakgraph completion
 * webhook fires gitree later. These tests drive the real route against the database with the
 * swarm calls mocked.
 */

vi.mock("@/services/swarm/stakgraph-actions");
vi.mock("@/lib/auth/nextauth");
vi.mock("@/lib/service-factory", () => ({
  stakworkService: vi.fn(() => ({
    stakworkRequest: vi.fn().mockResolvedValue({ data: { project_id: 99 } }),
  })),
}));
vi.mock("@/services/protect", async () => {
  const actual = await vi.importActual<typeof import("@/services/protect")>("@/services/protect");
  return {
    ...actual,
    dispatchIncrementalProtectReview: vi.fn().mockResolvedValue({ dispatched: false, reason: "mocked" }),
  };
});
vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn() },
  getWorkspaceChannelName: vi.fn((slug: string) => `workspace-${slug}`),
  getTaskChannelName: vi.fn((id: string) => `task-${id}`),
  PUSHER_EVENTS: {},
}));
vi.mock("@/lib/pods/utils", async () => {
  const actual = await vi.importActual("@/lib/pods/utils");
  return { ...actual, releaseTaskPod: vi.fn() };
});

const GITREE_URL_PREFIX = "https://test-swarm.sphinx.chat:3355/gitree/process?";

function gitreeCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls.filter(([url]) => String(url).startsWith(GITREE_URL_PREFIX));
}

describe("POST /api/github/webhook/[workspaceId] - auto-learn hand-off", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();

    vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({ username: "test-user", token: "test-pat-token" });
    vi.mocked(triggerAsyncSync).mockResolvedValue({ ok: true, status: 200, data: { request_id: "sync-req-123" } });

    // The gitree request goes through global fetch; the integration setup restores fetch after each test.
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  async function setup(options: { autoLearnEnabled?: boolean } = {}) {
    const scenario = await createWebhookTestScenario({ branch: "main", status: RepositoryStatus.SYNCED });
    await db.swarm.update({
      where: { id: scenario.swarm.id },
      data: { autoLearnEnabled: options.autoLearnEnabled ?? true },
    });
    return scenario;
  }

  async function push(scenario: Awaited<ReturnType<typeof setup>>) {
    const payload = createGitHubPushPayload("refs/heads/main", scenario.repository.repositoryUrl);
    const signature = computeValidWebhookSignature(scenario.webhookSecret, JSON.stringify(payload));
    const request = createWebhookRequest(
      `http://localhost/api/github/webhook/${scenario.workspace.id}`,
      payload,
      signature,
      scenario.repository.githubWebhookId!,
    );
    return POST(request, { params: Promise.resolve({ workspaceId: scenario.workspace.id }) });
  }

  test("a push that starts a sync records the pending marker and does not call gitree", async () => {
    const scenario = await setup();
    const before = Date.now();

    const response = await push(scenario);

    expect(response.status).toBe(202);
    expect(triggerAsyncSync).toHaveBeenCalledTimes(1);
    expect(gitreeCalls(fetchMock)).toHaveLength(0);

    const repository = await db.repository.findUniqueOrThrow({ where: { id: scenario.repository.id } });
    expect(repository.status).toBe(RepositoryStatus.PENDING);
    expect(repository.pendingAutoLearnRequestId).toBe("sync-req-123");
    expect(repository.pendingAutoLearnAt).not.toBeNull();
    expect(repository.pendingAutoLearnAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);

    const swarm = await db.swarm.findUniqueOrThrow({ where: { id: scenario.swarm.id } });
    expect(swarm.ingestRefId).toBe("sync-req-123");
  });

  test("a busy rejection with no request_id fires gitree immediately and leaves no marker", async () => {
    const scenario = await setup();
    vi.mocked(triggerAsyncSync).mockResolvedValue({
      ok: false,
      status: 409,
      data: { error: "System is busy processing another request" },
    });

    const response = await push(scenario);

    expect(response.status).toBe(202);
    const calls = gitreeCalls(fetchMock);
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0] as [string, RequestInit];
    expect(url).toBe(
      `${GITREE_URL_PREFIX}owner=test-owner&repo=test-repo&token=test-pat-token&summarize=true&link=true`,
    );
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-api-token"]).toBe("sk_test_swarm_123");

    const repository = await db.repository.findUniqueOrThrow({ where: { id: scenario.repository.id } });
    expect(repository.pendingAutoLearnRequestId).toBeNull();
    expect(repository.pendingAutoLearnAt).toBeNull();
  });

  test("a stale marker (webhook never came) fires gitree immediately and is re-pointed at the new sync", async () => {
    const scenario = await setup();
    const staleSince = new Date(Date.now() - AUTO_LEARN_STALE_MS - 60_000);
    await db.repository.update({
      where: { id: scenario.repository.id },
      data: { pendingAutoLearnRequestId: "old-req", pendingAutoLearnAt: staleSince },
    });
    vi.mocked(triggerAsyncSync).mockResolvedValue({ ok: true, status: 200, data: { request_id: "sync-req-456" } });

    const response = await push(scenario);

    expect(response.status).toBe(202);
    expect(gitreeCalls(fetchMock)).toHaveLength(1);

    const repository = await db.repository.findUniqueOrThrow({ where: { id: scenario.repository.id } });
    expect(repository.pendingAutoLearnRequestId).toBe("sync-req-456");
    expect(repository.pendingAutoLearnAt!.getTime()).toBeGreaterThan(staleSince.getTime());
  });

  test("a fresh marker is re-pointed at the new sync without calling gitree", async () => {
    const scenario = await setup();
    const pendingSince = new Date(Date.now() - 5 * 60_000);
    await db.repository.update({
      where: { id: scenario.repository.id },
      data: { pendingAutoLearnRequestId: "old-req", pendingAutoLearnAt: pendingSince },
    });
    vi.mocked(triggerAsyncSync).mockResolvedValue({ ok: true, status: 200, data: { request_id: "sync-req-456" } });

    await push(scenario);

    expect(gitreeCalls(fetchMock)).toHaveLength(0);
    const repository = await db.repository.findUniqueOrThrow({ where: { id: scenario.repository.id } });
    expect(repository.pendingAutoLearnRequestId).toBe("sync-req-456");
    expect(repository.pendingAutoLearnAt!.getTime()).toBe(pendingSince.getTime());
  });

  test("auto-learn disabled: no marker and no gitree call", async () => {
    const scenario = await setup({ autoLearnEnabled: false });

    const response = await push(scenario);

    expect(response.status).toBe(202);
    expect(gitreeCalls(fetchMock)).toHaveLength(0);
    const repository = await db.repository.findUniqueOrThrow({ where: { id: scenario.repository.id } });
    expect(repository.pendingAutoLearnRequestId).toBeNull();
  });
});
