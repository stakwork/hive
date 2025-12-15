/**
 * Schema Version - Tracks database schema version to prevent seeder drift
 *
 * When the database schema changes (migrations), old scenario data may not
 * be compatible. This module provides utilities to:
 * 1. Get the current schema version (latest migration)
 * 2. Validate that scenarios match the current schema
 */
import { db } from "@/lib/db";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

/**
 * Get the current schema version from the database
 *
 * Uses the latest applied migration name as the version identifier.
 * This is more reliable than hashing the schema file since it tracks
 * what's actually applied to the database.
 *
 * @returns The latest migration name or a schema file hash as fallback
 */
export async function getSchemaVersion(): Promise<string> {
  try {
    // Query the _prisma_migrations table for the latest migration
    const result = await db.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name
      FROM _prisma_migrations
      WHERE finished_at IS NOT NULL
      ORDER BY finished_at DESC
      LIMIT 1
    `;

    if (result.length > 0) {
      return result[0].migration_name;
    }

    // Fallback: hash the schema file
    return getSchemaFileHash();
  } catch {
    // If _prisma_migrations doesn't exist (fresh db), use schema hash
    return getSchemaFileHash();
  }
}

/**
 * Fallback: Generate hash from schema.prisma file
 *
 * Used when the migrations table isn't available (e.g., fresh database).
 * Hashes just the model definitions, ignoring comments and whitespace.
 */
function getSchemaFileHash(): string {
  try {
    const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
    const schemaContent = fs.readFileSync(schemaPath, "utf-8");

    // Hash just the model definitions (ignoring comments and whitespace variations)
    const normalizedSchema = schemaContent
      .split("\n")
      .filter(line => !line.trim().startsWith("//"))
      .join("\n")
      .replace(/\s+/g, " ");

    return "schema-" + crypto
      .createHash("sha256")
      .update(normalizedSchema)
      .digest("hex")
      .substring(0, 16);
  } catch {
    return "unknown";
  }
}

/**
 * Validates that the current schema matches the expected version
 *
 * @param expectedVersion - The schema version the scenario was created for
 * @throws Error if there's a mismatch
 */
export async function validateSchemaVersion(expectedVersion: string): Promise<void> {
  const currentVersion = await getSchemaVersion();

  if (currentVersion !== expectedVersion) {
    throw new Error(
      `Schema version mismatch. Expected: ${expectedVersion}, Current: ${currentVersion}. ` +
      `Please update the scenario to match the current schema or run migrations.`
    );
  }
}

/**
 * Check if schema versions match (non-throwing version)
 *
 * @param expectedVersion - The schema version to check against
 * @returns true if versions match, false otherwise
 */
export async function schemaVersionMatches(expectedVersion: string): Promise<boolean> {
  try {
    const currentVersion = await getSchemaVersion();
    return currentVersion === expectedVersion;
  } catch {
    return false;
  }
}
