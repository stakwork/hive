import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";

/**
 * Integration tests for Prompt + PromptVersion data models.
 * Schema-level verification only — no routes, seed, or sync logic.
 */

describe("Prompt + PromptVersion data models", () => {
  // Unique name prefix per test run to avoid collisions between parallel runs
  const prefix = `TEST_${Date.now()}`;

  afterEach(async () => {
    // Clean up any prompts created in this test suite
    await db.prompt.deleteMany({
      where: { name: { startsWith: "TEST_" } },
    });
  });

  // ─── Core invariant ─────────────────────────────────────────────────────────

  describe("LIVE = PUBLISHED invariant (Prompt.value = published version cache)", () => {
    it("creates a Prompt with 3 PromptVersions: v2 published, v3 is an unpublished draft", async () => {
      const name = `${prefix}_V3`;

      // Create prompt with 3 versions: v2 is the published/live one, v3 is an unpublished draft.
      // This mirrors the new save behavior: Save creates an unpublished draft (v3),
      // leaving the prior published version (v2) as live.
      const prompt = await db.prompt.create({
        data: {
          name,
          value: "version 2 text", // Prompt.value = published cache (v2), NOT the draft (v3)
          description: "Test prompt",
          versions: {
            create: [
              { versionNumber: 1, value: "version 1 text", whodunnit: "user-1", published: false },
              { versionNumber: 2, value: "version 2 text", whodunnit: "user-2", published: true },
              { versionNumber: 3, value: "version 3 text", whodunnit: "user-3", published: false }, // draft
            ],
          },
        },
        include: { versions: { orderBy: { versionNumber: "asc" } } },
      });

      // Point publishedVersionId at v2 (the published version), leaving v3 as unpublished draft.
      const publishedVersion = prompt.versions.find((v) => v.published)!;
      const latestDraft = prompt.versions.find((v) => v.versionNumber === 3)!;
      const updated = await db.prompt.update({
        where: { id: prompt.id },
        data: {
          publishedVersionId: publishedVersion.id,
          // Prompt.value stays as published value — draft does NOT overwrite this
          value: publishedVersion.value,
        },
        include: {
          versions: { orderBy: { versionNumber: "asc" } },
          publishedVersion: true,
        },
      });

      // Assertions
      expect(updated.versions).toHaveLength(3);
      expect(updated.publishedVersionId).toBe(publishedVersion.id);
      // Prompt.value mirrors the PUBLISHED (live) version, not the draft
      expect(updated.value).toBe("version 2 text");
      expect(updated.publishedVersion?.value).toBe("version 2 text");
      expect(updated.publishedVersion?.published).toBe(true);

      // The draft (v3) exists but is NOT published — current != published
      const draft = updated.versions.find((v) => v.id === latestDraft.id)!;
      expect(draft.published).toBe(false);
      expect(draft.versionNumber).toBe(3);

      // published_version_id != current (latest) version id — that's the whole point
      expect(updated.publishedVersionId).not.toBe(draft.id);

      // Only v2 is published; v1 and v3 are not
      const unpublished = updated.versions.filter((v) => !v.published);
      expect(unpublished).toHaveLength(2);
    });

    it("can publish an OLDER version as live (publish-prior-version use-case)", async () => {
      const name = `${prefix}_OLDER`;

      // Start with v1 published, then switch to publish v2, then revert to v1
      const prompt = await db.prompt.create({
        data: {
          name,
          value: "v1 text",
          versions: {
            create: [
              { versionNumber: 1, value: "v1 text", published: false },
              { versionNumber: 2, value: "v2 text", published: false },
            ],
          },
        },
        include: { versions: { orderBy: { versionNumber: "asc" } } },
      });

      const [v1, v2] = prompt.versions;

      // Publish v2 first
      await db.$transaction([
        db.promptVersion.updateMany({ where: { promptId: prompt.id }, data: { published: false } }),
        db.promptVersion.update({ where: { id: v2.id }, data: { published: true } }),
        db.prompt.update({ where: { id: prompt.id }, data: { value: v2.value, publishedVersionId: v2.id } }),
      ]);

      // Now publish the OLDER v1 — this is the key invariant
      await db.$transaction([
        db.promptVersion.updateMany({ where: { promptId: prompt.id }, data: { published: false } }),
        db.promptVersion.update({ where: { id: v1.id }, data: { published: true } }),
        db.prompt.update({ where: { id: prompt.id }, data: { value: v1.value, publishedVersionId: v1.id } }),
      ]);

      const final = await db.prompt.findUnique({
        where: { id: prompt.id },
        include: { versions: { orderBy: { versionNumber: "asc" } }, publishedVersion: true },
      });

      expect(final!.publishedVersionId).toBe(v1.id);
      expect(final!.value).toBe("v1 text");
      expect(final!.publishedVersion?.versionNumber).toBe(1);
      // v2 is no longer published
      expect(final!.versions.find((v) => v.id === v2.id)?.published).toBe(false);
    });
  });

  // ─── Cascade delete ──────────────────────────────────────────────────────────

  describe("Cascade delete", () => {
    it("deleting a Prompt removes all its PromptVersion rows", async () => {
      const name = `${prefix}_CASCADE`;

      const prompt = await db.prompt.create({
        data: {
          name,
          value: "some value",
          versions: {
            create: [
              { versionNumber: 1, value: "v1", published: true },
              { versionNumber: 2, value: "v2", published: false },
            ],
          },
        },
        include: { versions: true },
      });

      const promptId = prompt.id;
      const versionIds = prompt.versions.map((v) => v.id);

      // Delete the prompt — should cascade to versions
      await db.prompt.delete({ where: { id: promptId } });

      // Prompt should be gone
      const foundPrompt = await db.prompt.findUnique({ where: { id: promptId } });
      expect(foundPrompt).toBeNull();

      // All versions should be gone
      const foundVersions = await db.promptVersion.findMany({
        where: { id: { in: versionIds } },
      });
      expect(foundVersions).toHaveLength(0);
    });
  });

  // ─── PromptVersion unique (promptId, versionNumber) constraint ──────────────

  describe("PromptVersion unique (promptId, versionNumber) constraint", () => {
    it("rejects a duplicate versionNumber for the same prompt", async () => {
      const name = `${prefix}_UNIQUE_VER`;

      const prompt = await db.prompt.create({
        data: {
          name,
          value: "v1",
          versions: { create: [{ versionNumber: 1, value: "v1", published: true }] },
        },
        include: { versions: true },
      });
      await db.prompt.update({
        where: { id: prompt.id },
        data: { publishedVersionId: prompt.versions[0].id },
      });

      // Attempting to create a second versionNumber=1 for the same prompt should fail
      await expect(
        db.promptVersion.create({
          data: { promptId: prompt.id, versionNumber: 1, value: "duplicate v1", published: false },
        }),
      ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);

      try {
        await db.promptVersion.create({
          data: { promptId: prompt.id, versionNumber: 1, value: "duplicate v1", published: false },
        });
      } catch (err) {
        expect(err).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
        expect((err as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");
      }
    });

    it("allows the same versionNumber for DIFFERENT prompts", async () => {
      const nameA = `${prefix}_UNIQUE_VER_A`;
      const nameB = `${prefix}_UNIQUE_VER_B`;

      const promptA = await db.prompt.create({ data: { name: nameA, value: "a" } });
      const promptB = await db.prompt.create({ data: { name: nameB, value: "b" } });

      // Both can have versionNumber=1
      const vA = await db.promptVersion.create({
        data: { promptId: promptA.id, versionNumber: 1, value: "a v1", published: true },
      });
      const vB = await db.promptVersion.create({
        data: { promptId: promptB.id, versionNumber: 1, value: "b v1", published: true },
      });

      expect(vA.versionNumber).toBe(1);
      expect(vB.versionNumber).toBe(1);
    });
  });

  // ─── Unique name constraint ──────────────────────────────────────────────────

  describe("Unique name constraint", () => {
    it("returns a constraint error when creating a Prompt with a duplicate name", async () => {
      const name = `${prefix}_UNIQUE`;

      // Create the first prompt
      await db.prompt.create({
        data: { name, value: "first" },
      });

      // Attempt to create a second prompt with the same name
      await expect(
        db.prompt.create({ data: { name, value: "second" } })
      ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);

      // Also verify error code is a unique constraint violation
      try {
        await db.prompt.create({ data: { name, value: "third" } });
      } catch (err) {
        expect(err).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
        expect((err as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");
      }
    });
  });

  // ─── Default values & indexes ────────────────────────────────────────────────

  describe("Default values", () => {
    it("sets syncStatus to OK by default", async () => {
      const name = `${prefix}_DEFAULTS`;

      const prompt = await db.prompt.create({
        data: { name, value: "hello" },
      });

      expect(prompt.syncStatus).toBe("OK");
      expect(prompt.publishedVersionId).toBeNull();
      expect(prompt.stakworkId).toBeNull();
      expect(prompt.lastSyncedAt).toBeNull();
    });

    it("sets PromptVersion.published to false by default", async () => {
      const name = `${prefix}_VER_DEFAULT`;

      const prompt = await db.prompt.create({
        data: {
          name,
          value: "hello",
          versions: {
            create: [{ versionNumber: 1, value: "v1" }],
          },
        },
        include: { versions: true },
      });

      expect(prompt.versions[0].published).toBe(false);
      expect(prompt.versions[0].whodunnit).toBeNull();
    });
  });

  // ─── Exact version replay ────────────────────────────────────────────────────

  describe("Exact version replay", () => {
    it("fetches the exact text of any prior version by id", async () => {
      const name = `${prefix}_REPLAY`;

      const prompt = await db.prompt.create({
        data: {
          name,
          value: "v3 is live",
          versions: {
            create: [
              { versionNumber: 1, value: "original prompt text", published: false, whodunnit: "stakwork-seed" },
              { versionNumber: 2, value: "slightly improved", published: false, whodunnit: "user-abc" },
              { versionNumber: 3, value: "v3 is live", published: true, whodunnit: "user-abc" },
            ],
          },
        },
        include: { versions: { orderBy: { versionNumber: "asc" } } },
      });

      const v1 = prompt.versions[0];

      // Exact replay: fetch v1's value directly — a plain DB read, no diff math
      const fetched = await db.promptVersion.findUnique({ where: { id: v1.id } });
      expect(fetched).not.toBeNull();
      expect(fetched!.value).toBe("original prompt text");
      expect(fetched!.versionNumber).toBe(1);
      expect(fetched!.whodunnit).toBe("stakwork-seed");
    });
  });
});
