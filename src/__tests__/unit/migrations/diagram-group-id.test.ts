import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Diagram groupId migration", () => {
  const migrationName = "20260311212000_add_diagram_group_id";
  // Note: if prisma regenerated with a different timestamp, update this name to match
  const migrationPath = path.join("prisma", "migrations", migrationName, "migration.sql");

  it("should have a migration file", () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  it("should add the group_id column with a default of empty string", () => {
    const sql = fs.readFileSync(migrationPath, "utf-8");
    expect(sql).toContain('ADD COLUMN "group_id" TEXT NOT NULL DEFAULT \'\'');
  });

  it("should backfill group_id = id for all existing rows", () => {
    const sql = fs.readFileSync(migrationPath, "utf-8");
    expect(sql).toContain('UPDATE "diagrams" SET "group_id" = "id" WHERE "group_id" = \'\'');
  });

  it("should drop the default after backfill", () => {
    const sql = fs.readFileSync(migrationPath, "utf-8");
    expect(sql).toContain('ALTER COLUMN "group_id" DROP DEFAULT');
  });

  it("should create an index on group_id", () => {
    const sql = fs.readFileSync(migrationPath, "utf-8");
    expect(sql).toContain("CREATE INDEX");
    expect(sql).toContain("diagrams_group_id_idx");
    expect(sql).toContain('"group_id"');
  });
});
