#!/usr/bin/env npx tsx
/**
 * DEV-ONLY seed script — inserts a StakworkRun of type LEGAL_BENCHMARK_RUNNER
 * whose criteria_results carry flagged/llm_flag_reason so QA can view the
 * Judge Dispute sub-block in the Rubric Details panel without waiting on the
 * upstream harvey_lab_score_rubric Lambda (tracked external dependency in
 * stakwork/senza-lnd).
 *
 * NOTE: The `market-definition` entry now includes `flag_basis: "criterion_validity"`
 * and `contested: true`. This means that criterion is excluded from both the
 * score numerator and denominator (via isCriterionContested / criterionStatus).
 * The seed's hand-authored n_passed/n_total do not reflect this exclusion —
 * the graph-first score denominator (from EvalRequirement roster) overrides
 * runner-echoed counts in the UI. This is expected and intentional.
 *
 * Matrix of dispute states exercised by this seed:
 *   market-definition  — flagged + flag_basis ("criterion_validity") + contested: true
 *   hhi-calculation    — flagged, no prose (marker "Disputed — no explanation provided")
 *   remedy-proposal    — prose only, no flagged (flag_basis "legitimate_failure"), renders as "Judge Note"
 *   empty-basis        — flagged + empty flag_basis (badge shown, generic tooltip)
 *   string-true        — flagged as "true" (string), exercises loose-value path
 *   efficiencies-analysis / procedural-compliance — plain pass, no dispute
 *
 * Usage:
 *   DATABASE_URL=<dev-db-url> WORKSPACE_ID=<id> npx tsx scripts/seed-judge-dispute-run.ts
 *
 * Or rely on the DATABASE_URL already set in your .env:
 *   npx tsx scripts/seed-judge-dispute-run.ts
 *
 * The script prints the inserted StakworkRun ID and a direct path to the run
 * so you can open it immediately.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const WORKSPACE_ID = process.env.WORKSPACE_ID;
const TASK_SLUG = process.env.TASK_SLUG ?? "antitrust/merger-analysis-task-1";

async function main() {
  if (!WORKSPACE_ID) {
    console.error(
      "ERROR: WORKSPACE_ID env var required.\n" +
        "  WORKSPACE_ID=<id> npx tsx scripts/seed-judge-dispute-run.ts\n" +
        "\nTo find a workspace id:\n" +
        "  npx tsx -e \"const {PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.workspace.findMany({select:{id:true,slug:true}}).then(r=>{console.log(r);p.\$disconnect()})\"",
    );
    process.exit(1);
  }

  // Ensure the workspace exists before inserting
  const workspace = await prisma.workspace.findUnique({
    where: { id: WORKSPACE_ID },
    select: { id: true, slug: true },
  });
  if (!workspace) {
    console.error(`ERROR: Workspace "${WORKSPACE_ID}" not found.`);
    process.exit(1);
  }

  const resultJson = {
    taskSlug: TASK_SLUG,
    taskTitle: "[DEV SEED] Merger Analysis Task",
    output:
      "The proposed merger between Acme Corp and GlobalMart creates a combined entity " +
      "controlling 42% of the relevant market. Under the HHI framework the delta exceeds " +
      "2500 points, raising substantial competitive concerns.",
    n_passed: 3,
    n_total: 5,
    all_pass: false,
    model: "claude-sonnet-5",
    judge_model: "claude-opus-4-5",
    criteria_results: [
      // ── Both fields set (full dispute) + contested + flag_basis ────────────
      // NOTE: contested:true excludes this from graph-first score denominator.
      {
        id: "market-definition",
        title: "Correct market definition applied",
        verdict: "fail",
        reasoning:
          "The deliverable defines the relevant market as 'retail grocery' without " +
          "distinguishing online vs brick-and-mortar, which the applicable precedent " +
          "(FTC v. Whole Foods) requires.",
        flagged: true,
        flag_basis: "criterion_validity",
        contested: true,
        llm_flag_reason:
          "The task brief did not specify the Whole Foods precedent as a mandatory " +
          "citation. The market definition provided is consistent with the EC Horizontal " +
          "Merger Guidelines §12, which the brief did reference. The judge appears to be " +
          "applying a US-law standard to an EU-law deliverable.",
      },
      // ── Marked, no prose (marker-only dispute) — flag_basis intentionally absent
      {
        id: "hhi-calculation",
        title: "HHI delta computed correctly",
        verdict: "fail",
        reasoning:
          "The post-merger HHI is stated as 2,847 but the source data yields 2,612.",
        flagged: true,
        // intentionally no llm_flag_reason — triggers "Disputed — no explanation provided"
        // intentionally no flag_basis — tests graceful degradation (generic tooltip)
      },
      // ── Prose only, no flagged field — renders as "Judge Note" (not a dispute)
      {
        id: "remedy-proposal",
        title: "Proposed remedy addresses competitive harm",
        verdict: "fail",
        reasoning:
          "Structural remedies are not discussed; the deliverable only proposes " +
          "behavioural undertakings.",
        flag_basis: "legitimate_failure",
        llm_flag_reason:
          "The brief explicitly restricted analysis to behavioural remedies in §4.2. " +
          "A structural remedy discussion was out of scope for this deliverable.",
      },
      // ── flagged with empty flag_basis — badge shown, tooltip falls back to generic copy
      {
        id: "empty-basis",
        title: "Empty flag_basis graceful degradation",
        verdict: "fail",
        reasoning: "This criterion tests the empty flag_basis path.",
        flagged: true,
        flag_basis: "",
        llm_flag_reason: "The judge may have misread the source table.",
      },
      // ── flagged as string "true" — exercises loose-value path end-to-end
      {
        id: "string-true-flagged",
        title: "String-typed flagged graceful handling",
        verdict: "fail",
        reasoning: "This criterion tests flagged as a string value.",
        flagged: "true",
        flag_basis: "judge_error",
        llm_flag_reason: "The judge misidentified the controlling precedent.",
      },
      // ── No dispute (today's shape — renders exactly as before) ─────────────
      {
        id: "efficiencies-analysis",
        title: "Efficiencies defence adequately assessed",
        verdict: "pass",
        reasoning: "The cost-saving synergies are quantified and verifiable.",
      },
      {
        id: "procedural-compliance",
        title: "Filing procedural requirements met",
        verdict: "pass",
        reasoning: "All mandatory annexes are present and correctly formatted.",
      },
    ],
  };

  const run = await prisma.stakworkRun.create({
    data: {
      workspaceId: WORKSPACE_ID,
      type: "LEGAL_BENCHMARK_RUNNER",
      status: "COMPLETED",
      projectId: null,
      result: JSON.stringify(resultJson),
      taskSlug: TASK_SLUG,
      runnerOutputText: resultJson.output,
    },
  });

  console.log("\n✅ Seeded StakworkRun:");
  console.log(`   id:        ${run.id}`);
  console.log(`   workspace: ${workspace.slug} (${workspace.id})`);
  console.log(`   taskSlug:  ${TASK_SLUG}`);
  console.log(
    "\nOpen in the app by navigating to the Legal Benchmarks page for",
    `workspace "${workspace.slug}" and loading run id: ${run.id}`,
  );
  console.log(
    "\nOr use the direct API:\n" +
      `  curl -s http://localhost:3000/api/legal-benchmark/run/${run.id} | jq .`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
