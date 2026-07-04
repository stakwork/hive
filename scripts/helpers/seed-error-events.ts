import { PrismaClient, ErrorIssueStatus } from "@prisma/client";
import { put } from "@vercel/blob";

const prisma = new PrismaClient();

// Guard: require blob storage to be configured
const isBlobConfigured = !!process.env.BLOB_READ_WRITE_TOKEN;

const EXCEPTION_TYPES = [
  "TypeError",
  "ReferenceError",
  "NetworkError",
  "DatabaseError",
  "ValidationError",
  "TimeoutError",
  "AuthenticationError",
];

const MESSAGES = [
  "Cannot read properties of undefined (reading 'map')",
  "fetch failed: ECONNREFUSED",
  "Unique constraint violation on field 'email'",
  "JWT token expired",
  "Request timeout after 30000ms",
  "Cannot read properties of null (reading 'id')",
  "Database connection pool exhausted",
  "Invalid input: expected string, got number",
  "CORS policy blocked the request",
  "Unexpected end of JSON input",
];

const STACK_TRACES = [
  `TypeError: Cannot read properties of undefined (reading 'map')
    at ProductList (/app/components/ProductList.tsx:42:18)
    at renderWithHooks (/app/node_modules/react-dom/cjs/react-dom.development.js:14985:18)
    at mountIndeterminateComponent (/app/node_modules/react-dom/cjs/react-dom.development.js:17811:13)
    at beginWork (/app/node_modules/react-dom/cjs/react-dom.development.js:19049:16)
    at performUnitOfWork (/app/node_modules/react-dom/cjs/react-dom.development.js:22905:12)`,
  `NetworkError: fetch failed: ECONNREFUSED
    at Object.fetch (/app/lib/api-client.ts:28:11)
    at async getUser (/app/services/user.ts:15:18)
    at async GET (/app/app/api/users/route.ts:12:22)
    at async RouteHandlerManager.handle (/app/node_modules/next/dist/server/future/route-handler-managers/route-handler-manager.js:24:9)`,
  `DatabaseError: Unique constraint violation on field 'email'
    at PrismaClient.handleError (/app/node_modules/@prisma/client/runtime/library.js:107:22)
    at async createUser (/app/services/user-service.ts:55:5)
    at async POST (/app/app/api/auth/register/route.ts:33:18)`,
  `AuthenticationError: JWT token expired
    at verifyToken (/app/lib/auth/jwt.ts:44:11)
    at middleware (/app/middleware.ts:19:20)
    at Object.run (/app/node_modules/next/dist/server/web/sandbox/sandbox.js:401:16)`,
];

const ENVIRONMENTS = ["production", "staging"];
const RELEASES = ["v1.2.0", "v1.2.1", "v1.3.0", "v1.3.1", "v1.4.0"];

// Realistic fake commit SHAs (40-char hex). null entries exercise the default-branch fallback path.
const COMMIT_SHAS: (string | null)[] = [
  "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  "deadbeefcafe1234567890abcdef1234567890ab",
  "f0e1d2c3b4a5f0e1d2c3b4a5f0e1d2c3b4a5f0e1",
  null, // exercises default-branch fallback
  "1a2b3c4d5e6f1a2b3c4d5e6f1a2b3c4d5e6f1a2b",
  "cafebabe1234cafebabe1234cafebabe1234cafe",
  null, // exercises default-branch fallback
  "0987654321fedcba0987654321fedcba09876543",
  "abcdef1234567890abcdef1234567890abcdef12",
  "9f8e7d6c5b4a9f8e7d6c5b4a9f8e7d6c5b4a9f8e",
];

const STATUSES: ErrorIssueStatus[] = [
  ErrorIssueStatus.UNRESOLVED,
  ErrorIssueStatus.UNRESOLVED,
  ErrorIssueStatus.UNRESOLVED, // weighted toward UNRESOLVED
  ErrorIssueStatus.RESOLVED,
  ErrorIssueStatus.IGNORED,
];

// ── Seed impact score data ────────────────────────────────────────────────────
// Provides three distinct states so the dashboard can render all scenarios
// without a live Jarvis connection.
//   i % 3 === 0  → high impact (central code path)
//   i % 3 === 1  → low impact (peripheral code)
//   i % 3 === 2  → null / unscored (no KG edges resolved)

interface SeedImpactData {
  impactScore?: number | undefined;
  impactScoredAt?: Date | undefined;
  impactMeta?: Prisma.InputJsonValue | undefined;
}

function buildSeedImpactData(issueIndex: number): SeedImpactData {
  const scoredAt = new Date(Date.now() - issueIndex * 1800 * 1000);

  switch (issueIndex % 3) {
    case 0:
      // High impact — touches a heavily-depended-upon file/function
      return {
        impactScore: 0.82,
        impactScoredAt: scoredAt,
        impactMeta: {
          topNodeName: "src/services/user.ts",
          topNodeType: "File",
          topPagerank: 0.91,
          topInDegree: 47,
          nodeCount: 3,
        },
      };
    case 1:
      // Low impact — peripheral code with few dependents
      return {
        impactScore: 0.12,
        impactScoredAt: scoredAt,
        impactMeta: {
          topNodeName: "src/utils/format.ts",
          topNodeType: "File",
          topPagerank: 0.08,
          topInDegree: 2,
          nodeCount: 1,
        },
      };
    default:
      // Unscored — no resolvable KG edges (omit fields so Prisma uses DB default of null)
      return {};
  }
}

// ── Seed correlation data ─────────────────────────────────────────────────────
// Provides varied correlation states across seeded issues so the dashboard UI
// can render all three scenarios without a live Jarvis connection.
//
// Full KG-sourced correlation requires a live Jarvis connection and is
// exercised via mocked kgGetNeighbors in unit/integration tests (not this seed).

import { Prisma } from "@prisma/client";

interface SeedCorrelationData {
  correlatedPrNumber?: number;
  correlatedPrUrl?: string;
  correlatedCommitSha?: string;
  correlationConfidence?: string;
  correlationComputedAt?: Date;
  correlationCandidates?: Prisma.InputJsonValue;
}

/**
 * Returns correlation fields for a seeded ErrorIssue based on its index.
 *   i % 3 === 0  → high-confidence single PR match
 *   i % 3 === 1  → "likely" multi-candidate (2 PRs)
 *   i % 3 === 2  → no correlation (omitted)
 */
function buildSeedCorrelationData(issueIndex: number, repoUrl: string): SeedCorrelationData {
  const baseUrl = repoUrl.replace(/\.git$/, "");
  const computedAt = new Date(Date.now() - issueIndex * 3600 * 1000);

  switch (issueIndex % 3) {
    case 0:
      // High-confidence single PR
      return {
        correlatedPrNumber: 100 + issueIndex,
        correlatedPrUrl: `${baseUrl}/pull/${100 + issueIndex}`,
        correlatedCommitSha: COMMIT_SHAS[issueIndex % COMMIT_SHAS.length] ?? undefined,
        correlationConfidence: "high",
        correlationComputedAt: computedAt,
        correlationCandidates: undefined,
      };
    case 1:
      // "Likely" multi-candidate
      return {
        correlatedPrNumber: 200 + issueIndex,
        correlatedPrUrl: `${baseUrl}/pull/${200 + issueIndex}`,
        correlatedCommitSha: undefined,
        correlationConfidence: "likely",
        correlationComputedAt: computedAt,
        correlationCandidates: [
          {
            prNumber: 200 + issueIndex,
            prUrl: `${baseUrl}/pull/${200 + issueIndex}`,
            mergeDate: new Date(computedAt.getTime() - 3600 * 1000).toISOString(),
            refId: `kg-pr-${200 + issueIndex}`,
          },
          {
            prNumber: 201 + issueIndex,
            prUrl: `${baseUrl}/pull/${201 + issueIndex}`,
            mergeDate: new Date(computedAt.getTime() - 6 * 3600 * 1000).toISOString(),
            refId: `kg-pr-${201 + issueIndex}`,
          },
        ],
      };
    default:
      // No correlation
      return {};
  }
}

/**
 * Seeds realistic ErrorIssue + ErrorEvent data for local UI development.
 * Mirrors seed-agent-logs.ts conventions.
 */
export async function seedErrorEvents() {
  console.log("\n🐛 Starting error events seed...");

  if (!isBlobConfigured) {
    console.log(
      "⚠️  Blob storage not configured (BLOB_READ_WRITE_TOKEN missing) - skipping error events seed"
    );
    console.log("   To enable: Set BLOB_READ_WRITE_TOKEN environment variable");
    return;
  }

  // Find a workspace that has at least one Repository
  const workspace = await prisma.workspace.findFirst({
    where: { deleted: false },
    include: {
      repositories: { take: 5 },
    },
    orderBy: { createdAt: "desc" },
  });

  if (!workspace) {
    console.log("ℹ️  No workspace found - skipping error events seed");
    return;
  }

  if (workspace.repositories.length === 0) {
    console.log(
      `ℹ️  Workspace "${workspace.name}" has no repositories - skipping error events seed`
    );
    return;
  }

  // Skip if we already have issues for this workspace
  const existingCount = await prisma.errorIssue.count({
    where: { workspaceId: workspace.id },
  });
  if (existingCount > 0) {
    console.log(
      `✓ Already have ${existingCount} error issues for "${workspace.name}" - skipping seed`
    );
    return;
  }

  console.log(
    `✓ Found workspace: ${workspace.name} (${workspace.repositories.length} repos)`
  );

  const repos = workspace.repositories.slice(0, 3); // Use up to 3 repos
  const now = new Date();

  // impactScore values: varied so UI + manual QA can exercise high/low/null states.
  // null = unscored (no Jarvis connection), 0.85 = high/central, 0.12 = low/peripheral.
  const IMPACT_SCORES: (number | null)[] = [
    0.85,  // high impact — touches heavily-depended-upon code path
    null,  // unscored — no KG projection (exercises graceful degradation)
    0.12,  // low impact — peripheral file
    0.91,  // very high — central API route
    null,  // unscored
    0.44,  // moderate
    0.07,  // very low / peripheral
    0.72,  // high
    null,  // unscored
    0.33,  // moderate-low
  ];

  const IMPACT_METAS: (object | null)[] = [
    { topNodeName: "api-client.ts", topNodeType: "File", topPagerank: 0.82, topInDegree: 145, nodeCount: 3 },
    null,
    { topNodeName: "utils.ts", topNodeType: "File", topPagerank: 0.10, topInDegree: 8, nodeCount: 1 },
    { topNodeName: "GET /api/users/route.ts", topNodeType: "Function", topPagerank: 0.89, topInDegree: 210, nodeCount: 5 },
    null,
    { topNodeName: "ProductList.tsx", topNodeType: "File", topPagerank: 0.38, topInDegree: 42, nodeCount: 2 },
    { topNodeName: "seed-helper.ts", topNodeType: "File", topPagerank: 0.05, topInDegree: 2, nodeCount: 1 },
    { topNodeName: "user-service.ts", topNodeType: "File", topPagerank: 0.68, topInDegree: 98, nodeCount: 4 },
    null,
    { topNodeName: "auth/jwt.ts", topNodeType: "File", topPagerank: 0.29, topInDegree: 31, nodeCount: 2 },
  ];

  // We'll create 10 issues spread across repos with varied attributes
  const issueConfigs = [
    { repoIdx: 0, statusIdx: 0, occurrenceCount: 142, daysAgoFirst: 30, daysAgoLast: 1, envIdx: 0, releaseIdx: 4 },
    { repoIdx: 0, statusIdx: 1, occurrenceCount: 27, daysAgoFirst: 28, daysAgoLast: 14, envIdx: 0, releaseIdx: 3 },
    { repoIdx: 0, statusIdx: 0, occurrenceCount: 5, daysAgoFirst: 7, daysAgoLast: 1, envIdx: 1, releaseIdx: 4 },
    { repoIdx: 1, statusIdx: 0, occurrenceCount: 200, daysAgoFirst: 30, daysAgoLast: 0, envIdx: 0, releaseIdx: 4 },
    { repoIdx: 1, statusIdx: 3, occurrenceCount: 88, daysAgoFirst: 25, daysAgoLast: 20, envIdx: 0, releaseIdx: 2 },
    { repoIdx: 1, statusIdx: 0, occurrenceCount: 1, daysAgoFirst: 2, daysAgoLast: 2, envIdx: 1, releaseIdx: 4 },
    { repoIdx: 1, statusIdx: 4, occurrenceCount: 12, daysAgoFirst: 20, daysAgoLast: 18, envIdx: 0, releaseIdx: 1 },
    { repoIdx: 2 % repos.length, statusIdx: 0, occurrenceCount: 55, daysAgoFirst: 15, daysAgoLast: 1, envIdx: 0, releaseIdx: 4 },
    { repoIdx: 2 % repos.length, statusIdx: 2, occurrenceCount: 3, daysAgoFirst: 10, daysAgoLast: 9, envIdx: 1, releaseIdx: 3 },
    { repoIdx: 0, statusIdx: 0, occurrenceCount: 19, daysAgoFirst: 5, daysAgoLast: 0, envIdx: 0, releaseIdx: 4 },
  ];

  let issueCount = 0;
  let eventCount = 0;

  for (let i = 0; i < issueConfigs.length; i++) {
    const cfg = issueConfigs[i];
    const repo = repos[cfg.repoIdx];
    const exceptionType = EXCEPTION_TYPES[i % EXCEPTION_TYPES.length];
    const message = MESSAGES[i % MESSAGES.length];
    const stackTrace = STACK_TRACES[i % STACK_TRACES.length];
    const environment = ENVIRONMENTS[cfg.envIdx];
    const release = RELEASES[cfg.releaseIdx];
    const status = STATUSES[cfg.statusIdx];
    const commitSha = COMMIT_SHAS[i % COMMIT_SHAS.length];

    // Generate a stable fingerprint for the seed
    const fingerprint = `seed-fp-${i}-${repo.id.slice(0, 8)}`;
    const repoKey = repo.id;
    const firstSeenAt = new Date(now.getTime() - cfg.daysAgoFirst * 24 * 60 * 60 * 1000);
    const lastSeenAt = new Date(now.getTime() - cfg.daysAgoLast * 24 * 60 * 60 * 1000);

    try {
      // Upload a sample blob for the latest event
      const blobKey = `errors/${workspace.id}/${repoKey}/${fingerprint}/seed-${Date.now()}-${i}.json`;
      const blobPayload = {
        exceptionType,
        message,
        stackTrace,
        environment,
        release,
        repository: repo.repositoryUrl,
        metadata: { seedRun: true, issueIndex: i },
      };

      const blob = await put(blobKey, JSON.stringify(blobPayload, null, 2), {
        access: "private",
        addRandomSuffix: true,
      });

      const impactScore = IMPACT_SCORES[i] ?? null;
      const impactMeta = IMPACT_METAS[i] ?? null;
      const correlationData = buildSeedCorrelationData(i, repo.repositoryUrl);
      const impactData = buildSeedImpactData(i);

      // Create the ErrorIssue
      const issue = await prisma.errorIssue.create({
        data: {
          workspaceId: workspace.id,
          repositoryId: repo.id,
          repoKey,
          fingerprint,
          exceptionType,
          title: message.slice(0, 255),
          status,
          occurrenceCount: cfg.occurrenceCount,
          firstSeenAt,
          lastSeenAt,
          environment,
          release,
          metadata: { source: "seed" },
          impactScore,
          impactScoredAt: impactScore !== null ? new Date() : null,
          impactMeta: impactMeta ?? undefined,
          ...correlationData,
          ...impactData,
        },
      });
      issueCount++;

      // Create 1-3 sample ErrorEvents for this issue
      const eventsForIssue = Math.min(3, Math.max(1, Math.floor(cfg.occurrenceCount / 50)));
      for (let j = 0; j < eventsForIssue; j++) {
        const eventBlobKey = `errors/${workspace.id}/${repoKey}/${fingerprint}/seed-event-${i}-${j}.json`;
        const eventBlob = await put(eventBlobKey, JSON.stringify(blobPayload, null, 2), {
          access: "private",
          addRandomSuffix: true,
        });

        await prisma.errorEvent.create({
          data: {
            issueId: issue.id,
            workspaceId: workspace.id,
            repositoryId: repo.id,
            repoKey,
            blobUrl: j === 0 ? blob.url : eventBlob.url,
            exceptionType,
            message,
            environment,
            release,
            commitSha: j === 0 ? commitSha : null, // first event pinned to commit; remainder exercise fallback
            fingerprint,
            requestContext: { method: "GET", path: `/api/example/${i}`, userAgent: "Mozilla/5.0" },
            metadata: { seedRun: true, eventIndex: j },
            createdAt: new Date(lastSeenAt.getTime() - j * 3600 * 1000), // stagger by hour
          },
        });
        eventCount++;
      }

      console.log(
        `  ✓ Issue ${i + 1}/${issueConfigs.length}: ${exceptionType} @ ${repo.name} [${status}] (${cfg.occurrenceCount} occurrences)`
      );
    } catch (error) {
      console.error(`  ⚠️  Failed to seed issue ${i + 1}:`, error);
    }
  }

  console.log(
    `✓ Error events seed complete:\n` +
      `  - ${issueCount} ErrorIssues created\n` +
      `  - ${eventCount} ErrorEvents created\n` +
      `  - Spread across ${repos.length} repos: ${repos.map((r) => r.name).join(", ")}\n` +
      `  - Statuses: mix of UNRESOLVED/RESOLVED/IGNORED\n` +
      `  - Environments: production, staging`
  );
}

// Allow running independently
if (require.main === module) {
  seedErrorEvents()
    .catch((err) => {
      console.error("Error events seed failed:", err);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
