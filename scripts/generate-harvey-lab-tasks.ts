#!/usr/bin/env npx tsx
/**
 * Regenerates src/lib/harvey-lab-tasks.ts from the actual
 * stakwork/harvey-labs GitHub repo directory structure.
 *
 * Usage:
 *   GITHUB_TOKEN=<token> npx tsx scripts/generate-harvey-lab-tasks.ts
 */

import { writeFileSync } from "fs";
import { join } from "path";

const REPO = "stakwork/harvey-labs";
const BASE_URL = `https://api.github.com/repos/${REPO}/contents/tasks`;
const TOKEN = process.env.GITHUB_TOKEN;

type GhEntry = { name: string; type: string };
type TaskJson = {
  title?: string;
  work_type?: string;
  tags?: string[];
};

function label(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
    .replace("Ma", "M&A") // corporate-ma → Corporate M&A
    .replace("And ", "& ")
    .replace(/\bEsg\b/, "ESG")
    .replace(/\bMa\b/, "M&A");
}

async function ghFetch(url: string): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`GitHub API error ${res.status} for ${url}`);
  }
  return res.json();
}

async function fetchTaskJson(practiceArea: string, taskSlug: string): Promise<TaskJson | null> {
  const rawUrl = `https://raw.githubusercontent.com/${REPO}/main/tasks/${practiceArea}/${taskSlug}/task.json`;
  const headers: Record<string, string> = {};
  if (TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;
  try {
    const res = await fetch(rawUrl, { headers });
    if (!res.ok) return null;
    return (await res.json()) as TaskJson;
  } catch {
    return null;
  }
}

function toWorkType(raw: string | undefined): string {
  const valid = ["draft", "review", "extract", "compare", "identify"];
  if (raw && valid.includes(raw.toLowerCase())) return raw.toLowerCase();
  return "review";
}

// Pretty-label overrides for practice areas whose slug doesn't map cleanly
const LABEL_OVERRIDES: Record<string, string> = {
  "arbitration-international-dispute-resolution": "Arbitration & International Dispute Resolution",
  "banking-finance": "Banking & Finance",
  "bankruptcy-restructuring": "Bankruptcy & Restructuring",
  "capital-markets": "Capital Markets",
  "contracts": "Contracts",
  "corporate-governance": "Corporate Governance",
  "corporate-ma": "Corporate M&A",
  "data-privacy-cybersecurity": "Data Privacy & Cybersecurity",
  "emerging-companies-venture-capital": "Emerging Companies & Venture Capital",
  "employment-labor": "Employment & Labor",
  "energy-natural-resources": "Energy & Natural Resources",
  "environmental-esg": "Environmental & ESG",
  "funds-asset-management": "Funds & Asset Management",
  "healthcare-life-sciences": "Healthcare & Life Sciences",
  "immigration": "Immigration",
  "insurance": "Insurance",
  "intellectual-property": "Intellectual Property",
  "international-trade-sanctions": "International Trade & Sanctions",
  "litigation-dispute-resolution": "Litigation & Dispute Resolution",
  "real-estate": "Real Estate",
  "structured-finance-securitization": "Structured Finance & Securitization",
  "tax": "Tax",
  "trusts-estates-private-client": "Trusts, Estates & Private Client",
  "white-collar-defense-investigations": "White Collar Defense & Investigations",
  "antitrust-competition": "Antitrust & Competition",
};

async function main() {
  console.log("Fetching practice areas...");
  const practiceAreas = (await ghFetch(BASE_URL)) as GhEntry[];
  const dirs = practiceAreas.filter((e) => e.type === "dir").map((e) => e.name);
  console.log(`Found ${dirs.length} practice areas`);

  type TaskEntry = {
    slug: string;
    title: string;
    work_type: string;
    tags: string[];
  };

  type PracticeAreaEntry = {
    slug: string;
    label: string;
    tasks: TaskEntry[];
  };

  const result: PracticeAreaEntry[] = [];
  let totalTasks = 0;

  for (const pa of dirs) {
    console.log(`  Processing ${pa}...`);
    const taskDirs = (await ghFetch(`${BASE_URL}/${pa}`)) as GhEntry[];
    const taskSlugs = taskDirs.filter((e) => e.type === "dir").map((e) => e.name);

    const tasks: TaskEntry[] = [];
    for (const ts of taskSlugs) {
      const tj = await fetchTaskJson(pa, ts);
      const titleFromSlug = ts
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");

      tasks.push({
        slug: `${pa}/${ts}`,
        title: tj?.title ?? titleFromSlug,
        work_type: toWorkType(tj?.work_type),
        tags: tj?.tags ?? [],
      });
    }

    totalTasks += tasks.length;
    result.push({
      slug: pa,
      label: LABEL_OVERRIDES[pa] ?? label(pa),
      tasks,
    });

    console.log(`    → ${tasks.length} tasks`);
  }

  console.log(`\nTotal tasks: ${totalTasks}`);

  // Render TypeScript source
  const taskLines = result
    .map((pa) => {
      const taskArr = pa.tasks
        .map(
          (t) =>
            `      { slug: ${JSON.stringify(t.slug)}, title: ${JSON.stringify(t.title)}, work_type: ${JSON.stringify(t.work_type)}, tags: ${JSON.stringify(t.tags)} },`
        )
        .join("\n");
      return `  {\n    slug: ${JSON.stringify(pa.slug)},\n    label: ${JSON.stringify(pa.label)},\n    tasks: [\n${taskArr}\n    ],\n  },`;
    })
    .join("\n");

  const output = `/**
 * Harvey LAB benchmark task index — auto-generated file.
 * ${result.length} practice areas, ${totalTasks} real legal tasks.
 * Source: Harvey LAB dataset (tasks/{practice-area}/{task-slug}/task.json)
 * Regenerated by: scripts/generate-harvey-lab-tasks.ts
 */

export type WorkType = "draft" | "review" | "extract" | "compare" | "identify";

export type HarveyTask = {
  slug: string;
  title: string;
  work_type: WorkType;
  tags: string[];
};

export type HarveyPracticeArea = {
  slug: string;
  label: string;
  tasks: HarveyTask[];
};

export const HARVEY_LAB_TASKS: HarveyPracticeArea[] = [
${taskLines}
];

export const HARVEY_LAB_TOTAL = ${totalTasks};

/**
 * Tailwind colour classes for each work type badge.
 * Exported so TaskDetailsModal and LegalBenchmarksPanel share the same styles.
 */
export const WORK_TYPE_STYLES: Record<WorkType, string> = {
  draft: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  review: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
  extract: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  compare: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300",
  identify: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300",
};
`;

  const outPath = join(process.cwd(), "src/lib/harvey-lab-tasks.ts");
  writeFileSync(outPath, output, "utf-8");
  console.log(`\nWrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
