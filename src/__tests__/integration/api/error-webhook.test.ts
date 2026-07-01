/**
 * Integration tests for POST /api/webhook/errors
 *
 * Verifies: auth (missing/invalid/revoked key → 401), IDOR guard,
 * payload validation (→ 400), first-occurrence create, same-fingerprint
 * upsert (count increments), client fingerprint override, Pusher broadcast.
 */

import { describe, test, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import { put } from "@vercel/blob";
import { db } from "@/lib/db";
import {
  generateUniqueId,
  generateUniqueSlug,
  generateUniqueEmail,
} from "@/__tests__/support/helpers";
import { generateApiKey, hashApiKey, getKeyPrefix } from "@/lib/api-keys";

// ── Pusher mock ───────────────────────────────────────────────────────────────
const { mockPusherTrigger } = vi.hoisted(() => ({
  mockPusherTrigger: vi.fn(),
}));

vi.mock("@/lib/pusher", async () => {
  const actual = await vi.importActual("@/lib/pusher");
  return {
    ...actual,
    pusherServer: { trigger: mockPusherTrigger },
  };
});

// ── Blob mock — avoids real network calls ─────────────────────────────────────
vi.mock("@vercel/blob", () => ({
  put: vi.fn().mockResolvedValue({ url: "https://blob.example.com/error-event.json" }),
}));

import { POST } from "@/app/api/webhook/errors/route";
import { NextRequest } from "next/server";

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildRequest(
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): NextRequest {
  return new NextRequest("http://localhost/api/webhook/errors", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function bearerHeaders(key: string) {
  return { Authorization: `Bearer ${key}` };
}

function xApiKeyHeaders(key: string) {
  return { "x-api-key": key };
}

const VALID_PAYLOAD = {
  exceptionType: "TypeError",
  message: "Cannot read properties of undefined (reading 'id')",
  stackTrace: [
    "TypeError: Cannot read properties of undefined (reading 'id')",
    "    at resolveUser (/app/src/lib/auth.ts:42:20)",
    "    at async POST (/app/src/app/api/users/route.ts:18:14)",
  ].join("\n"),
  environment: "production",
  release: "v1.0.0",
};

// ── Test setup ────────────────────────────────────────────────────────────────

interface TestSetup {
  owner: { id: string };
  workspace: { id: string; slug: string };
  rawKey: string;
}

async function createTestSetup(): Promise<TestSetup> {
  return db.$transaction(async (tx) => {
    const owner = await tx.user.create({
      data: {
        id: generateUniqueId("user"),
        email: generateUniqueEmail("error-webhook"),
        name: "Error Test Owner",
      },
    });

    const workspace = await tx.workspace.create({
      data: {
        id: generateUniqueId("workspace"),
        name: "Error Test Workspace",
        slug: generateUniqueSlug("err-ws"),
        ownerId: owner.id,
      },
    });

    // Create a valid, non-revoked, non-expired API key for the workspace
    const rawKey = generateApiKey(workspace.id);
    await tx.workspaceApiKey.create({
      data: {
        workspaceId: workspace.id,
        name: "Test Ingest Key",
        keyPrefix: getKeyPrefix(rawKey),
        keyHash: hashApiKey(rawKey),
        createdById: owner.id,
      },
    });

    return { owner, workspace, rawKey };
  });
}

async function cleanup(workspaceId: string, ownerId: string) {
  await db.errorEvent.deleteMany({ where: { workspaceId } });
  await db.errorIssue.deleteMany({ where: { workspaceId } });
  await db.workspaceApiKey.deleteMany({ where: { workspaceId } });
  await db.workspace.deleteMany({ where: { id: workspaceId } });
  await db.user.deleteMany({ where: { id: ownerId } });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/webhook/errors", () => {
  let setup: TestSetup;

  beforeEach(async () => {
    vi.clearAllMocks();
    setup = await createTestSetup();
  });

  afterEach(async () => {
    await cleanup(setup.workspace.id, setup.owner.id);
  });

  // ── Auth ────────────────────────────────────────────────────────────────────

  describe("Auth", () => {
    test("returns 401 when no auth header is provided", async () => {
      const req = buildRequest(VALID_PAYLOAD);
      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    test("returns 401 for an invalid/unknown key (Bearer)", async () => {
      const req = buildRequest(VALID_PAYLOAD, bearerHeaders("hive_bad_totallywrongkey12345"));
      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    test("returns 401 for an invalid/unknown key (x-api-key)", async () => {
      const req = buildRequest(VALID_PAYLOAD, xApiKeyHeaders("hive_bad_totallywrongkey12345"));
      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    test("returns 401 for a revoked key", async () => {
      // Revoke the key
      await db.workspaceApiKey.updateMany({
        where: { workspaceId: setup.workspace.id },
        data: { revokedAt: new Date() },
      });

      const req = buildRequest(VALID_PAYLOAD, bearerHeaders(setup.rawKey));
      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    test("returns 401 for an expired key", async () => {
      // Set expiry to past
      await db.workspaceApiKey.updateMany({
        where: { workspaceId: setup.workspace.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const req = buildRequest(VALID_PAYLOAD, bearerHeaders(setup.rawKey));
      const res = await POST(req);
      expect(res.status).toBe(401);
    });

    test("accepts a valid key via Authorization: Bearer", async () => {
      const req = buildRequest(VALID_PAYLOAD, bearerHeaders(setup.rawKey));
      const res = await POST(req);
      expect(res.status).toBe(201);
    });

    test("accepts a valid key via x-api-key header", async () => {
      const req = buildRequest(VALID_PAYLOAD, xApiKeyHeaders(setup.rawKey));
      const res = await POST(req);
      expect(res.status).toBe(201);
    });
  });

  // ── IDOR guard ───────────────────────────────────────────────────────────────

  describe("IDOR guard", () => {
    test("uses workspace from the key, not from body workspaceId", async () => {
      // Set up a second workspace the attacker wants to write to
      const victim = await db.$transaction(async (tx) => {
        const owner = await tx.user.create({
          data: {
            id: generateUniqueId("victim-user"),
            email: generateUniqueEmail("victim"),
            name: "Victim Owner",
          },
        });
        const ws = await tx.workspace.create({
          data: {
            id: generateUniqueId("victim-ws"),
            name: "Victim Workspace",
            slug: generateUniqueSlug("victim"),
            ownerId: owner.id,
          },
        });
        return { owner, ws };
      });

      // Attacker uses their own valid key but spoofs the victim's workspaceId in body
      const req = buildRequest(
        { ...VALID_PAYLOAD, workspaceId: victim.ws.id },
        bearerHeaders(setup.rawKey)
      );
      const res = await POST(req);
      expect(res.status).toBe(201);

      // Issue must be scoped to the attacker's workspace, not the victim's
      const victimIssues = await db.errorIssue.findMany({
        where: { workspaceId: victim.ws.id },
      });
      expect(victimIssues).toHaveLength(0);

      const attackerIssues = await db.errorIssue.findMany({
        where: { workspaceId: setup.workspace.id },
      });
      expect(attackerIssues).toHaveLength(1);

      // Cleanup victim
      await db.errorEvent.deleteMany({ where: { workspaceId: victim.ws.id } });
      await db.errorIssue.deleteMany({ where: { workspaceId: victim.ws.id } });
      await db.workspace.delete({ where: { id: victim.ws.id } });
      await db.user.delete({ where: { id: victim.owner.id } });
    });
  });

  // ── Payload validation ───────────────────────────────────────────────────────

  describe("Payload validation", () => {
    test("returns 400 when exceptionType is missing", async () => {
      const { exceptionType: _, ...body } = VALID_PAYLOAD;
      const req = buildRequest(body, bearerHeaders(setup.rawKey));
      const res = await POST(req);
      expect(res.status).toBe(400);
    });

    test("returns 400 when message is missing", async () => {
      const { message: _, ...body } = VALID_PAYLOAD;
      const req = buildRequest(body, bearerHeaders(setup.rawKey));
      const res = await POST(req);
      expect(res.status).toBe(400);
    });
  });

  // ── First-occurrence create ──────────────────────────────────────────────────

  describe("First occurrence", () => {
    test("creates a new ErrorIssue and ErrorEvent on first occurrence", async () => {
      const req = buildRequest(VALID_PAYLOAD, bearerHeaders(setup.rawKey));
      const res = await POST(req);

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.isNew).toBe(true);
      expect(body.data.occurrenceCount).toBe(1);
      expect(body.data.issueId).toBeTruthy();
      expect(body.data.eventId).toBeTruthy();
      expect(body.data.fingerprint).toBeTruthy();

      // DB assertions
      const issue = await db.errorIssue.findUnique({
        where: { id: body.data.issueId },
      });
      expect(issue).not.toBeNull();
      expect(issue!.workspaceId).toBe(setup.workspace.id);
      expect(issue!.occurrenceCount).toBe(1);
      expect(issue!.status).toBe("UNRESOLVED");
      expect(issue!.exceptionType).toBe(VALID_PAYLOAD.exceptionType);
      expect(issue!.title).toBe(VALID_PAYLOAD.message);
      expect(issue!.environment).toBe(VALID_PAYLOAD.environment);
      expect(issue!.release).toBe(VALID_PAYLOAD.release);

      const event = await db.errorEvent.findUnique({
        where: { id: body.data.eventId },
      });
      expect(event).not.toBeNull();
      expect(event!.issueId).toBe(issue!.id);
      expect(event!.workspaceId).toBe(setup.workspace.id);
      expect(event!.blobUrl).toBe("https://blob.example.com/error-event.json");
    });

    test("uploads raw payload to Vercel Blob", async () => {
      const req = buildRequest(VALID_PAYLOAD, bearerHeaders(setup.rawKey));
      await POST(req);

      expect(put).toHaveBeenCalledOnce();
      const [blobPath, , blobOpts] = (put as Mock).mock.calls[0];
      expect(blobPath).toContain(`errors/${setup.workspace.id}/`);
      expect(blobPath).toMatch(/\.json$/);
      expect(blobOpts.access).toBe("private");
      expect(blobOpts.contentType).toBe("application/json");
    });
  });

  // ── Upsert on repeated occurrence ────────────────────────────────────────────

  describe("Repeated occurrence (upsert)", () => {
    test("increments occurrenceCount and updates lastSeenAt on second occurrence with same fingerprint", async () => {
      // First occurrence
      const res1 = await POST(buildRequest(VALID_PAYLOAD, bearerHeaders(setup.rawKey)));
      expect(res1.status).toBe(201);
      const body1 = await res1.json();
      expect(body1.data.isNew).toBe(true);
      expect(body1.data.occurrenceCount).toBe(1);

      const firstIssue = await db.errorIssue.findUnique({ where: { id: body1.data.issueId } });
      const firstSeenAt = firstIssue!.firstSeenAt;
      const firstLastSeenAt = firstIssue!.lastSeenAt;

      // Small delay so lastSeenAt can differ
      await new Promise((r) => setTimeout(r, 5));

      // Second occurrence — same payload → same fingerprint
      const res2 = await POST(buildRequest(VALID_PAYLOAD, bearerHeaders(setup.rawKey)));
      expect(res2.status).toBe(201);
      const body2 = await res2.json();
      expect(body2.data.isNew).toBe(false);
      expect(body2.data.occurrenceCount).toBe(2);
      expect(body2.data.issueId).toBe(body1.data.issueId); // same issue

      const updatedIssue = await db.errorIssue.findUnique({ where: { id: body1.data.issueId } });
      expect(updatedIssue!.occurrenceCount).toBe(2);
      expect(updatedIssue!.firstSeenAt.getTime()).toBe(firstSeenAt.getTime()); // unchanged
      expect(updatedIssue!.lastSeenAt.getTime()).toBeGreaterThanOrEqual(firstLastSeenAt.getTime());

      // No duplicate issue row
      const issues = await db.errorIssue.findMany({
        where: { workspaceId: setup.workspace.id, fingerprint: body1.data.fingerprint },
      });
      expect(issues).toHaveLength(1);
    });

    test("does not reset status when a resolved issue receives a new occurrence", async () => {
      // Create first occurrence
      const res1 = await POST(buildRequest(VALID_PAYLOAD, bearerHeaders(setup.rawKey)));
      const { issueId } = (await res1.json()).data;

      // Mark as resolved
      await db.errorIssue.update({ where: { id: issueId }, data: { status: "RESOLVED" } });

      // New occurrence — status must remain RESOLVED
      const res2 = await POST(buildRequest(VALID_PAYLOAD, bearerHeaders(setup.rawKey)));
      expect(res2.status).toBe(201);
      const body2 = await res2.json();
      expect(body2.data.occurrenceCount).toBe(2);

      const issue = await db.errorIssue.findUnique({ where: { id: issueId } });
      expect(issue!.status).toBe("RESOLVED");
    });

    test("creates two distinct ErrorIssues for different errors", async () => {
      await POST(buildRequest(VALID_PAYLOAD, bearerHeaders(setup.rawKey)));
      await POST(
        buildRequest(
          { exceptionType: "ReferenceError", message: "fetch is not defined" },
          bearerHeaders(setup.rawKey)
        )
      );

      const issues = await db.errorIssue.findMany({
        where: { workspaceId: setup.workspace.id },
      });
      expect(issues).toHaveLength(2);
    });
  });

  // ── Client-supplied fingerprint ──────────────────────────────────────────────

  describe("Client fingerprint override", () => {
    test("groups by client fingerprint, not the computed default", async () => {
      const clientFp = "my-custom-fingerprint-group";

      // Two occurrences with different stacks but same client fingerprint
      await POST(
        buildRequest(
          { ...VALID_PAYLOAD, fingerprint: clientFp },
          bearerHeaders(setup.rawKey)
        )
      );
      await POST(
        buildRequest(
          {
            exceptionType: "TypeError",
            message: "Different message entirely",
            stackTrace: "TypeError: Different\n    at someOtherFunction (/app/other.ts:5:1)",
            fingerprint: clientFp,
          },
          bearerHeaders(setup.rawKey)
        )
      );

      const issues = await db.errorIssue.findMany({
        where: { workspaceId: setup.workspace.id, fingerprint: clientFp },
      });
      // Should be exactly one issue with occurrenceCount=2
      expect(issues).toHaveLength(1);
      expect(issues[0].occurrenceCount).toBe(2);
    });

    test("client fingerprint creates a distinct issue from the computed fingerprint", async () => {
      // One with client fingerprint
      await POST(
        buildRequest(
          { ...VALID_PAYLOAD, fingerprint: "custom-fp" },
          bearerHeaders(setup.rawKey)
        )
      );
      // One without (falls back to computed)
      await POST(buildRequest(VALID_PAYLOAD, bearerHeaders(setup.rawKey)));

      const issues = await db.errorIssue.findMany({
        where: { workspaceId: setup.workspace.id },
      });
      expect(issues).toHaveLength(2);
    });
  });

  // ── Pusher broadcast ─────────────────────────────────────────────────────────

  describe("Pusher broadcast", () => {
    test("triggers ERROR_ISSUE_UPDATED on the workspace channel", async () => {
      const req = buildRequest(VALID_PAYLOAD, bearerHeaders(setup.rawKey));
      await POST(req);

      expect(mockPusherTrigger).toHaveBeenCalledOnce();
      const [channel, event, payload] = mockPusherTrigger.mock.calls[0];
      expect(channel).toBe(`workspace-${setup.workspace.slug}`);
      expect(event).toBe("error-issue-updated");
      expect(payload.isNew).toBe(true);
      expect(payload.occurrenceCount).toBe(1);
      expect(payload.fingerprint).toBeTruthy();
      expect(payload.id).toBeTruthy();
      expect(payload.status).toBe("UNRESOLVED");
    });

    test("does not fail the request when Pusher throws", async () => {
      mockPusherTrigger.mockRejectedValueOnce(new Error("Pusher down"));

      const req = buildRequest(VALID_PAYLOAD, bearerHeaders(setup.rawKey));
      const res = await POST(req);
      // Route should still return 201
      expect(res.status).toBe(201);
    });
  });
});
