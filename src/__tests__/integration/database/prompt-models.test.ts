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

  describe("LIVE = PUBLISHED invariant", () => {
    it("creates a Prompt with 3 PromptVersions and published state is consistent", async () => {
      const name = `${prefix}_V3`;

      // Create prompt with 3 versions, publish the second one
      const prompt = await db.prompt.create({
        data: {
          name,
          value: "initial value",
          description: "Test prompt",
          versions: {
            create: [
              { versionNumber: 1, value: "version 1 text", whodunnit: "user-1", published: false },
              { versionNumber: 2, value: "version 2 text", whodunnit: "user-2", published: true },
              { versionNumber: 3, value: "version 3 text", whodunnit: "user-3", published: false },
            ],
          },
        },
        include: { versions: { orderBy: { versionNumber: "asc" } } },
      });

      // Point publishedVersionId at the published version and set Prompt.value to match
      const publishedVersion = prompt.versions.find((v) => v.published)!;
      const updated = await db.prompt.update({
        where: { id: prompt.id },
        data: {
          publishedVersionId: publishedVersion.id,
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
      // LIVE = PUBLISHED: Prompt.value mirrors the published version's text
      expect(updated.value).toBe("version 2 text");
      expect(updated.publishedVersion?.value).toBe("version 2 text");
      expect(updated.publishedVersion?.published).toBe(true);

      // The other versions are not published
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
