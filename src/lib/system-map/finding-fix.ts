/**
 * Pure logic for automated Infosec finding fixes: which findings may be fixed
 * and why not, the per-request bulk cap, the already-fixing refusal, repo
 * resolution and the webhook-status mapping. No I/O — see
 * `services/system-map/finding-fix.ts` for the dispatch.
 */

import type {
  SystemMapFinding,
  SystemMapFindingFix,
  SystemMapFindingFixStatus,
  SystemMapFindingFixTracking,
} from "@/types/system-map";

/** Most findings one bulk Fix request takes. */
export const MAX_FIX_BATCH = 10;

// ── tracking on the Finding node ────────────────────────────────────────────

/** The `fix_*` properties a Fix writes on the Finding node. */
export const FIX_PROPERTY = {
  conversationId: "fix_conversation_id",
  kind: "fix_kind",
  repo: "fix_repo",
  state: "fix_state",
  startedAt: "fix_started_at",
  startedBy: "fix_started_by",
} as const;

/** A `launching` mark older than this is expired: its launch died without clearing it. */
export const FIX_LAUNCH_STALE_MS = 5 * 60_000;

function text(properties: Record<string, unknown>, key: string): string | null {
  const v = properties[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** The node's fix tracking; null when it carries none (cleared marks are empty strings). */
export function parseFixTracking(properties: Record<string, unknown>): SystemMapFindingFixTracking | null {
  const state = text(properties, FIX_PROPERTY.state);
  const tracking: SystemMapFindingFixTracking = {
    conversationId: text(properties, FIX_PROPERTY.conversationId),
    kind: text(properties, FIX_PROPERTY.kind),
    repo: text(properties, FIX_PROPERTY.repo),
    state: state === "launching" || state === "launched" ? state : null,
    startedAt: text(properties, FIX_PROPERTY.startedAt),
    startedBy: text(properties, FIX_PROPERTY.startedBy),
  };
  return tracking.conversationId || tracking.state ? tracking : null;
}

/** Properties that mark a launch in progress (no conversation yet). */
export function launchingMark(args: { kind: string; repo: string; startedAt: string; startedBy: string }) {
  return {
    [FIX_PROPERTY.state]: "launching",
    [FIX_PROPERTY.kind]: args.kind,
    [FIX_PROPERTY.repo]: args.repo,
    [FIX_PROPERTY.startedAt]: args.startedAt,
    [FIX_PROPERTY.startedBy]: args.startedBy,
    [FIX_PROPERTY.conversationId]: "",
  };
}

/** Properties that record the running conversation. */
export function launchedMark(conversationId: string) {
  return { [FIX_PROPERTY.state]: "launched", [FIX_PROPERTY.conversationId]: conversationId };
}

/** Properties that undo a `launching` mark. */
export const FIX_CLEAR_MARK: Record<string, string> = Object.fromEntries(
  Object.values(FIX_PROPERTY).map((key) => [key, ""]),
);

/** Is a launch in progress on this node (a fresh `launching` mark without a conversation)? */
export function isLaunching(tracking: SystemMapFindingFixTracking | null, now: number = Date.now()): boolean {
  if (!tracking || tracking.state !== "launching" || tracking.conversationId) return false;
  const started = tracking.startedAt ? Date.parse(tracking.startedAt) : NaN;
  return Number.isFinite(started) && now - started < FIX_LAUNCH_STALE_MS;
}

export type FindingFixKind = "package_cve" | "code_issue";

export function isActiveFixStatus(status: SystemMapFindingFixStatus | string | null | undefined): boolean {
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

/** Only https GitHub PR URLs are stored and linked. */
export function isGithubPrUrl(url: string): boolean {
  return /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/.test(url);
}

/** The strut runs of a fix's conversation, as far as its status goes. */
export interface FixRunState {
  /** `orchestrator_turn` or `job_turn` (the `StrutRun.kind`). */
  kind: string;
  status: "PENDING" | "SUCCESS" | "ERROR" | "CANCELLED" | "LOST";
  error?: string | null;
}

/**
 * The first PR the job reported: a `pull_request` artifact on a conversation
 * row (`job-turn.ts` appends the job's cards to its `job-<id>` row as
 * `{ kind: "pull_request", source: { type: "inline", content: { url } } }`).
 */
export function extractPrUrl(messages: unknown): string | null {
  if (!Array.isArray(messages)) return null;
  for (const message of messages) {
    const artifacts = (message as { artifacts?: unknown } | null)?.artifacts;
    if (!Array.isArray(artifacts)) continue;
    for (const artifact of artifacts) {
      const a = artifact as { kind?: unknown; source?: { content?: { url?: unknown } } } | null;
      const url = a?.kind === "pull_request" ? a.source?.content?.url : undefined;
      if (typeof url === "string" && isGithubPrUrl(url)) return url;
    }
  }
  return null;
}

/**
 * A fix's status from what strut reported for its conversation:
 *   - a PR on a row → PR_OPENED, whatever else runs;
 *   - a run still PENDING → RUNNING once a job has been started, else QUEUED
 *     (the orchestrator turn is deciding / starting it);
 *   - nothing pending: an errored, stopped or lost run → FAILED with its
 *     error; a clean end without a PR → FAILED (nothing to review).
 */
export function deriveFixStatus(
  runs: FixRunState[],
  prUrl: string | null,
): { status: SystemMapFindingFixStatus; error: string | null } {
  if (prUrl) return { status: "PR_OPENED", error: null };
  if (runs.some((r) => r.status === "PENDING")) {
    return { status: runs.some((r) => r.kind === "job_turn") ? "RUNNING" : "QUEUED", error: null };
  }
  if (runs.length === 0) return { status: "QUEUED", error: null };
  const bad = runs.find((r) => r.status !== "SUCCESS");
  if (bad) {
    const reason = bad.error || (bad.status === "CANCELLED" ? "The run was stopped" : "The run failed");
    return { status: "FAILED", error: reason };
  }
  return { status: "FAILED", error: "The agent finished without opening a pull request" };
}

/** Keys left out of the seed, as Jamie redacts secret-category evidence. */
const SENSITIVE_KEY_RE = /secret|token|password|credential|evidence/i;

/**
 * The message the orchestrator strut is launched with — the Protect Jamie
 * seed (`buildProtectJamieSeed`, `start_job` flavour) for an Infosec finding.
 */
export function buildFindingFixSeed(
  kind: FindingFixKind,
  finding: SystemMapFinding,
  workspaceSlug: string,
  repositoryUrl: string,
): string {
  const where = finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ""}` : "(unknown)";
  const task =
    kind === "package_cve"
      ? "This is a vulnerable package (CVE). Bump it to the fixed version (the advisory's fixed_in, else the smallest safe upgrade), update the lockfile, keep the build and tests passing, and open a pull request."
      : `This is a code issue${finding.cweId ? ` (${finding.cweId})` : ""} at ${where}. Fix it with the smallest safe code change, add or update a test where practical, and open a pull request.`;
  const details = Object.entries(finding.properties)
    .filter(([key]) => key !== "description" && !SENSITIVE_KEY_RE.test(key))
    .map(([key, value]) => `${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join("\n")
    .slice(0, 4000);
  return [
    "You are helping a workspace member act on a single confirmed Infosec security finding.",
    "Work on this finding only. Do not batch other findings.",
    `Fix it as a job: use the start_job tool with workspace "${workspaceSlug}", and name the repository ${repositoryUrl} in the job's prompt. The job must open a pull request against that repository (never push to the default branch) and report the PR.`,
    task,
    "",
    `Title: ${finding.title}`,
    `Severity: ${finding.severity ?? "unrated"}`,
    `CWE: ${finding.cweId ?? "(none)"}`,
    `Workspace: ${workspaceSlug}`,
    `Repository: ${repositoryUrl}`,
    `File: ${finding.file ?? "(none)"}`,
    `Line: ${finding.line ?? "(unknown)"}`,
    "",
    "Description:",
    finding.description || "(none)",
    "",
    "Finding properties:",
    details || "(none)",
  ].join("\n");
}
