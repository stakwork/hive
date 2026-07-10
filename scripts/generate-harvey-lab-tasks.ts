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
const TOKEN = process.env.GITHUB_TOKEN;

type TaskJson = {
  title?: string;
  work_type?: string;
  tags?: string[];
};

type TreeEntry = {
  path: string;
  type: string;
};

type TreeResponse = {
  tree: TreeEntry[];
  truncated: boolean;
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

async function fetchTaskJson(slug: string): Promise<TaskJson | null> {
  const rawUrl = `https://raw.githubusercontent.com/${REPO}/main/tasks/${slug}/task.json`;
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

/**
 * Derives a human-readable title from a slug when task.json has no `title`.
 * For deep slugs (e.g. "contracts/foo/bar/scenario-01"), picks the last
 * non-generic segment rather than blindly using the final segment, so
 * segments like "scenario-01", "scenario-1", "part-01" don't become the title.
 */
const GENERIC_SEGMENT_RE = /^(scenario|part|section|step|task|version|v\d+)-?\d*$/i;

export function titleFromSlug(slug: string): string {
  const segments = slug.split("/");
  // Walk backwards to find the last non-generic segment
  let chosen = segments[segments.length - 1];
  for (let i = segments.length - 1; i >= 0; i--) {
    if (!GENERIC_SEGMENT_RE.test(segments[i])) {
      chosen = segments[i];
      break;
    }
  }
  return chosen
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Filters a tree entry path to task.json blobs.
 * Must be under tasks/, not inside a documents/ subfolder.
 */
export const TASK_PATH_RE = /^tasks\/(?!.*\/documents\/).+\/task\.json$/;

/**
 * Derives the index slug from a tree path like "tasks/pa/foo/bar/task.json".
 * Result: "pa/foo/bar" (strips leading "tasks/" and trailing "/task.json").
 */
export function slugFromPath(treePath: string): string {
  return treePath.slice("tasks/".length, -"/task.json".length);
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
  console.log("Fetching recursive Git tree from stakwork/harvey-labs...");
  const treeUrl = `https://api.github.com/repos/${REPO}/git/trees/main?recursive=1`;
  const treeData = (await ghFetch(treeUrl)) as TreeResponse;

  if (treeData.truncated) {
    throw new Error(
      "Git tree too large — results would be incomplete. " +
        "The tree was truncated by GitHub; aborting to avoid writing a partial index."
    );
  }

  // Filter to task.json blobs at any depth under tasks/
  const taskPaths = treeData.tree
    .filter((entry) => entry.type === "blob" && TASK_PATH_RE.test(entry.path))
    .map((entry) => entry.path);

  console.log(`Found ${taskPaths.length} task.json files`);

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

  // Group slugs by practice area (first segment)
  const byArea = new Map<string, string[]>();
  for (const path of taskPaths) {
    const slug = slugFromPath(path);
    const practiceArea = slug.split("/")[0];
    if (!byArea.has(practiceArea)) byArea.set(practiceArea, []);
    byArea.get(practiceArea)!.push(slug);
  }

  // Sort practice areas deterministically by key
  const sortedAreas = [...byArea.keys()].sort();
  console.log(`Found ${sortedAreas.length} practice areas`);

  const result: PracticeAreaEntry[] = [];
  let totalTasks = 0;

  for (const pa of sortedAreas) {
    console.log(`  Processing ${pa}...`);
    // Sort tasks within the area deterministically by full slug
    const slugs = byArea.get(pa)!.sort();
    const tasks: TaskEntry[] = [];

    for (const slug of slugs) {
      const tj = await fetchTaskJson(slug);
      tasks.push({
        slug,
        title: tj?.title ?? titleFromSlug(slug),
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
