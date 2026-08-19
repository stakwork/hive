/**
 * Contract pin: the stakgraph mock's create_pr envelope must match what
 * production serves — a mock that green-lights payloads production would
 * reject is worse than no mock (§4.2 of the code-change plan).
 *
 * Pins, against the REAL adapter code (`hardenPrResult` — no mocks):
 *   1. The dispatch response carries `pr_branch`, shaped like the swarm's
 *      `swarm/swarm-change-<runId8>` and NOT derivable from `request_id`
 *      (`runId` is an independent UUID upstream).
 *   2. The webhook callback nests the FLAT LandChangeResult under
 *      `result.pr` — it must pass `hardenPrResult` verbatim, and its
 *      `branch` must equal the dispatch response's `pr_branch`.
 *   3. `webhookMode: "not_called"` delivers the `create_pr_not_called`
 *      sentinel as a COMPLETED run.
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/config/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/config/env")>();
  return { ...actual, config: { ...actual.config, USE_MOCKS: true } };
});

import { POST } from "@/app/api/mock/stakgraph/repo/agent/route";
import { hardenPrResult } from "@/services/swarm/createPr";

const REPO_URL = "https://github.com/acme/widgets";
const WEBHOOK_URL = "https://hive.example.com/api/code-change/webhook?token=t";

function dispatchRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/mock/stakgraph/repo/agent", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-token": "mock-token",
    },
    body: JSON.stringify(body),
  });
}

async function runDispatch(body: Record<string, unknown>): Promise<{
  dispatch: { request_id: string; pr_branch?: string };
  webhookBody: Record<string, unknown> | null;
}> {
  const fetchMock = vi
    .fn()
    .mockResolvedValue({ status: 200, ok: true } as Response);
  vi.stubGlobal("fetch", fetchMock);

  const res = await POST(dispatchRequest(body));
  expect(res.status).toBe(200);
  const dispatch = (await res.json()) as {
    request_id: string;
    pr_branch?: string;
  };

  // The webhook fan-back fires on a 500ms timer.
  await vi.advanceTimersByTimeAsync(600);

  const webhookBody = fetchMock.mock.calls.length
    ? (JSON.parse(fetchMock.mock.calls[0][1].body as string) as Record<
        string,
        unknown
      >)
    : null;
  return { dispatch, webhookBody };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("stakgraph mock — create_pr contract", () => {
  it("returns a pr_branch in the swarm's shape, not derived from request_id", async () => {
    const { dispatch } = await runDispatch({
      repo_url: REPO_URL,
      prompt: "TITLE:\n[Jamie] x\n\nBODY:\n\nDIFF:\n",
      toolsConfig: { create_pr: true },
    });

    expect(dispatch.request_id).toBeTruthy();
    expect(dispatch.pr_branch).toMatch(/^swarm\/swarm-change-[0-9a-f]{8}$/);
    // runId is independent of request_id upstream — no slice of the
    // request_id may ever reproduce the branch suffix.
    const suffix = dispatch.pr_branch!.replace("swarm/swarm-change-", "");
    expect(dispatch.request_id).not.toContain(suffix);
  });

  it("webhook result.pr is the FLAT LandChangeResult and passes production hardening", async () => {
    const { dispatch, webhookBody } = await runDispatch({
      repo_url: REPO_URL,
      prompt: "TITLE:\n[Jamie] x\n\nBODY:\n\nDIFF:\n",
      toolsConfig: { create_pr: true },
      webhookUrl: WEBHOOK_URL,
    });

    expect(webhookBody).not.toBeNull();
    expect(webhookBody!.request_id).toBe(dispatch.request_id);
    expect(webhookBody!.status).toBe("completed");

    const result = webhookBody!.result as Record<string, unknown>;
    const pr = result.pr as Record<string, unknown>;
    // Flat — NOT the historical `result.pr.pr` double nesting.
    expect(pr.pr).toBeUndefined();
    expect(pr.ok).toBe(true);
    expect(pr.branch).toBe(dispatch.pr_branch);

    // The real adapter must accept this payload verbatim.
    const hardened = hardenPrResult(pr, REPO_URL);
    expect(hardened.ok).toBe(true);
  });

  it("webhookMode 'not_called' delivers the create_pr_not_called sentinel on a completed run", async () => {
    const { webhookBody } = await runDispatch({
      repo_url: REPO_URL,
      prompt: "TITLE:\n[Jamie] x\n\nBODY:\n\nDIFF:\n",
      toolsConfig: { create_pr: true },
      webhookUrl: WEBHOOK_URL,
      webhookMode: "not_called",
    });

    expect(webhookBody!.status).toBe("completed");
    const pr = (webhookBody!.result as Record<string, unknown>)
      .pr as Record<string, unknown>;
    expect(pr.ok).toBe(false);
    expect(pr.failure).toBe("create_pr_not_called");
  });

  it("webhookMode 'fail' delivers status failed with retryable", async () => {
    const { webhookBody } = await runDispatch({
      repo_url: REPO_URL,
      prompt: "TITLE:\n[Jamie] x\n\nBODY:\n\nDIFF:\n",
      toolsConfig: { create_pr: true },
      webhookUrl: WEBHOOK_URL,
      webhookMode: "fail",
    });

    expect(webhookBody!.status).toBe("failed");
    expect(webhookBody!.retryable).toBe(false);
    expect(webhookBody!.result).toBeUndefined();
  });
});
