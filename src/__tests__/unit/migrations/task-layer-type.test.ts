import { execSync } from "child_process";
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Task Layer Type Migration", () => {
  const migrationName = "20260123140302_add_task_layer_type";
  const migrationPath = path.join("prisma", "migrations", migrationName, "migration.sql");

  it("should have migration file with correct SQL", () => {
    // Check that the migration file exists
    expect(fs.existsSync(migrationPath)).toBe(true);

    const migrationFile = fs.readFileSync(migrationPath, "utf-8");

    // Verify enum creation
    expect(migrationFile).toContain('CREATE TYPE "TaskLayerType"');
    expect(migrationFile).toContain("DATABASE_SCHEMA");
    expect(migrationFile).toContain("BACKEND_API");
    expect(migrationFile).toContain("FRONTEND_COMPONENT");
    expect(migrationFile).toContain("INTEGRATION_TEST");
    expect(migrationFile).toContain("UNIT_TEST");
    expect(migrationFile).toContain("E2E_TEST");
    expect(migrationFile).toContain("CONFIG_INFRA");
    expect(migrationFile).toContain("DOCUMENTATION");

    // Verify column additions
    expect(migrationFile).toContain('ALTER TABLE "tasks"');
    expect(migrationFile).toContain('"layer_type"');
    expect(migrationFile).toContain('"manual_layer_override"');

    // Verify index creation
    expect(migrationFile).toContain("CREATE INDEX");
    expect(migrationFile).toContain("tasks_layer_type_idx");
  });

  it("should have all 8 layer type enum values", () => {
    const migrationFile = fs.readFileSync(migrationPath, "utf-8");
    
    const expectedEnumValues = [
      "DATABASE_SCHEMA",
      "BACKEND_API",
      "FRONTEND_COMPONENT",
      "INTEGRATION_TEST",
      "UNIT_TEST",
      "E2E_TEST",
      "CONFIG_INFRA",
      "DOCUMENTATION",
    ];

    for (const enumValue of expectedEnumValues) {
      expect(migrationFile).toContain(enumValue);
    }
  });

  it("migration should be applied in database", () => {
    // Check migration status
    const migrateStatus = execSync("npx prisma migrate status", { 
      encoding: "utf-8" 
    });

    // Should show database is up to date
    expect(migrateStatus).toContain("Database schema is up to date");
  });
});
