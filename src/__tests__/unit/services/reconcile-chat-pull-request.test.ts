import { describe, test, expect, vi, beforeEach } from "vitest";

const { findFirst, update, queryRaw, transaction } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  update: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: { sharedConversation: { findFirst }, $transaction: transaction },
}));

import { reconcileChatPullRequestState } from "@/services/orgs/reconcile-chat-pull-request";

const pr = (repo: string, number: number, state: string, extra: Record<string, unknown> = {}) => ({
  id: `pr-${repo}-${number}`,
  kind: "pull_request",
  title: "PR",
  source: { type: "inline", content: { url: "u", repo, number, state, ...extra } },
});

const input = { conversationId: "c1", orgId: "org-1", userId: "u1", repo: "acme/app", number: 7, state: "merged" };

function messages() {
  return [
    { id: "m1", role: "user", content: "hi" },
    { id: "m2", role: "assistant", artifacts: [pr("acme/app", 7, "open", { branch: "x" }), pr("acme/app", 8, "open")] },
    { id: "m3", role: "assistant", artifacts: [pr("Acme/App", 7, "draft")] },
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
  transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({ $queryRaw: queryRaw, sharedConversation: { update } }),
  );
});

describe("reconcileChatPullRequestState", () => {
  test("flips only matching refs (case-insensitive repo) across messages, writing no lastMessageAt", async () => {
    const stored = messages();
    findFirst.mockResolvedValue({ messages: stored });
    queryRaw.mockResolvedValue([{ messages: stored }]);

    const res = await reconcileChatPullRequestState(input);

    expect(res).toEqual({ updated: 2 });
    const data = update.mock.calls[0][0].data;
    expect(Object.keys(data)).toEqual(["messages"]);
    expect(data.messages[1].artifacts[0].source.content).toMatchObject({ state: "merged", branch: "x" });
    expect(data.messages[1].artifacts[1].source.content.state).toBe("open");
    expect(data.messages[2].artifacts[0].source.content.state).toBe("merged");
    expect(data.messages[0]).toBe(stored[0]);
    // input untouched
    expect(stored[1].artifacts![0].source.content.state).toBe("open");
  });

  test("no write and no lock when state already matches", async () => {
    findFirst.mockResolvedValue({ messages: [{ artifacts: [pr("acme/app", 7, "merged")] }] });
    expect(await reconcileChatPullRequestState(input)).toEqual({ updated: 0 });
    expect(transaction).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  test("scopes the lookup to org and viewer-or-shared; a miss returns 0", async () => {
    findFirst.mockResolvedValue(null);
    expect(await reconcileChatPullRequestState(input)).toEqual({ updated: 0 });
    expect(findFirst.mock.calls[0][0].where).toEqual({
      id: "c1",
      sourceControlOrgId: "org-1",
      OR: [{ userId: "u1" }, { isShared: true }],
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  test("no write if the locked row no longer needs a change", async () => {
    findFirst.mockResolvedValue({ messages: messages() });
    queryRaw.mockResolvedValue([{ messages: [{ artifacts: [pr("acme/app", 7, "merged")] }] }]);
    expect(await reconcileChatPullRequestState(input)).toEqual({ updated: 0 });
    expect(update).not.toHaveBeenCalled();
  });
});
