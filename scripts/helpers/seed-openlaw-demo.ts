/**
 * seed-openlaw-demo.ts
 *
 * Makes the legal-benchmark surfaces demoable in local dev with USE_MOCKS=true.
 * Every legal-benchmark route hard-gates on the `openlaw` workspace slug, but
 * nothing creates that workspace locally — so the recursion rail, run reports
 * and the fix-snapshot reader are unreachable without this.
 *
 * Creates (idempotently):
 *   1. A `demo` user matching the mock auth provider's shape, so signing in
 *      with username "demo" (POD_URL mock login) reuses it.
 *   2. The `openlaw` workspace owned by that user.
 *   3. An ACTIVE mock swarm on it — getWorkspaceSwarmAccess requires one, and
 *      with USE_MOCKS the Jarvis URL resolves to the local mock endpoints.
 *   4. Two LEGAL_BENCHMARK_RUNNER runs mirroring seed-database's report seeds:
 *      one with a working mock report bundle (projectId 57419, so the fix
 *      snapshot section's "this run" attribution fires against the mock
 *      fixes), one with a guard-rejected URL.
 *
 * Run: npx tsx scripts/helpers/seed-openlaw-demo.ts
 * Never runs against production (NODE_ENV guard).
 */

import { config as dotenvConfig } from "dotenv";
dotenvConfig({ path: ".env" });
dotenvConfig({ path: ".env.local", override: true });

import { PrismaClient, StakworkRunType, WorkflowStatus, SwarmStatus } from "@prisma/client";
import { EncryptionService } from "../../src/lib/encryption";

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.log("✗ Refusing to run against production");
    process.exit(1);
  }

  // 1. Demo user — same shape the mock credentials provider creates on
  // sign-in, so "demo" logins map onto this row.
  const user = await prisma.user.upsert({
    where: { email: "demo@mock.dev" },
    update: {},
    create: {
      name: "demo",
      email: "demo@mock.dev",
      emailVerified: new Date(),
    },
  });
  console.log(`✓ Demo user (${user.id})`);

  // 2. openlaw workspace owned by the demo user.
  const workspace = await prisma.workspace.upsert({
    where: { slug: "openlaw" },
    update: { deleted: false, deletedAt: null },
    create: {
      name: "OpenLaw",
      description: "Legal benchmarks demo workspace (mock)",
      slug: "openlaw",
      ownerId: user.id,
    },
  });
  console.log(`✓ openlaw workspace (${workspace.id}) owner=${workspace.ownerId}`);

  // 3. ACTIVE mock swarm — required by getWorkspaceSwarmAccess. The API key
  // is a mock value; with USE_MOCKS the Jarvis URL points at the local mock
  // endpoints, which don't check it. Encryption mirrors mockSetup.ts.
  let encryptedSwarmApiKey = "";
  try {
    encryptedSwarmApiKey = JSON.stringify(
      EncryptionService.getInstance().encryptField("swarmApiKey", "mock-swarm-api-key"),
    );
  } catch {
    console.log("⚠ TOKEN_ENCRYPTION_KEY not set — storing empty swarm key");
  }
  await prisma.swarm.upsert({
    where: { workspaceId: workspace.id },
    update: { status: SwarmStatus.ACTIVE, swarmApiKey: encryptedSwarmApiKey },
    create: {
      name: "openlaw-swarm",
      status: SwarmStatus.ACTIVE,
      workspaceId: workspace.id,
      swarmUrl: "http://localhost",
      swarmApiKey: encryptedSwarmApiKey,
    },
  });
  console.log("✓ openlaw swarm (ACTIVE, mock key)");

  // 4. Report-bearing benchmark runs (mirrors seedRunReportBundleRun, plus a
  // projectId so fix-snapshot run attribution has something to match).
  const now = new Date();
  const base = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

  const fullRun = {
    workspaceId: workspace.id,
    type: StakworkRunType.LEGAL_BENCHMARK_RUNNER,
    status: WorkflowStatus.COMPLETED,
    webhookUrl: "",
    projectId: 57419, // matches mock-fix-2's project_id → "this run" badge
    result: JSON.stringify({
      taskSlug: "contract-review-nda-01",
      taskTitle: "Contract Review — Mutual NDA (seeded report)",
      requestedModel: "claude-sonnet-5",
      requestedJudgeModel: "claude-sonnet-4-6",
      generateRunReport: true,
      n_passed: 1,
      n_total: 3,
      all_pass: false,
    }),
    dataType: "json",
    reportUrl: `${base}/api/mock/run-report/full`,
    updatedAt: now,
  };
  await prisma.stakworkRun.upsert({
    where: { id: "seed-run-report-openlaw" },
    update: fullRun,
    create: { id: "seed-run-report-openlaw", createdAt: now, ...fullRun },
  });
  console.log("✓ Run with mock report bundle: seed-run-report-openlaw");

  const unavailableRun = {
    ...fullRun,
    projectId: null,
    result: JSON.stringify({
      taskSlug: "contract-review-nda-01",
      taskTitle: "Contract Review — Mutual NDA (bundle unavailable)",
      generateRunReport: true,
    }),
    // Parses and passes the guard shape checks for the mock host, but 404s on
    // fetch → the report page's "unavailable" state, where the graph-sourced
    // fix snapshot section must still render.
    reportUrl: `${base}/api/mock/run-report/does-not-exist`,
  };
  await prisma.stakworkRun.upsert({
    where: { id: "seed-run-report-unavailable-openlaw" },
    update: unavailableRun,
    create: { id: "seed-run-report-unavailable-openlaw", createdAt: now, ...unavailableRun },
  });
  console.log("✓ Run with unavailable bundle: seed-run-report-unavailable-openlaw");

  console.log("\nDemo URLs (sign in first via mock login as 'demo'):");
  console.log("  http://localhost:3000/w/openlaw/legal/benchmarks?tab=recursion");
  console.log("  http://localhost:3000/w/openlaw/legal/benchmarks/runs/seed-run-report-openlaw/report");
  console.log(
    "  http://localhost:3000/w/openlaw/legal/benchmarks/runs/seed-run-report-unavailable-openlaw/report",
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
