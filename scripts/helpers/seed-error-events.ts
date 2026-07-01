import { PrismaClient, ErrorIssueStatus } from "@prisma/client";
import { put } from "@vercel/blob";
import * as crypto from "crypto";

const prisma = new PrismaClient();

// Guard: blob storage must be configured
const isBlobConfigured = !!process.env.BLOB_READ_WRITE_TOKEN;

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const ENVIRONMENTS = ["production", "staging"] as const;
const RELEASES = ["v1.0.0", "v1.1.0", "v1.2.0", "v2.0.0-beta"] as const;
const STATUSES: ErrorIssueStatus[] = [
  "UNRESOLVED",
  "UNRESOLVED",
  "UNRESOLVED", // Weight toward unresolved (more realistic)
  "RESOLVED",
  "IGNORED",
];

interface SampleError {
  exceptionType: string;
  message: string;
  stackTrace: string;
}

const SAMPLE_ERRORS: SampleError[] = [
  {
    exceptionType: "TypeError",
    message: "Cannot read properties of undefined (reading 'id')",
    stackTrace: [
      "TypeError: Cannot read properties of undefined (reading 'id')",
      "    at resolveUser (/app/src/lib/auth.ts:42:20)",
      "    at async POST (/app/src/app/api/users/route.ts:18:14)",
      "    at async nextHandler (/app/node_modules/next/dist/server/next-server.js:1:1)",
      "    at async DevServer.runApi (/app/node_modules/next/dist/server/dev/next-dev-server.js:1:1)",
    ].join("\n"),
  },
  {
    exceptionType: "ReferenceError",
    message: "fetch is not defined",
    stackTrace: [
      "ReferenceError: fetch is not defined",
      "    at fetchExternalData (/app/src/services/external.ts:15:10)",
      "    at async getPageProps (/app/src/app/page.tsx:30:5)",
      "    at async generateStaticParams (/app/node_modules/next/dist/build/utils.js:1:1)",
    ].join("\n"),
  },
  {
    exceptionType: "PrismaClientKnownRequestError",
    message: "Unique constraint failed on the fields: (`email`)",
    stackTrace: [
      "PrismaClientKnownRequestError: Unique constraint failed on the fields: (`email`)",
      "    at RequestHandler.handleRequestError (/app/node_modules/@prisma/client/runtime/library.js:1:1)",
      "    at RequestHandler.request (/app/node_modules/@prisma/client/runtime/library.js:1:1)",
      "    at async PrismaClient._request (/app/node_modules/@prisma/client/runtime/library.js:1:1)",
      "    at async createUser (/app/src/lib/db/users.ts:78:14)",
      "    at async POST (/app/src/app/api/auth/register/route.ts:22:18)",
    ].join("\n"),
  },
  {
    exceptionType: "SyntaxError",
    message: "Unexpected token '<', \"<!DOCTYPE...\" is not valid JSON",
    stackTrace: [
      "SyntaxError: Unexpected token '<', \"<!DOCTYPE...\" is not valid JSON",
      "    at JSON.parse (<anonymous>)",
      "    at parseResponse (/app/src/lib/http-client.ts:88:22)",
      "    at async fetchWithRetry (/app/src/lib/http-client.ts:55:14)",
      "    at async GET (/app/src/app/api/external/route.ts:12:18)",
    ].join("\n"),
  },
  {
    exceptionType: "Error",
    message: "ECONNREFUSED: Connection refused to 127.0.0.1:5432",
    stackTrace: [
      "Error: ECONNREFUSED: Connection refused to 127.0.0.1:5432",
      "    at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1278:16)",
      "    at PrismaClient.connect (/app/node_modules/@prisma/client/runtime/library.js:1:1)",
      "    at async dbConnect (/app/src/lib/db.ts:20:5)",
    ].join("\n"),
  },
  {
    exceptionType: "RangeError",
    message: "Maximum call stack size exceeded",
    stackTrace: [
      "RangeError: Maximum call stack size exceeded",
      "    at processNode (/app/src/lib/graph-walker/registry.ts:140:12)",
      "    at processNode (/app/src/lib/graph-walker/registry.ts:155:14)",
      "    at processNode (/app/src/lib/graph-walker/registry.ts:155:14)",
      "    at processNode (/app/src/lib/graph-walker/registry.ts:155:14)",
      "    at processNode (/app/src/lib/graph-walker/registry.ts:155:14)",
    ].join("\n"),
  },
  {
    exceptionType: "AuthError",
    message: "JWT signature verification failed",
    stackTrace: [
      "AuthError: JWT signature verification failed",
      "    at verifyToken (/app/src/lib/auth/jwt.ts:34:9)",
      "    at middleware (/app/src/middleware.ts:22:16)",
      "    at Object.<anonymous> (/app/node_modules/next/dist/server/web/adapter.js:1:1)",
    ].join("\n"),
  },
  {
    exceptionType: "NetworkError",
    message: "Failed to fetch: net::ERR_NAME_NOT_RESOLVED",
    stackTrace: [
      "NetworkError: Failed to fetch: net::ERR_NAME_NOT_RESOLVED",
      "    at callStakworkApi (/app/src/services/stakwork.ts:90:12)",
      "    at async createProject (/app/src/services/stakwork.ts:45:18)",
      "    at async POST (/app/src/app/api/swarm/route.ts:60:14)",
    ].join("\n"),
  },
  {
    exceptionType: "TypeError",
    message: "undefined is not a function",
    stackTrace: [
      "TypeError: undefined is not a function",
      "    at handleFeatureUpdate (/app/src/hooks/useFeature.ts:88:12)",
      "    at updateFeature (/app/src/stores/featureStore.ts:45:5)",
      "    at Object.onClick (/app/src/components/FeatureCard/index.tsx:120:18)",
    ].join("\n"),
  },
  {
    exceptionType: "ValidationError",
    message: "Required field 'exceptionType' is missing",
    stackTrace: [
      "ValidationError: Required field 'exceptionType' is missing",
      "    at validatePayload (/app/src/app/api/webhook/errors/route.ts:70:11)",
      "    at async POST (/app/src/app/api/webhook/errors/route.ts:55:5)",
    ].join("\n"),
  },
];

// ---------------------------------------------------------------------------
// Fingerprint helper (mirrors the util in src/lib/utils/error-fingerprint.ts)
// ---------------------------------------------------------------------------
function computeFingerprint(exceptionType: string, stackTrace: string): string {
  const TOP_FRAMES = 5;
  const frames = stackTrace
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("at ") || l.length > 0)
    .slice(0, TOP_FRAMES)
    .map((raw) => {
      let frame = raw.trim().replace(/^at\s+/, "");
      frame = frame.replace(/\(([^)]+)\)/g, (_m, inner) => {
        const base = inner.replace(/:\d+:\d+$/, "").split("/").pop() ?? inner;
        return `(${base})`;
      });
      frame = frame.replace(/\S*[/\\]\S*/g, (t) => t.split(/[/\\]/).pop() ?? t);
      frame = frame.replace(/:\d+(?::\d+)?/g, "");
      return frame.replace(/\s+/g, " ").trim();
    })
    .filter(Boolean)
    .join("|");

  return crypto
    .createHash("sha256")
    .update(`${exceptionType}::${frames}`)
    .digest("hex");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------
export async function seedErrorEvents() {
  console.log("\n🐛 Starting error events seed...");

  if (!isBlobConfigured) {
    console.log(
      "⚠️  Blob storage not configured (BLOB_READ_WRITE_TOKEN missing) — skipping error events seed"
    );
    return;
  }

  const workspace = await prisma.workspace.findFirst({
    where: { deleted: false },
    select: { id: true, name: true },
  });

  if (!workspace) {
    console.log("ℹ️  No workspace found — skipping error events seed");
    return;
  }

  // Idempotency guard
  const existingCount = await prisma.errorIssue.count({
    where: { workspaceId: workspace.id },
  });
  if (existingCount > 0) {
    console.log(`✓ Already have ${existingCount} error issues for "${workspace.name}" — skipping seed`);
    return;
  }

  console.log(`✓ Found workspace: ${workspace.name}`);

  let issuesCreated = 0;
  let eventsCreated = 0;

  for (let i = 0; i < SAMPLE_ERRORS.length; i++) {
    const sample = SAMPLE_ERRORS[i];
    const fingerprint = computeFingerprint(sample.exceptionType, sample.stackTrace);
    const status = pick(STATUSES);
    const occurrences = randomBetween(1, 200);
    const firstSeenDaysAgo = randomBetween(10, 30);
    const lastSeenDaysAgo = randomBetween(0, firstSeenDaysAgo - 1);
    const firstSeenAt = daysAgo(firstSeenDaysAgo);
    const lastSeenAt = daysAgo(lastSeenDaysAgo);
    const environment = pick(ENVIRONMENTS);
    const release = pick(RELEASES);

    // Create ErrorIssue
    const issue = await prisma.errorIssue.create({
      data: {
        workspaceId: workspace.id,
        fingerprint,
        exceptionType: sample.exceptionType,
        title: sample.message.slice(0, 500),
        status,
        occurrenceCount: occurrences,
        firstSeenAt,
        lastSeenAt,
        environment,
        release,
      },
    });
    issuesCreated++;

    // Seed 1–4 representative ErrorEvent rows per issue with real blob uploads
    const eventCount = randomBetween(1, Math.min(4, occurrences));
    for (let j = 0; j < eventCount; j++) {
      const eventId = crypto.randomUUID();
      const eventEnv = pick(ENVIRONMENTS);
      const eventRelease = pick(RELEASES);
      const eventPayload = {
        exceptionType: sample.exceptionType,
        message: sample.message,
        stackTrace: sample.stackTrace,
        environment: eventEnv,
        release: eventRelease,
        requestContext: {
          method: pick(["GET", "POST", "PUT", "DELETE"] as const),
          url: `/api/example/endpoint-${i}`,
          userAgent: "Mozilla/5.0 (compatible; SeedBot/1.0)",
        },
        metadata: { seedIndex: i, eventIndex: j },
      };

      try {
        const blobPath = `errors/${workspace.id}/${fingerprint}/${eventId}.json`;
        const blob = await put(blobPath, JSON.stringify(eventPayload, null, 2), {
          access: "private",
          addRandomSuffix: false,
          allowOverwrite: true,
        });

        await prisma.errorEvent.create({
          data: {
            id: eventId,
            issueId: issue.id,
            workspaceId: workspace.id,
            blobUrl: blob.url,
            exceptionType: sample.exceptionType,
            message: sample.message,
            fingerprint,
            environment: eventEnv,
            release: eventRelease,
            requestContext: eventPayload.requestContext,
            metadata: eventPayload.metadata,
            createdAt: new Date(
              firstSeenAt.getTime() +
                (j / eventCount) * (lastSeenAt.getTime() - firstSeenAt.getTime())
            ),
          },
        });
        eventsCreated++;
      } catch (err) {
        console.error(`   ⚠️  Failed to create event ${j + 1} for issue ${i + 1}:`, err);
      }
    }
  }

  console.log(
    `✓ Error events seed complete:\n` +
      `  - ${issuesCreated} ErrorIssue records\n` +
      `  - ${eventsCreated} ErrorEvent records\n` +
      `  - Workspace: ${workspace.name}`
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
