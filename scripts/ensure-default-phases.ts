#!/usr/bin/env ts-node

/**
 * Migration Script: Ensure All Features Have Phase 1
 *
 * This script finds all features without phases and creates a default
 * "Phase 1" for them to ensure the Tasks UI works correctly.
 *
 * Background:
 * - The new simplified feature UI auto-creates Phase 1 on the frontend
 * - But this only happens when a user visits the Tasks tab
 * - Existing features in production need Phase 1 pre-created
 *
 * Usage:
 *   npm run migrate:default-phases                  (production run)
 *   npm run migrate:default-phases -- --dry-run     (preview only)
 *   npm run migrate:default-phases -- --verbose     (detailed logging)
 */

import { PrismaClient } from "@prisma/client";
import { config as dotenvConfig } from "dotenv";

// Load environment variables
dotenvConfig({ path: ".env.local" });

const prisma = new PrismaClient();

interface MigrationStats {
  featuresChecked: number;
  featuresWithPhases: number;
  featuresWithoutPhases: number;
  phasesCreated: number;
  errors: number;
}

interface MigrationOptions {
  dryRun: boolean;
  verbose: boolean;
}

/**
 * Check if a feature already has phases
 */
async function featureHasPhases(featureId: string): Promise<boolean> {
  const phaseCount = await prisma.phase.count({
    where: {
      featureId,
      deleted: false,
    },
  });
  return phaseCount > 0;
}

/**
 * Create default Phase 1 for a feature
 */
async function createDefaultPhase(
  featureId: string,
  featureTitle: string,
  options: MigrationOptions
): Promise<boolean> {
  if (options.dryRun) {
    console.log(`  [DRY RUN] Would create Phase 1 for feature: ${featureTitle}`);
    return true;
  }

  try {
    await prisma.phase.create({
      data: {
        featureId,
        name: "Phase 1",
        description: null,
        status: "NOT_STARTED",
        order: 0,
      },
    });

    if (options.verbose) {
      console.log(`  ✅ Created Phase 1 for feature: ${featureTitle}`);
    }
    return true;
  } catch (error) {
    console.error(`  ❌ Error creating phase for ${featureTitle}:`, error);
    return false;
  }
}

/**
 * Process all features and ensure they have Phase 1
 */
async function ensureDefaultPhases(options: MigrationOptions): Promise<MigrationStats> {
  const stats: MigrationStats = {
    featuresChecked: 0,
    featuresWithPhases: 0,
    featuresWithoutPhases: 0,
    phasesCreated: 0,
    errors: 0,
  };

  console.log("\n🔍 Finding features without phases...\n");

  // Get all non-deleted features
  const features = await prisma.feature.findMany({
    where: {
      deleted: false,
    },
    select: {
      id: true,
      title: true,
      workspaceId: true,
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  console.log(`Found ${features.length} features to check\n`);

  for (const feature of features) {
    stats.featuresChecked++;

    const hasPhases = await featureHasPhases(feature.id);

    if (hasPhases) {
      stats.featuresWithPhases++;
      if (options.verbose) {
        console.log(`✓ Feature already has phases: ${feature.title}`);
      }
      continue;
    }

    // Feature doesn't have phases - create Phase 1
    stats.featuresWithoutPhases++;
    console.log(`\n📝 Feature without phases: ${feature.title} (${feature.id})`);

    const success = await createDefaultPhase(feature.id, feature.title, options);

    if (success) {
      stats.phasesCreated++;
    } else {
      stats.errors++;
    }
  }

  return stats;
}

/**
 * Main migration function
 */
async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const verbose = args.includes("--verbose");

  const options: MigrationOptions = {
    dryRun,
    verbose,
  };

  console.log("\n" + "=".repeat(60));
  console.log("  MIGRATION: Ensure Default Phases");
  console.log("=".repeat(60));

  if (dryRun) {
    console.log("\n⚠️  DRY RUN MODE - No changes will be made\n");
  }

  if (verbose) {
    console.log("🔊 Verbose logging enabled\n");
  }

  try {
    const stats = await ensureDefaultPhases(options);

    console.log("\n" + "=".repeat(60));
    console.log("  MIGRATION COMPLETE");
    console.log("=".repeat(60));
    console.log(`\n📊 Statistics:`);
    console.log(`  Features checked:         ${stats.featuresChecked}`);
    console.log(`  Features with phases:     ${stats.featuresWithPhases}`);
    console.log(`  Features without phases:  ${stats.featuresWithoutPhases}`);
    console.log(`  Phases created:           ${stats.phasesCreated}`);
    console.log(`  Errors:                   ${stats.errors}`);

    if (dryRun) {
      console.log(`\n⚠️  This was a DRY RUN - no changes were made`);
      console.log(`   Run without --dry-run to apply changes\n`);
    } else {
      console.log(`\n✅ Migration completed successfully!\n`);
    }

    process.exit(stats.errors > 0 ? 1 : 0);
  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

export { ensureDefaultPhases };
