/**
 * Unit tests for the mock Stakgraph Gitree Proposals endpoints.
 *
 * These tests import the route handlers directly and call them with synthetic
 * NextRequest objects — no HTTP server or DB required.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

import { config } from "@/config/env";
import { GET as listGet } from "@/app/api/mock/stakgraph/gitree/proposals/route";
import { GET as detailGet } from "@/app/api/mock/stakgraph/gitree/proposals/[id]/route";
import { POST as acceptPost } from "@/app/api/mock/stakgraph/gitree/proposals/[id]/accept/route";
import { POST as rejectPost } from "@/app/api/mock/stakgraph/gitree/proposals/[id]/reject/route";
import {
  resetMockProposals,
  mockProposals,
  mockConceptDocs,
} from "@/app/api/mock/stakgraph/gitree/proposals/fixtures";

const mutableConfig = config as { USE_MOCKS: boolean };

afterEach(() => {
  mutableConfig.USE_MOCKS = false;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const TOKEN_HEADER = { "x-api-token": "mock" };

function makeListReq(params: Record<string, string> = {}) {
  const url = new URL("http://localhost/api/mock/stakgraph/gitree/proposals");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url.toString(), { headers: TOKEN_HEADER });
}

function makeDetailReq(id: string) {
  return new NextRequest(
    `http://localhost/api/mock/stakgraph/gitree/proposals/${id}`,
    { headers: TOKEN_HEADER },
  );
}

function makeActionReq(
  id: string,
  action: "accept" | "reject",
  body?: Record<string, unknown>,
) {
  return new NextRequest(
    `http://localhost/api/mock/stakgraph/gitree/proposals/${id}/${action}`,
    {
      method: "POST",
      headers: { ...TOKEN_HEADER, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    },
  );
}

function makeParams(id: string): Promise<{ id: string }> {
  return Promise.resolve({ id });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/mock/stakgraph/gitree/proposals (list)", () => {
  beforeEach(() => {
    mutableConfig.USE_MOCKS = true;
    resetMockProposals();
  });

  it("returns 401 when x-api-token is missing", async () => {
    const req = new NextRequest("http://localhost/api/mock/.../proposals");
    const res = await listGet(req);
    expect(res.status).toBe(401);
  });

  it("returns all proposals when no filters are applied", async () => {
    const res = await listGet(makeListReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.proposals).toHaveLength(9); // original 5 + 4 bulk-selection fixtures
    expect(body.count).toBe(9);
    // Real swarm returns repo: "all" when no repo filter is given
    expect(body.repo).toBe("all");
  });

  it("filters by repo", async () => {
    const res = await listGet(makeListReq({ repo: "stakwork/hive" }));
    const body = await res.json();
    // All fixtures belong to stakwork/hive
    expect(body.proposals.length).toBeGreaterThan(0);
    body.proposals.forEach((p: { repo: string }) => {
      expect(p.repo).toBe("stakwork/hive");
    });
    expect(body.repo).toBe("stakwork/hive");
  });

  it("returns empty array for unknown repo", async () => {
    const res = await listGet(makeListReq({ repo: "unknown/repo" }));
    const body = await res.json();
    expect(body.proposals).toHaveLength(0);
    expect(body.count).toBe(0);
  });

  it("filters by status=pending", async () => {
    const res = await listGet(makeListReq({ status: "pending" }));
    const body = await res.json();
    expect(body.proposals.length).toBeGreaterThan(0);
    body.proposals.forEach((p: { status: string }) => {
      expect(p.status).toBe("pending");
    });
  });

  it("returns 400 for invalid status value", async () => {
    const res = await listGet(makeListReq({ status: "invalid_status" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid status/i);
    expect(body.error).toContain("pending");
  });

  it("returns 400 for uppercase STATUS value (not in allowed list)", async () => {
    const res = await listGet(makeListReq({ status: "PENDING" }));
    expect(res.status).toBe(400);
  });

  it("returns accepted proposals after a decision", async () => {
    // Accept the create proposal first
    await acceptPost(makeActionReq("proposal-create-1", "accept", { decidedBy: "u1" }), {
      params: makeParams("proposal-create-1"),
    });

    const res = await listGet(makeListReq({ status: "accepted" }));
    const body = await res.json();
    expect(body.proposals.some((p: { id: string }) => p.id === "proposal-create-1")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/mock/stakgraph/gitree/proposals/[id] (detail)", () => {
  beforeEach(() => {
    mutableConfig.USE_MOCKS = true;
    resetMockProposals();
  });

  it("returns 401 when x-api-token is missing", async () => {
    const req = new NextRequest("http://localhost/api/mock/.../proposals/proposal-create-1");
    const res = await detailGet(req, { params: makeParams("proposal-create-1") });
    expect(res.status).toBe(401);
  });

  it("returns a proposal by id", async () => {
    const res = await detailGet(makeDetailReq("proposal-create-1"), {
      params: makeParams("proposal-create-1"),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.proposal.id).toBe("proposal-create-1");
    expect(body.proposal.action).toBe("create");
    // Contract fields the UI depends on (e.g. newest-first sorting)
    expect(body.proposal.createdAt).toBeDefined();
  });

  it("returns 404 for unknown id", async () => {
    const res = await detailGet(makeDetailReq("no-such-proposal"), {
      params: makeParams("no-such-proposal"),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it("returns the merge fixture with both conceptId and mergeIntoConceptId", async () => {
    const res = await detailGet(makeDetailReq("proposal-merge-1"), {
      params: makeParams("proposal-merge-1"),
    });
    const body = await res.json();
    expect(body.proposal.action).toBe("merge");
    expect(body.proposal.conceptId).toBeDefined();
    expect(body.proposal.mergeIntoConceptId).toBeDefined();
    expect(body.proposal.absorbedDocs).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/mock/stakgraph/gitree/proposals/[id]/accept", () => {
  beforeEach(() => {
    mutableConfig.USE_MOCKS = true;
    resetMockProposals();
  });

  it("returns 401 when x-api-token is missing", async () => {
    const req = new NextRequest("http://localhost/.../accept", { method: "POST" });
    const res = await acceptPost(req, { params: makeParams("proposal-create-1") });
    expect(res.status).toBe(401);
  });

  it("accepts a pending create proposal and stamps createdConceptId", async () => {
    const res = await acceptPost(
      makeActionReq("proposal-create-1", "accept", { decidedBy: "user-abc" }),
      { params: makeParams("proposal-create-1") },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.proposal.status).toBe("accepted");
    expect(body.proposal.createdConceptId).toBeDefined();
    expect(body.proposal.createdConceptId).toContain("encryption-service");
  });

  it("accepts a pending update proposal without createdConceptId", async () => {
    const res = await acceptPost(
      makeActionReq("proposal-update-1", "accept", { decidedBy: "u" }),
      { params: makeParams("proposal-update-1") },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.proposal.createdConceptId).toBeUndefined();
    expect(body.proposal.status).toBe("accepted");
  });

  it("accepts a pending delete proposal", async () => {
    const res = await acceptPost(
      makeActionReq("proposal-delete-1", "accept", { decidedBy: "u" }),
      { params: makeParams("proposal-delete-1") },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.proposal.action).toBe("delete");
    expect(body.proposal.status).toBe("accepted");
  });

  it("accepts a pending merge proposal", async () => {
    const res = await acceptPost(
      makeActionReq("proposal-merge-1", "accept", { decidedBy: "u" }),
      { params: makeParams("proposal-merge-1") },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.proposal.action).toBe("merge");
    expect(body.proposal.status).toBe("accepted");
  });

  // ── stale_base ─────────────────────────────────────────────────────────────

  it("returns 409 { error, code: 'stale_base' } when baseDocs doesn't match current docs", async () => {
    // proposal-stale-1 has baseDocs that deliberately mismatches the current
    // auth concept documentation in mockConceptDocs
    const res = await acceptPost(
      makeActionReq("proposal-stale-1", "accept", { decidedBy: "u" }),
      { params: makeParams("proposal-stale-1") },
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("stale_base");
    expect(body.conceptId).toBeDefined();
    // Swarm contract includes a human-readable error alongside the code
    expect(body.error).toBeDefined();
  });

  it("checks stale_base against the SURVIVOR for merge proposals", async () => {
    // Drift the surviving concept's docs — the real swarm 409s on survivor
    // drift (the absorbed concept is being deleted, its drift is irrelevant).
    mockConceptDocs["stakwork/hive/swarm"] = "Docs changed by someone else.";
    const res = await acceptPost(
      makeActionReq("proposal-merge-1", "accept", { decidedBy: "u" }),
      { params: makeParams("proposal-merge-1") },
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("stale_base");
    expect(body.conceptId).toBe("stakwork/hive/swarm");
  });

  it("accepts despite stale baseDocs when force=true", async () => {
    const res = await acceptPost(
      makeActionReq("proposal-stale-1", "accept", { decidedBy: "u", force: true }),
      { params: makeParams("proposal-stale-1") },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.proposal.status).toBe("accepted");
  });

  it("verifies stale fixture baseDocs actually differs from current mockConceptDocs", () => {
    // This guards the test assumption — if someone 'fixes' the stale fixture to
    // match the current docs, the stale_base path would silently stop working.
    // Compare the actual fixture (not a re-typed literal) against the docs map.
    const staleFixture = mockProposals.find((p) => p.id === "proposal-stale-1")!;
    expect(staleFixture.baseDocs).not.toBe(mockConceptDocs["stakwork/hive/auth"]);
  });

  // ── already decided ────────────────────────────────────────────────────────

  it("returns 409 { error, status } when proposal is already accepted", async () => {
    // Accept once (for update proposal which has matching baseDocs)
    await acceptPost(
      makeActionReq("proposal-update-1", "accept", { decidedBy: "u" }),
      { params: makeParams("proposal-update-1") },
    );

    // Accept again — should 409
    const res = await acceptPost(
      makeActionReq("proposal-update-1", "accept", { decidedBy: "u" }),
      { params: makeParams("proposal-update-1") },
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.status).toBe("accepted");
    expect(body.error).toBeDefined();
    expect(body.code).toBeUndefined();
  });

  it("returns 409 { error, status } when proposal is already rejected", async () => {
    // Reject the delete proposal first
    await rejectPost(
      makeActionReq("proposal-delete-1", "reject", { decidedBy: "u" }),
      { params: makeParams("proposal-delete-1") },
    );

    // Accept should now 409
    const res = await acceptPost(
      makeActionReq("proposal-delete-1", "accept", { decidedBy: "u" }),
      { params: makeParams("proposal-delete-1") },
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.status).toBe("rejected");
    expect(body.error).toBeDefined();
  });

  // ── 404 ────────────────────────────────────────────────────────────────────

  it("returns 404 for unknown proposal id", async () => {
    const res = await acceptPost(
      makeActionReq("no-such-proposal", "accept", {}),
      { params: makeParams("no-such-proposal") },
    );
    expect(res.status).toBe(404);
  });

  // ── mutation persistence ───────────────────────────────────────────────────

  it("persists the accepted status so subsequent GET reflects the change", async () => {
    await acceptPost(
      makeActionReq("proposal-create-1", "accept", { decidedBy: "u" }),
      { params: makeParams("proposal-create-1") },
    );

    const res = await detailGet(makeDetailReq("proposal-create-1"), {
      params: makeParams("proposal-create-1"),
    });
    const body = await res.json();
    expect(body.proposal.status).toBe("accepted");
    expect(body.proposal.createdConceptId).toBeDefined();
  });

  // ── docs write-through ─────────────────────────────────────────────────────

  it("applies an accepted update to the mock concept docs", async () => {
    const res = await acceptPost(
      makeActionReq("proposal-update-1", "accept", { decidedBy: "u" }),
      { params: makeParams("proposal-update-1") },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    // The mock world reflects the accepted change, like the real swarm
    expect(mockConceptDocs["stakwork/hive/tasks"]).toBe(body.proposal.documentation);
  });

  it("applies an accepted merge: survivor gets merged docs, absorbed is removed", async () => {
    const res = await acceptPost(
      makeActionReq("proposal-merge-1", "accept", { decidedBy: "u" }),
      { params: makeParams("proposal-merge-1") },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(mockConceptDocs["stakwork/hive/swarm"]).toBe(body.proposal.documentation);
    expect(mockConceptDocs["stakwork/hive/janitors"]).toBeUndefined();
  });

  it("returns 404 when USE_MOCKS is false", async () => {
    mutableConfig.USE_MOCKS = false;
    const res = await acceptPost(
      makeActionReq("proposal-create-1", "accept", { decidedBy: "u" }),
      { params: makeParams("proposal-create-1") },
    );
    expect(res.status).toBe(404);
    expect(mockProposals.find((p) => p.id === "proposal-create-1")?.status).toBe("pending");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/mock/stakgraph/gitree/proposals/[id]/reject", () => {
  beforeEach(() => {
    mutableConfig.USE_MOCKS = true;
    resetMockProposals();
  });

  it("returns 401 when x-api-token is missing", async () => {
    const req = new NextRequest("http://localhost/.../reject", { method: "POST" });
    const res = await rejectPost(req, { params: makeParams("proposal-create-1") });
    expect(res.status).toBe(401);
  });

  it("rejects a pending proposal successfully", async () => {
    const res = await rejectPost(
      makeActionReq("proposal-create-1", "reject", {
        decidedBy: "user-xyz",
        reason: "not relevant",
      }),
      { params: makeParams("proposal-create-1") },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("success");
    expect(body.proposal.status).toBe("rejected");
    expect(body.proposal.decidedBy).toBe("user-xyz");
    expect(body.proposal.decisionReason).toBe("not relevant");
    expect(body.proposal.decidedAt).toBeDefined();
  });

  it("rejects without a reason (reason is optional)", async () => {
    const res = await rejectPost(
      makeActionReq("proposal-update-1", "reject", { decidedBy: "u" }),
      { params: makeParams("proposal-update-1") },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.proposal.status).toBe("rejected");
    expect(body.proposal.decisionReason).toBeUndefined();
  });

  it("returns 409 { error, status } when already accepted", async () => {
    // Accept first
    await acceptPost(
      makeActionReq("proposal-merge-1", "accept", { decidedBy: "u" }),
      { params: makeParams("proposal-merge-1") },
    );

    // Reject should now 409
    const res = await rejectPost(
      makeActionReq("proposal-merge-1", "reject", { decidedBy: "u" }),
      { params: makeParams("proposal-merge-1") },
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.status).toBe("accepted");
    expect(body.error).toBeDefined();
  });

  it("returns 409 { error, status } when already rejected", async () => {
    // Reject once
    await rejectPost(
      makeActionReq("proposal-update-1", "reject", { decidedBy: "u" }),
      { params: makeParams("proposal-update-1") },
    );

    // Reject again — should 409
    const res = await rejectPost(
      makeActionReq("proposal-update-1", "reject", { decidedBy: "u" }),
      { params: makeParams("proposal-update-1") },
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.status).toBe("rejected");
    expect(body.error).toBeDefined();
  });

  it("returns 404 for unknown proposal id", async () => {
    const res = await rejectPost(
      makeActionReq("no-such", "reject", {}),
      { params: makeParams("no-such") },
    );
    expect(res.status).toBe(404);
  });

  it("persists the rejected status so subsequent GET reflects the change", async () => {
    await rejectPost(
      makeActionReq("proposal-delete-1", "reject", { decidedBy: "u" }),
      { params: makeParams("proposal-delete-1") },
    );

    const res = await detailGet(makeDetailReq("proposal-delete-1"), {
      params: makeParams("proposal-delete-1"),
    });
    const body = await res.json();
    expect(body.proposal.status).toBe("rejected");
  });

  it("returns 404 when USE_MOCKS is false", async () => {
    mutableConfig.USE_MOCKS = false;
    const res = await rejectPost(
      makeActionReq("proposal-create-1", "reject", { decidedBy: "u" }),
      { params: makeParams("proposal-create-1") },
    );
    expect(res.status).toBe(404);
    expect(mockProposals.find((p) => p.id === "proposal-create-1")?.status).toBe("pending");
  });
});
