import { describe, it, expect } from "vitest";
import { TaskLayerType } from "@prisma/client";
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

  it("should export TaskLayerType enum from Prisma client", () => {
    // Verify the enum is properly exported and typed
    const allLayerTypes = Object.values(TaskLayerType);
    
    expect(allLayerTypes).toHaveLength(8);
    expect(allLayerTypes).toContain(TaskLayerType.DATABASE_SCHEMA);
    expect(allLayerTypes).toContain(TaskLayerType.BACKEND_API);
    expect(allLayerTypes).toContain(TaskLayerType.FRONTEND_COMPONENT);
    expect(allLayerTypes).toContain(TaskLayerType.INTEGRATION_TEST);
    expect(allLayerTypes).toContain(TaskLayerType.UNIT_TEST);
    expect(allLayerTypes).toContain(TaskLayerType.E2E_TEST);
    expect(allLayerTypes).toContain(TaskLayerType.CONFIG_INFRA);
    expect(allLayerTypes).toContain(TaskLayerType.DOCUMENTATION);
  });
});
