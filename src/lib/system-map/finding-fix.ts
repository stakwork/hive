/**
 * Pure logic for automated Infosec finding fixes: which findings may be fixed
 * and why not, the per-request bulk cap, the already-fixing refusal, repo
 * resolution and the webhook-status mapping. No I/O — see
 * `services/system-map/finding-fix.ts` for the dispatch.
 */

import type { FindingFixStatus } from "@prisma/client";
import type { SystemMapFinding, SystemMapFindingFix } from "@/types/system-map";

/** Most findings one bulk Fix request takes. */
export const MAX_FIX_BATCH = 10;

export type FindingFixKind = "package_cve" | "code_issue";

/** Fix states that block a new run for the same finding. */
export const ACTIVE_FIX_STATUSES: readonly FindingFixStatus[] = ["QUEUED", "RUNNING"];

export function isActiveFixStatus(status: FindingFixStatus | string | null | undefined): boolean {
  return status === "QUEUED" || status === "RUNNING";
}

const PACKAGE_KEYS = [
  "cve_id",
  "cve",
  "cves",
  "advisory_id",
  "advisory",
  "purl",
  "package",
  "package_name",
  "fixed_in",
];
const KIND_KEYS = ["finding_type", "type", "kind", "category", "source"];
const PACKAGE_KIND_RE = /cve|package|dependenc|vulnerable[_ -]?pkg|advisory/i;

function hasValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim() !== "";
  return value !== null && value !== undefined;
}

/** `package_cve` / `code_issue`, or null for kinds the fixer does not handle yet. */
export function classifyFinding(finding: SystemMapFinding): FindingFixKind | null {
  const p = finding.properties;
  const kindText = KIND_KEYS.map((k) => p[k]).filter((v): v is string => typeof v === "string");
  if (PACKAGE_KEYS.some((k) => hasValue(p[k])) || kindText.some((v) => PACKAGE_KIND_RE.test(v))) {
    return "package_cve";
  }
  if (finding.cweId && finding.file) return "code_issue";
  return null;
}

/** The verdict `finding_verify` wrote (`finding_status`), lower-cased. */
export function findingVerdict(finding: SystemMapFinding): string | null {
  const v = finding.properties.finding_status;
  return typeof v === "string" && v.trim() ? v.trim().toLowerCase() : null;
}

export type FixEligibility = { eligible: true; kind: FindingFixKind } | { eligible: false; reason: string };

/** Can this finding be auto-fixed? The reason is shown in the UI and returned by the API. */
export function getFixEligibility(finding: SystemMapFinding): FixEligibility {
  const verdict = findingVerdict(finding);
  if (verdict !== "confirmed") {
    return { eligible: false, reason: "Only confirmed findings can be fixed — run a check and write verdicts first" };
  }
  const kind = classifyFinding(finding);
  if (!kind) {
    return { eligible: false, reason: "Automated fixes cover vulnerable packages and code issues (CWE) only" };
  }
  return { eligible: true, kind };
}

export function validateFixBatch(refIds: string[]): string | null {
  if (refIds.length === 0) return "Select at least one finding";
  if (refIds.length > MAX_FIX_BATCH) return `At most ${MAX_FIX_BATCH} findings can be fixed at once`;
  return null;
}

export type FixRefusal = { refId: string; reason: string };

/**
 * Splits requested findings into those to dispatch and those refused
 * (missing, ineligible, or already being fixed).
 */
export function planFixes(
  refIds: string[],
  findings: Map<string, SystemMapFinding>,
  activeRefIds: Set<string>,
): { accepted: { finding: SystemMapFinding; kind: FindingFixKind }[]; refused: FixRefusal[] } {
  const accepted: { finding: SystemMapFinding; kind: FindingFixKind }[] = [];
  const refused: FixRefusal[] = [];
  for (const refId of refIds) {
    const finding = findings.get(refId);
    if (!finding) {
      refused.push({ refId, reason: "Finding not found" });
      continue;
    }
    if (activeRefIds.has(refId)) {
      refused.push({ refId, reason: "A fix for this finding is already in progress" });
      continue;
    }
    const eligibility = getFixEligibility(finding);
    if (!eligibility.eligible) refused.push({ refId, reason: eligibility.reason });
    else accepted.push({ finding, kind: eligibility.kind });
  }
  return { accepted, refused };
}

/** Same eligibility, plus the in-progress state, as the UI shows it. */
export function fixDisabledReason(finding: SystemMapFinding, fix: SystemMapFindingFix | undefined): string | null {
  if (fix && isActiveFixStatus(fix.status)) return "A fix is already in progress";
  const eligibility = getFixEligibility(finding);
  return eligibility.eligible ? null : eligibility.reason;
}

function canonical(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/(www\.)?github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
}

/**
 * The repo a fix targets: the finding's own repository property, else the
 * repo whose `owner/name` prefixes the file path, else the workspace's only
 * repo. Null when it is ambiguous.
 */
export function resolveFixRepository<T extends { repositoryUrl: string }>(
  finding: SystemMapFinding,
  repositories: T[],
): T | null {
  const p = finding.properties;
  for (const key of ["repository_url", "repository", "repo_url", "repo"]) {
    const value = p[key];
    if (typeof value === "string" && value.trim()) {
      const wanted = canonical(value);
      const hit = repositories.find((r) => {
        const have = canonical(r.repositoryUrl);
        return have === wanted || have.endsWith(`/${wanted}`) || have.split("/").pop() === wanted;
      });
      if (hit) return hit;
    }
  }
  const file = (finding.file ?? "").toLowerCase().replace(/^\/+/, "");
  if (file) {
    const hit = repositories.find((r) => file.startsWith(`${canonical(r.repositoryUrl)}/`));
    if (hit) return hit;
  }
  return repositories.length === 1 ? repositories[0] : null;
}

/** Statuses a callback may report, mapped onto the stored status. */
const WEBHOOK_STATUS_MAP: Record<string, FindingFixStatus> = {
  queued: "QUEUED",
  pending: "QUEUED",
  running: "RUNNING",
  in_progress: "RUNNING",
  started: "RUNNING",
  pr_opened: "PR_OPENED",
  pr_created: "PR_OPENED",
  completed: "PR_OPENED",
  complete: "PR_OPENED",
  success: "PR_OPENED",
  failed: "FAILED",
  error: "FAILED",
};

/**
 * Maps a callback payload to the stored status. A PR URL means PR_OPENED
 * whatever the status says; "completed" without one is a failure (nothing
 * to review). Null for an unrecognised status.
 */
export function mapWebhookStatus(
  status: string | undefined,
  prUrl: string | undefined | null,
): FindingFixStatus | null {
  if (prUrl) return status && WEBHOOK_STATUS_MAP[status.toLowerCase()] === "FAILED" ? "FAILED" : "PR_OPENED";
  if (!status) return null;
  const mapped = WEBHOOK_STATUS_MAP[status.toLowerCase()];
  if (!mapped) return null;
  return mapped === "PR_OPENED" ? "FAILED" : mapped;
}

/** Only https GitHub PR URLs are stored and linked. */
export function isGithubPrUrl(url: string): boolean {
  return /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/.test(url);
}

/** Terminal states don't move again, except QUEUED → anything. */
export function canTransition(from: FindingFixStatus, to: FindingFixStatus): boolean {
  if (from === to) return false;
  if (from === "PR_OPENED" || from === "FAILED") return false;
  if (from === "RUNNING" && to === "QUEUED") return false;
  return true;
}

export function buildFixPrompt(kind: FindingFixKind, finding: SystemMapFinding): string {
  const where = finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ""}` : "unknown location";
  const head =
    kind === "package_cve"
      ? "Fix this vulnerable dependency: upgrade to the fixed version (or the smallest safe change), update lockfiles, keep the build and tests passing."
      : `Fix this security issue${finding.cweId ? ` (${finding.cweId})` : ""} with the smallest safe code change, adding or updating a test where practical.`;
  return [
    head,
    `Title: ${finding.title}`,
    `Severity: ${finding.severity ?? "unrated"}`,
    `Location: ${where}`,
    finding.description ? `Details: ${finding.description}` : null,
    "Open a pull request with the change; do not push to the default branch.",
  ]
    .filter(Boolean)
    .join("\n");
}
