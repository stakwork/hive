import { PrismaClient } from "@prisma/client";
import { put } from "@vercel/blob";
import {
  createSketch,
  insert,
  serialize,
  quantile,
} from "../../src/lib/utils/latency-sketch";
import { deriveDbTimeMs, type Span } from "../../src/lib/utils/trace-signature";
import * as crypto from "crypto";

const prisma = new PrismaClient();

// Guard: require blob storage to be configured
const isBlobConfigured = !!process.env.BLOB_READ_WRITE_TOKEN;

// ── Fixture data ──────────────────────────────────────────────────────────────

const TRANSACTION_CONFIGS = [
  {
    transactionName: "GET /api/users",
    spans: [
      { op: "http.server", name: "Incoming request", durationMs: 5 },
      { op: "db.query", name: "SELECT users", durationMs: 12 },
      { op: "db.query", name: "SELECT permissions", durationMs: 8 },
      { op: "http.client", name: "External auth check", durationMs: 45 },
      { op: "serialize", name: "JSON serialization", durationMs: 2 },
    ] as Span[],
    baseMs: 80,
    jitterMs: 40,
    environment: "production",
    eventCount: 210,
  },
  {
    transactionName: "POST /api/orders",
    spans: [
      { op: "http.server", name: "Incoming request", durationMs: 3 },
      { op: "db.query", name: "BEGIN", durationMs: 1 },
      { op: "db.query", name: "INSERT order", durationMs: 18 },
      { op: "db.query", name: "UPDATE inventory", durationMs: 22 },
      { op: "db.query", name: "COMMIT", durationMs: 4 },
      { op: "http.client", name: "Payment gateway", durationMs: 320 },
      { op: "queue.publish", name: "Order event", durationMs: 15 },
    ] as Span[],
    baseMs: 420,
    jitterMs: 180,
    environment: "production",
    eventCount: 195,
  },
  {
    transactionName: "GET /api/tasks",
    spans: [
      { op: "http.server", name: "Incoming request", durationMs: 4 },
      { op: "db.query", name: "SELECT tasks", durationMs: 35 },
      { op: "db.query", name: "SELECT assignees", durationMs: 14 },
      { op: "cache.get", name: "Redis workspace cache", durationMs: 3 },
      { op: "serialize", name: "JSON serialization", durationMs: 6 },
    ] as Span[],
    baseMs: 70,
    jitterMs: 60,
    environment: "staging",
    eventCount: 220,
  },
  {
    transactionName: "POST /api/features/analyze",
    spans: [
      { op: "http.server", name: "Incoming request", durationMs: 5 },
      { op: "db.query", name: "SELECT feature", durationMs: 9 },
      { op: "http.client", name: "AI analysis call", durationMs: 2800 },
      { op: "db.query", name: "UPDATE feature", durationMs: 11 },
      { op: "http.client", name: "Pusher broadcast", durationMs: 55 },
    ] as Span[],
    baseMs: 3000,
    jitterMs: 1200,
    environment: "production",
    eventCount: 180,
  },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeSeedSignature(transactionName: string, spans: Span[]): string {
  const normalizedOps = spans
    .map((s) => (s.op ?? "unknown").trim().toLowerCase())
    .join(",");
  const input = [transactionName.trim(), normalizedOps].join("\n");
  return crypto.createHash("sha256").update(input).digest("hex");
}

/** Gaussian-ish jitter using Box-Muller approximation for realistic latency samples */
function sampleDuration(baseMs: number, jitterMs: number): number {
  // Box-Muller transform for ~normal distribution
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
  return Math.max(1, baseMs + (jitterMs / 2) * z);
}

// ── Seed function ─────────────────────────────────────────────────────────────

/**
 * Seeds realistic PerformanceTraceGroup + PerformanceTraceEvent data for
 * local UI development. Mirrors seed-error-events.ts conventions.
 */
export async function seedPerformanceTraces() {
  console.log("\n⚡ Starting performance traces seed...");

  if (!isBlobConfigured) {
    console.log(
      "⚠️  Blob storage not configured (BLOB_READ_WRITE_TOKEN missing) - skipping performance traces seed"
    );
    console.log("   To enable: Set BLOB_READ_WRITE_TOKEN environment variable");
    return;
  }

  // Find a workspace with at least one Repository
  const workspace = await prisma.workspace.findFirst({
    where: { deleted: false },
    include: {
      repositories: { take: 2 },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!workspace) {
    console.log("ℹ️  No workspace found - skipping performance traces seed");
    return;
  }

  if (workspace.repositories.length === 0) {
    console.log(
      `ℹ️  Workspace "${workspace.name}" has no repositories - skipping performance traces seed`
    );
    return;
  }

  const repo = workspace.repositories[0];
  const repoKey = repo.id;

  let groupCount = 0;
  let eventCount = 0;
  const now = new Date();

  for (const cfg of TRANSACTION_CONFIGS) {
    const signature = computeSeedSignature(cfg.transactionName, cfg.spans);
    const firstSeenAt = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

    // Build sketch from all samples up front so percentiles are meaningful
    const sketch = createSketch();
    const durations: number[] = [];
    for (let i = 0; i < cfg.eventCount; i++) {
      const d = sampleDuration(cfg.baseMs, cfg.jitterMs);
      durations.push(d);
      insert(sketch, d);
    }

    const p50 = quantile(sketch, 0.5);
    const p95 = quantile(sketch, 0.95);
    const p99 = quantile(sketch, 0.99);
    const elapsedSeconds = (now.getTime() - firstSeenAt.getTime()) / 1000;
    const throughput = cfg.eventCount / elapsedSeconds;
    const avgDbTimeMs = deriveDbTimeMs(cfg.spans);

    // Check if group already exists (idempotent)
    const existing = await prisma.performanceTraceGroup.findUnique({
      where: {
        workspaceId_repoKey_signature: {
          workspaceId: workspace.id,
          repoKey,
          signature,
        },
      },
    });

    if (existing) {
      console.log(`  ↩  Group already exists: ${cfg.transactionName} — skipping`);
      continue;
    }

    try {
      // Upload a representative blob for the group
      const blobKey = `performance/${workspace.id}/${repoKey}/${signature}/seed-${Date.now()}.json`;
      const blobPayload = {
        transactionName: cfg.transactionName,
        totalDurationMs: durations[0],
        spans: cfg.spans,
        environment: cfg.environment,
        repository: repo.repositoryUrl,
        metadata: { seedRun: true },
      };

      const blob = await put(blobKey, JSON.stringify(blobPayload, null, 2), {
        access: "private",
        addRandomSuffix: true,
      });

      // Create the PerformanceTraceGroup
      const group = await prisma.performanceTraceGroup.create({
        data: {
          workspaceId: workspace.id,
          repositoryId: repo.id,
          repoKey,
          transactionName: cfg.transactionName,
          signature,
          sampleCount: cfg.eventCount,
          p50Ms: p50,
          p95Ms: p95,
          p99Ms: p99,
          throughput,
          dbTimeMs: avgDbTimeMs,
          sketchState: serialize(sketch),
          firstSeenAt,
          lastSeenAt: now,
        },
      });
      groupCount++;

      // Create sample PerformanceTraceEvents (up to 5 per group to keep seed fast)
      const eventSamples = Math.min(5, cfg.eventCount);
      const eventInterval = Math.floor((30 * 24 * 60 * 60 * 1000) / eventSamples);

      for (let j = 0; j < eventSamples; j++) {
        const eventDuration = durations[j * Math.floor(cfg.eventCount / eventSamples)] ?? cfg.baseMs;
        const eventBlobKey = `performance/${workspace.id}/${repoKey}/${signature}/seed-event-${j}-${Date.now()}.json`;
        const eventBlobPayload = { ...blobPayload, totalDurationMs: eventDuration };
        const eventBlob = await put(eventBlobKey, JSON.stringify(eventBlobPayload, null, 2), {
          access: "private",
          addRandomSuffix: true,
        });

        await prisma.performanceTraceEvent.create({
          data: {
            groupId: group.id,
            workspaceId: workspace.id,
            repositoryId: repo.id,
            repoKey,
            blobUrl: j === 0 ? blob.url : eventBlob.url,
            transactionName: cfg.transactionName,
            totalDurationMs: eventDuration,
            spans: cfg.spans as object[],
            createdAt: new Date(firstSeenAt.getTime() + j * eventInterval),
          },
        });
        eventCount++;
      }

      console.log(
        `  ✓ Group: ${cfg.transactionName} @ ${repo.name} [p50=${p50.toFixed(0)}ms p95=${p95.toFixed(0)}ms p99=${p99.toFixed(0)}ms] (${cfg.eventCount} samples, ${eventSamples} events)`
      );
    } catch (error) {
      console.error(`  ⚠️  Failed to seed group "${cfg.transactionName}":`, error);
    }
  }

  console.log(
    `✓ Performance traces seed complete:\n` +
      `  - ${groupCount} PerformanceTraceGroups created\n` +
      `  - ${eventCount} PerformanceTraceEvents created\n` +
      `  - Repo: ${repo.name}\n` +
      `  - Environments: production, staging`
  );
}

// Allow running independently
if (require.main === module) {
  seedPerformanceTraces()
    .catch((err) => {
      console.error("Performance traces seed failed:", err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
