/**
 * Integration tests for the seed-stakwork-prompts script.
 *
 * The seed module is imported directly so we can call `seedPrompts()`.
 * Stakwork HTTP calls are intercepted via global.fetch mock — no real network.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a slim list-entry (no `value`) as Stakwork returns from the list endpoint. */
function makeListEntry(id: number, name: string, description = "") {
  return { id, name, description, usage_notation: null, run_count: 0 };
}

/** Build a full detail response as Stakwork returns from /api/v1/prompts/:id. */
function makeDetailResponse(id: number, name: string, value: string, description = "") {
  return {
    success: true,
    data: { id, name, value, description },
  };
}

/** Build a Pagy list-page response. */
function makeListPageResponse(entries: ReturnType<typeof makeListEntry>[]) {
  return {
    success: true,
    data: {
      total: entries.length,
      size: entries.length,
      prompts: entries,
    },
  };
}

/** Make a Response-like object from a plain JSON value. */
function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response);
}

// ── Test data ─────────────────────────────────────────────────────────────────

const PROMPT_A = { id: 1, name: "PROMPT_ALPHA", value: "Alpha value", description: "Desc A" };
const PROMPT_B = { id: 2, name: "PROMPT_BETA", value: "Beta value", description: "Desc B" };
const PROMPT_C = { id: 3, name: "PROMPT_GAMMA", value: "Gamma value", description: "Desc C" };

// ── Import the seeder ─────────────────────────────────────────────────────────

// We import the seeder logic directly instead of running the CLI entry point
// so we can control fetch + env without spawning a subprocess.
// The seed script exports a `seedPrompts` function for testability.
import { seedPrompts } from "@/services/prompts/seed-stakwork-prompts";

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("seed-stakwork-prompts", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Set required env for the seeder
    process.env.STAKWORK_BASE_URL = "https://api.stakwork.test";
    process.env.STAKWORK_API_KEY = "test-key";

    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(async () => {
    vi.restoreAllMocks();

    // Clean up any seeded prompts created during tests
    await db.promptVersion.deleteMany({
      where: { whodunnit: "stakwork-seed" },
    });
    await db.prompt.deleteMany({
      where: { name: { in: [PROMPT_A.name, PROMPT_B.name, PROMPT_C.name] } },
    });
  });

  // ── Basic single-page seed ──────────────────────────────────────────────────

  describe("single page of prompts", () => {
    test("creates Prompt and PromptVersion rows for each Stakwork prompt", async () => {
      // Page 1: 2 prompts (< 20 → last page)
      mockFetch
        .mockImplementationOnce(() =>
          jsonResponse(makeListPageResponse([
            makeListEntry(PROMPT_A.id, PROMPT_A.name, PROMPT_A.description),
            makeListEntry(PROMPT_B.id, PROMPT_B.name, PROMPT_B.description),
          ]))
        )
        .mockImplementationOnce(() => jsonResponse(makeDetailResponse(PROMPT_A.id, PROMPT_A.name, PROMPT_A.value, PROMPT_A.description)))
        .mockImplementationOnce(() => jsonResponse(makeDetailResponse(PROMPT_B.id, PROMPT_B.name, PROMPT_B.value, PROMPT_B.description)));

      const result = await seedPrompts();

      expect(result.pagesFetched).toBe(1);
      expect(result.totalSeen).toBe(2);
      expect(result.totalCreated).toBe(2);
      expect(result.totalSkipped).toBe(0);
      expect(result.totalErrors).toBe(0);

      // Verify Prompt rows
      const promptA = await db.prompt.findUnique({ where: { name: PROMPT_A.name } });
      expect(promptA).not.toBeNull();
      expect(promptA!.value).toBe(PROMPT_A.value);
      expect(promptA!.stakworkId).toBe(PROMPT_A.id);
      expect(promptA!.syncStatus).toBe("OK");
      expect(promptA!.lastSyncedAt).not.toBeNull();
      expect(promptA!.publishedVersionId).not.toBeNull();

      const promptB = await db.prompt.findUnique({ where: { name: PROMPT_B.name } });
      expect(promptB).not.toBeNull();
      expect(promptB!.value).toBe(PROMPT_B.value);

      // Verify PromptVersion rows
      const versionA = await db.promptVersion.findFirst({
        where: { promptId: promptA!.id },
      });
      expect(versionA).not.toBeNull();
      expect(versionA!.versionNumber).toBe(1);
      expect(versionA!.value).toBe(PROMPT_A.value);
      expect(versionA!.published).toBe(true);
      expect(versionA!.whodunnit).toBe("stakwork-seed");

      // Verify LIVE = PUBLISHED invariant
      expect(promptA!.publishedVersionId).toBe(versionA!.id);
      expect(promptA!.value).toBe(versionA!.value);
    });
  });

  // ── Multi-page pagination ───────────────────────────────────────────────────

  describe("multi-page pagination", () => {
    test("drains all pages when total > 20 (e.g. total=22 → 2 pages)", async () => {
      // Build 22 prompts: page 1 has 20, page 2 has 2
      const allPrompts = Array.from({ length: 22 }, (_, i) => ({
        id: 100 + i,
        name: `SEED_TEST_PROMPT_${i}`,
        value: `Value ${i}`,
        description: `Desc ${i}`,
      }));
      const page1 = allPrompts.slice(0, 20);
      const page2 = allPrompts.slice(20);

      // Page 1 list (size=20 → more pages follow)
      mockFetch.mockImplementationOnce(() =>
        jsonResponse({
          success: true,
          data: { total: 22, size: 20, prompts: page1.map((p) => makeListEntry(p.id, p.name, p.description)) },
        })
      );
      // Detail calls for page 1 (20 prompts)
      for (const p of page1) {
        mockFetch.mockImplementationOnce(() => jsonResponse(makeDetailResponse(p.id, p.name, p.value, p.description)));
      }

      // Page 2 list (size=2 → last page)
      mockFetch.mockImplementationOnce(() =>
        jsonResponse({
          success: true,
          data: { total: 22, size: 2, prompts: page2.map((p) => makeListEntry(p.id, p.name, p.description)) },
        })
      );
      // Detail calls for page 2 (2 prompts)
      for (const p of page2) {
        mockFetch.mockImplementationOnce(() => jsonResponse(makeDetailResponse(p.id, p.name, p.value, p.description)));
      }

      const result = await seedPrompts();

      expect(result.pagesFetched).toBe(2);
      expect(result.totalSeen).toBe(22);
      expect(result.totalCreated).toBe(22);
      expect(result.totalSkipped).toBe(0);

      // Spot-check first and last
      const first = await db.prompt.findUnique({ where: { name: allPrompts[0].name } });
      const last = await db.prompt.findUnique({ where: { name: allPrompts[21].name } });
      expect(first).not.toBeNull();
      expect(last).not.toBeNull();

      // Cleanup extra rows beyond the 3 standard ones
      await db.promptVersion.deleteMany({
        where: { promptId: { in: (await db.prompt.findMany({ where: { name: { startsWith: "SEED_TEST_PROMPT_" } } })).map((p) => p.id) } },
      });
      await db.prompt.deleteMany({ where: { name: { startsWith: "SEED_TEST_PROMPT_" } } });
    });
  });

  // ── Idempotency ─────────────────────────────────────────────────────────────

  describe("idempotency", () => {
    test("second run skips existing prompts and does not overwrite them", async () => {
      // Arrange: pre-create PROMPT_A with a custom value (simulates local edit)
      const localValue = "Locally edited value — must not be overwritten";

      const created = await db.prompt.create({
        data: {
          name: PROMPT_A.name,
          value: localValue,
          stakworkId: PROMPT_A.id,
          syncStatus: "OK",
          lastSyncedAt: new Date(),
        },
      });
      const v1 = await db.promptVersion.create({
        data: {
          promptId: created.id,
          versionNumber: 1,
          value: localValue,
          published: true,
          whodunnit: "stakwork-seed",
        },
      });
      await db.prompt.update({
        where: { id: created.id },
        data: { publishedVersionId: v1.id },
      });

      // Seed tries to import PROMPT_A (should skip) + PROMPT_B (should create)
      mockFetch
        .mockImplementationOnce(() =>
          jsonResponse(makeListPageResponse([
            makeListEntry(PROMPT_A.id, PROMPT_A.name, PROMPT_A.description),
            makeListEntry(PROMPT_B.id, PROMPT_B.name, PROMPT_B.description),
          ]))
        )
        // PROMPT_A detail is still fetched — then skipped at persist step
        .mockImplementationOnce(() => jsonResponse(makeDetailResponse(PROMPT_A.id, PROMPT_A.name, PROMPT_A.value, PROMPT_A.description)))
        .mockImplementationOnce(() => jsonResponse(makeDetailResponse(PROMPT_B.id, PROMPT_B.name, PROMPT_B.value, PROMPT_B.description)));

      const result = await seedPrompts();

      expect(result.totalCreated).toBe(1); // PROMPT_B
      expect(result.totalSkipped).toBe(1); // PROMPT_A

      // PROMPT_A must be unchanged
      const unchanged = await db.prompt.findUnique({ where: { name: PROMPT_A.name } });
      expect(unchanged!.value).toBe(localValue);
      const versions = await db.promptVersion.findMany({ where: { promptId: unchanged!.id } });
      expect(versions).toHaveLength(1); // no new version created
    });

    test("re-running seed against all existing prompts creates nothing", async () => {
      // Pre-create both prompts
      for (const p of [PROMPT_A, PROMPT_B]) {
        const pr = await db.prompt.create({
          data: {
            name: p.name,
            value: p.value,
            stakworkId: p.id,
            syncStatus: "OK",
            lastSyncedAt: new Date(),
          },
        });
        const v = await db.promptVersion.create({
          data: {
            promptId: pr.id,
            versionNumber: 1,
            value: p.value,
            published: true,
            whodunnit: "stakwork-seed",
          },
        });
        await db.prompt.update({
          where: { id: pr.id },
          data: { publishedVersionId: v.id },
        });
      }

      mockFetch
        .mockImplementationOnce(() =>
          jsonResponse(makeListPageResponse([
            makeListEntry(PROMPT_A.id, PROMPT_A.name),
            makeListEntry(PROMPT_B.id, PROMPT_B.name),
          ]))
        )
        .mockImplementationOnce(() => jsonResponse(makeDetailResponse(PROMPT_A.id, PROMPT_A.name, PROMPT_A.value)))
        .mockImplementationOnce(() => jsonResponse(makeDetailResponse(PROMPT_B.id, PROMPT_B.name, PROMPT_B.value)));

      const result = await seedPrompts();

      expect(result.totalCreated).toBe(0);
      expect(result.totalSkipped).toBe(2);
      expect(result.totalErrors).toBe(0);
    });
  });

  // ── Error resilience ────────────────────────────────────────────────────────

  describe("error resilience", () => {
    test("continues past per-prompt detail fetch failure and counts errors", async () => {
      // Page 1: PROMPT_A (detail fails), PROMPT_B (detail succeeds)
      mockFetch
        .mockImplementationOnce(() =>
          jsonResponse(makeListPageResponse([
            makeListEntry(PROMPT_A.id, PROMPT_A.name),
            makeListEntry(PROMPT_B.id, PROMPT_B.name),
          ]))
        )
        // PROMPT_A detail → 500
        .mockImplementationOnce(() => jsonResponse({ error: "server error" }, 500))
        // PROMPT_B detail → success
        .mockImplementationOnce(() => jsonResponse(makeDetailResponse(PROMPT_B.id, PROMPT_B.name, PROMPT_B.value)));

      const result = await seedPrompts();

      expect(result.totalErrors).toBe(1);
      expect(result.totalCreated).toBe(1); // PROMPT_B created
      expect(result.totalSkipped).toBe(0);

      // PROMPT_B should exist; PROMPT_A should not
      const b = await db.prompt.findUnique({ where: { name: PROMPT_B.name } });
      expect(b).not.toBeNull();

      const a = await db.prompt.findUnique({ where: { name: PROMPT_A.name } });
      expect(a).toBeNull();
    });
  });

  // ── LIVE = PUBLISHED invariant ──────────────────────────────────────────────

  describe("LIVE = PUBLISHED invariant", () => {
    test("Prompt.value equals the published PromptVersion.value after seed", async () => {
      mockFetch
        .mockImplementationOnce(() =>
          jsonResponse(makeListPageResponse([makeListEntry(PROMPT_C.id, PROMPT_C.name, PROMPT_C.description)]))
        )
        .mockImplementationOnce(() =>
          jsonResponse(makeDetailResponse(PROMPT_C.id, PROMPT_C.name, PROMPT_C.value, PROMPT_C.description))
        );

      await seedPrompts();

      const prompt = await db.prompt.findUnique({
        where: { name: PROMPT_C.name },
        include: { publishedVersion: true },
      });

      expect(prompt).not.toBeNull();
      expect(prompt!.publishedVersion).not.toBeNull();
      expect(prompt!.value).toBe(prompt!.publishedVersion!.value);
      expect(prompt!.publishedVersionId).toBe(prompt!.publishedVersion!.id);
    });
  });
});
