import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import {
  AUTO_LEARN_STALE_MS,
  runPendingAutoLearn,
  scheduleAutoLearnForPush,
  triggerAutoLearn,
} from "@/services/swarm/auto-learn";

vi.mock("@/lib/auth/nextauth", () => ({
  getGithubUsernameAndPAT: vi.fn(),
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: () => ({
      decryptField: vi.fn(() => "decrypted-swarm-key"),
    }),
  },
}));

const fetchMock = vi.fn();
const originalFetch = global.fetch;

const GITHUB_PAT = "ghp_push_secret";
const SWARM_URL = "https://swarm38.sphinx.chat/api";
const REPOSITORY_URL = "https://github.com/stakwork/hive";

function gitreeCalls() {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes("/gitree/process"));
}

function expectGitreeCall(call: unknown[], token: string, apiKey: string) {
  const [url, init] = call as [string, RequestInit];
  expect(url).toBe(
    `https://swarm38.sphinx.chat:3355/gitree/process?owner=stakwork&repo=hive&token=${token}&summarize=true&link=true`,
  );
  expect(init.method).toBe("POST");
  expect((init.headers as Record<string, string>)["x-api-token"]).toBe(apiKey);
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockResolvedValue({ ok: true, status: 200 } as Response);
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("triggerAutoLearn", () => {
  const base = {
    workspaceId: "ws-1",
    repositoryUrl: REPOSITORY_URL,
    swarmUrl: SWARM_URL,
    swarmApiKey: "swarm-key",
    githubPat: GITHUB_PAT,
    reason: "sync-complete" as const,
  };

  test("posts to gitree/process with owner, repo and token and the swarm api key header", () => {
    expect(triggerAutoLearn(base)).toBe(true);
    expect(gitreeCalls()).toHaveLength(1);
    expectGitreeCall(gitreeCalls()[0], GITHUB_PAT, "swarm-key");
  });

  test("targets localhost over http for a local swarm", () => {
    expect(triggerAutoLearn({ ...base, swarmUrl: "http://localhost:3000" })).toBe(true);
    expect(String(gitreeCalls()[0][0])).toMatch(/^http:\/\/localhost:3355\/gitree\/process\?/);
  });

  test("does nothing without a swarm url or a GitHub token", () => {
    expect(triggerAutoLearn({ ...base, swarmUrl: null })).toBe(false);
    expect(triggerAutoLearn({ ...base, githubPat: undefined })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("does nothing for an unparseable repository url", () => {
    expect(triggerAutoLearn({ ...base, repositoryUrl: "not a repo" })).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("never writes the GitHub token to the logs", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 } as Response);

    triggerAutoLearn(base);
    await new Promise((resolve) => setImmediate(resolve));

    const logged = [...logSpy.mock.calls, ...errorSpy.mock.calls].map((args) => JSON.stringify(args)).join("\n");
    expect(logged).toContain("gitree/process");
    expect(logged).not.toContain(GITHUB_PAT);

    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});

describe("scheduleAutoLearnForPush", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  const repository = {
    id: "repo-1",
    repositoryUrl: REPOSITORY_URL,
    pendingAutoLearnRequestId: null as string | null,
    pendingAutoLearnAt: null as Date | null,
  };
  const base = {
    repository,
    workspaceId: "ws-1",
    swarm: { autoLearnEnabled: true, swarmUrl: SWARM_URL },
    swarmApiKey: "swarm-key",
    githubPat: GITHUB_PAT,
    delivery: "delivery-1",
    now,
  };

  test("a push that started a sync records the marker and does not call gitree", async () => {
    const outcome = await scheduleAutoLearnForPush({ ...base, syncRequestId: "req-A" });

    expect(outcome).toBe("deferred");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.repository.update).toHaveBeenCalledWith({
      where: { id: "repo-1" },
      data: { pendingAutoLearnRequestId: "req-A", pendingAutoLearnAt: now },
    });
  });

  test("does nothing when auto-learn is disabled", async () => {
    const outcome = await scheduleAutoLearnForPush({
      ...base,
      swarm: { autoLearnEnabled: false, swarmUrl: SWARM_URL },
      syncRequestId: "req-A",
    });

    expect(outcome).toBe("disabled");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.repository.update).not.toHaveBeenCalled();
  });

  test("a busy rejection (no request_id) fires gitree immediately", async () => {
    const outcome = await scheduleAutoLearnForPush({ ...base, syncRequestId: undefined });

    expect(outcome).toBe("fired");
    expect(gitreeCalls()).toHaveLength(1);
    expectGitreeCall(gitreeCalls()[0], GITHUB_PAT, "swarm-key");
    expect(db.repository.update).not.toHaveBeenCalled();
    expect(db.repository.updateMany).not.toHaveBeenCalled();
  });

  test("a busy rejection keeps a fresh marker instead of racing the in-flight sync", async () => {
    const outcome = await scheduleAutoLearnForPush({
      ...base,
      repository: {
        ...repository,
        pendingAutoLearnRequestId: "req-A",
        pendingAutoLearnAt: new Date(now.getTime() - 5 * 60 * 1000),
      },
      syncRequestId: undefined,
    });

    expect(outcome).toBe("kept-pending");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.repository.update).not.toHaveBeenCalled();
    expect(db.repository.updateMany).not.toHaveBeenCalled();
  });

  test("a stale marker fires immediately and is re-pointed at the new sync", async () => {
    const outcome = await scheduleAutoLearnForPush({
      ...base,
      repository: {
        ...repository,
        pendingAutoLearnRequestId: "req-A",
        pendingAutoLearnAt: new Date(now.getTime() - AUTO_LEARN_STALE_MS - 1000),
      },
      syncRequestId: "req-B",
    });

    expect(outcome).toBe("fired-stale-then-deferred");
    expect(gitreeCalls()).toHaveLength(1);
    expect(db.repository.update).toHaveBeenCalledWith({
      where: { id: "repo-1" },
      data: { pendingAutoLearnRequestId: "req-B", pendingAutoLearnAt: now },
    });
  });

  test("a fresh marker is re-pointed at the new sync but keeps its original wait start", async () => {
    const pendingSince = new Date(now.getTime() - 5 * 60 * 1000);
    const outcome = await scheduleAutoLearnForPush({
      ...base,
      repository: { ...repository, pendingAutoLearnRequestId: "req-A", pendingAutoLearnAt: pendingSince },
      syncRequestId: "req-B",
    });

    expect(outcome).toBe("deferred");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.repository.update).toHaveBeenCalledWith({
      where: { id: "repo-1" },
      data: { pendingAutoLearnRequestId: "req-B", pendingAutoLearnAt: pendingSince },
    });
  });

  test("a stale marker with no new sync fires immediately and clears the marker", async () => {
    const outcome = await scheduleAutoLearnForPush({
      ...base,
      repository: {
        ...repository,
        pendingAutoLearnRequestId: "req-A",
        pendingAutoLearnAt: new Date(now.getTime() - AUTO_LEARN_STALE_MS),
      },
      syncRequestId: undefined,
    });

    expect(outcome).toBe("fired");
    expect(gitreeCalls()).toHaveLength(1);
    expect(db.repository.updateMany).toHaveBeenCalledWith({
      where: { id: "repo-1", pendingAutoLearnRequestId: "req-A" },
      data: { pendingAutoLearnRequestId: null, pendingAutoLearnAt: null },
    });
  });
});

describe("runPendingAutoLearn", () => {
  const verifiedSwarm = { id: "swarm-1", workspaceId: "ws-1" };

  function armPendingRepository(overrides: { autoLearnEnabled?: boolean; claimed?: number } = {}) {
    vi.mocked(db.repository.findMany).mockResolvedValue([{ id: "repo-1", repositoryUrl: REPOSITORY_URL }] as never);
    vi.mocked(db.swarm.findUnique).mockResolvedValue({
      workspaceId: "ws-1",
      swarmUrl: SWARM_URL,
      swarmApiKey: JSON.stringify({ data: "enc" }),
      autoLearnEnabled: overrides.autoLearnEnabled ?? true,
    } as never);
    vi.mocked(db.workspace.findUnique).mockResolvedValue({ ownerId: "owner-1", slug: "hive" } as never);
    vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({ username: "owner", token: "ghp_owner_secret" } as never);
    vi.mocked(db.repository.updateMany).mockResolvedValue({ count: overrides.claimed ?? 1 });
  }

  test("a Complete webhook fires gitree once for the waiting repository and clears the marker", async () => {
    armPendingRepository();

    const result = await runPendingAutoLearn({ swarm: verifiedSwarm, requestId: "req-A", status: "Complete" });

    expect(result).toEqual({ terminal: true, matched: 1, fired: 1 });
    expect(db.repository.findMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1", pendingAutoLearnRequestId: "req-A" },
      select: { id: true, repositoryUrl: true },
    });
    expect(db.repository.updateMany).toHaveBeenCalledWith({
      where: { id: "repo-1", pendingAutoLearnRequestId: "req-A" },
      data: { pendingAutoLearnRequestId: null, pendingAutoLearnAt: null },
    });
    expect(getGithubUsernameAndPAT).toHaveBeenCalledWith("owner-1", "hive");
    expect(gitreeCalls()).toHaveLength(1);
    expectGitreeCall(gitreeCalls()[0], "ghp_owner_secret", "decrypted-swarm-key");
  });

  test("a Failed webhook also fires gitree so a failed sync does not starve auto-learn", async () => {
    armPendingRepository();

    const result = await runPendingAutoLearn({ swarm: verifiedSwarm, requestId: "req-A", status: "Failed" });

    expect(result).toEqual({ terminal: true, matched: 1, fired: 1 });
    expect(gitreeCalls()).toHaveLength(1);
  });

  test("an in-progress webhook does nothing", async () => {
    const result = await runPendingAutoLearn({ swarm: verifiedSwarm, requestId: "req-A", status: "InProgress" });

    expect(result).toEqual({ terminal: false, matched: 0, fired: 0 });
    expect(db.repository.findMany).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a request_id nobody waits on touches nothing else", async () => {
    vi.mocked(db.repository.findMany).mockResolvedValue([]);

    const result = await runPendingAutoLearn({ swarm: verifiedSwarm, requestId: "req-X", status: "Complete" });

    expect(result).toEqual({ terminal: true, matched: 0, fired: 0 });
    expect(db.swarm.findUnique).not.toHaveBeenCalled();
    expect(getGithubUsernameAndPAT).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("a redelivered webhook fires nothing because the marker was already claimed", async () => {
    armPendingRepository({ claimed: 0 });

    const result = await runPendingAutoLearn({ swarm: verifiedSwarm, requestId: "req-A", status: "Complete" });

    expect(result).toEqual({ terminal: true, matched: 1, fired: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("auto-learn disabled after the push clears the marker without calling gitree", async () => {
    armPendingRepository({ autoLearnEnabled: false });

    const result = await runPendingAutoLearn({ swarm: verifiedSwarm, requestId: "req-A", status: "Complete" });

    expect(result).toEqual({ terminal: true, matched: 1, fired: 0 });
    expect(db.repository.updateMany).toHaveBeenCalledTimes(1);
    expect(getGithubUsernameAndPAT).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("rejects an unknown status so the caller can log it", async () => {
    await expect(runPendingAutoLearn({ swarm: verifiedSwarm, requestId: "req-A", status: "Weird" })).rejects.toThrow(
      /Unknown stakgraph status/,
    );
  });
});
