import { createHash } from "crypto";
import {
  addNode,
  listNodesByType,
  readNodeByRef,
  updateNodeV2,
  type JarvisGraphNode,
} from "@/services/swarm/api/nodes";
import type { JarvisConnectionConfig } from "@/types/jarvis";
import type {
  IncomingProtectFinding,
  ProtectFinding,
  ProtectFindingCategory,
  ProtectFindingSeverity,
  ProtectFindingStatus,
  ProtectFindingVerification,
  ProtectReviewCounts,
} from "@/types/protect";
import {
  PROTECT_FINDING_CATEGORIES,
  PROTECT_FINDING_SEVERITIES,
  PROTECT_FINDING_STATUSES,
  PROTECT_FINDING_VERIFICATIONS,
  PROTECT_STRING_LIMITS,
} from "@/types/protect";

export const SECURITY_FINDING_NODE_TYPE = "SecurityFinding";

const TITLE_FINGERPRINT_LENGTH = 16;

export function fingerprintTitle(title: string): string {
  return createHash("sha256")
    .update(title.trim().toLowerCase())
    .digest("hex")
    .slice(0, TITLE_FINGERPRINT_LENGTH);
}

/**
 * Upsert identity for a SecurityFinding node.
 * Line is intentionally excluded so moved code updates in place.
 */
export function buildFindingNodeKey(
  repositoryUrl: string,
  file: string,
  category: string,
  title: string,
): string {
  return [repositoryUrl.trim(), file.trim(), category.trim(), fingerprintTitle(title)].join("|");
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asBoundedString(value: unknown, max: number, fallback = ""): string {
  const text = asString(value, fallback);
  return text.length > max ? text.slice(0, max) : text;
}

function asCategory(value: unknown): ProtectFindingCategory | null {
  return PROTECT_FINDING_CATEGORIES.includes(value as ProtectFindingCategory)
    ? (value as ProtectFindingCategory)
    : null;
}

function asSeverity(value: unknown): ProtectFindingSeverity | null {
  return PROTECT_FINDING_SEVERITIES.includes(value as ProtectFindingSeverity)
    ? (value as ProtectFindingSeverity)
    : null;
}

function asVerification(value: unknown): ProtectFindingVerification | null {
  return PROTECT_FINDING_VERIFICATIONS.includes(value as ProtectFindingVerification)
    ? (value as ProtectFindingVerification)
    : null;
}

function asFindingStatus(value: unknown): ProtectFindingStatus {
  return PROTECT_FINDING_STATUSES.includes(value as ProtectFindingStatus)
    ? (value as ProtectFindingStatus)
    : "open";
}

function asLine(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return null;
}

export function parseProtectFinding(node: JarvisGraphNode): ProtectFinding | null {
  const properties = (node.properties ?? {}) as Record<string, unknown>;
  const category = asCategory(properties.category);
  const severity = asSeverity(properties.severity);
  const repositoryUrl = asBoundedString(
    properties.repositoryUrl,
    PROTECT_STRING_LIMITS.repositoryUrl,
  );
  const file = asBoundedString(properties.file, PROTECT_STRING_LIMITS.file);
  const title = asBoundedString(properties.title, PROTECT_STRING_LIMITS.title);
  if (!category || !severity || !repositoryUrl || !file || !title || !node.ref_id) {
    return null;
  }

  const node_key =
    asString(properties.node_key) ||
    buildFindingNodeKey(repositoryUrl, file, category, title);

  return {
    ref_id: node.ref_id,
    node_key,
    id: asString(properties.id, node_key),
    category,
    severity,
    area: asBoundedString(properties.area, PROTECT_STRING_LIMITS.area),
    file,
    line: asLine(properties.line),
    title,
    description: asBoundedString(properties.description, PROTECT_STRING_LIMITS.description),
    evidence: asBoundedString(properties.evidence, PROTECT_STRING_LIMITS.evidence),
    recommendation: asBoundedString(
      properties.recommendation,
      PROTECT_STRING_LIMITS.recommendation,
    ),
    verification: asVerification(properties.verification),
    status: asFindingStatus(properties.status),
    repositoryUrl,
  };
}

export function redactSecretEvidence<T extends { category: string; evidence: string }>(
  finding: T,
): T {
  if (finding.category !== "secret") return finding;
  return { ...finding, evidence: "" };
}

export type ListProtectFindingsResult =
  | { ok: true; findings: ProtectFinding[] }
  | { ok: false; findings: []; error: string; status?: number };

/**
 * List SecurityFinding nodes for a workspace swarm.
 * Surfaces ok / empty / error distinctly — never coerces Jarvis failure to [].
 */
export async function listProtectFindings(
  config: JarvisConnectionConfig,
): Promise<ListProtectFindingsResult> {
  const result = await listNodesByType(config, SECURITY_FINDING_NODE_TYPE, 500);
  if (!result.ok) {
    return {
      ok: false,
      findings: [],
      error: result.error || "Failed to load security findings",
      status: result.status,
    };
  }

  const findings = result.nodes
    .map(parseProtectFinding)
    .filter((finding): finding is ProtectFinding => finding !== null);

  return { ok: true, findings };
}

export async function getProtectFindingByRef(
  config: JarvisConnectionConfig,
  refId: string,
): Promise<ProtectFinding | null> {
  const result = await readNodeByRef(config, refId);
  if (!result.success || result.node_type !== SECURITY_FINDING_NODE_TYPE) {
    return null;
  }

  return parseProtectFinding({
    ref_id: result.ref_id ?? refId,
    node_type: result.node_type,
    properties: result.properties,
  });
}

function findingNodeData(
  finding: IncomingProtectFinding,
  nodeKey: string,
  status: ProtectFindingStatus,
): Record<string, unknown> {
  return {
    id: nodeKey,
    node_key: nodeKey,
    category: finding.category,
    severity: finding.severity,
    area: finding.area,
    file: finding.file,
    line: finding.line,
    title: finding.title,
    description: finding.description,
    evidence: finding.evidence,
    recommendation: finding.recommendation,
    status,
    repositoryUrl: finding.repositoryUrl,
  };
}

export interface ApplyProtectReviewResult {
  counts: ProtectReviewCounts;
  errors: string[];
}

/**
 * History-aware review upsert:
 * - matching node_key updates in place (reprocess)
 * - a stale match is reopened (status: open)
 * - keys the review no longer reports are marked stale
 * - verification is never written (member PATCH owns that field)
 * - incremental reviews only stale findings for the reviewed repository
 */
export async function applyProtectReviewFindings(
  config: JarvisConnectionConfig,
  incoming: IncomingProtectFinding[],
  options: {
    mode: "full" | "incremental";
    repositoryUrl?: string | null;
  },
): Promise<ApplyProtectReviewResult> {
  const priorResult = await listProtectFindings(config);
  if (!priorResult.ok) {
    return {
      counts: { created: 0, updated: 0, skipped: incoming.length, stale: 0 },
      errors: [priorResult.error],
    };
  }

  const priorByKey = new Map(priorResult.findings.map((finding) => [finding.node_key, finding]));
  const incomingKeys = new Set<string>();
  const counts: ProtectReviewCounts = { created: 0, updated: 0, skipped: 0, stale: 0 };
  const errors: string[] = [];

  for (const finding of incoming) {
    const nodeKey = buildFindingNodeKey(
      finding.repositoryUrl,
      finding.file,
      finding.category,
      finding.title,
    );
    incomingKeys.add(nodeKey);
    const prior = priorByKey.get(nodeKey);
    const created = await addNode(
      config,
      {
        node_type: SECURITY_FINDING_NODE_TYPE,
        node_data: findingNodeData(finding, nodeKey, "open"),
      },
      { reprocess: true },
    );

    if (!created.success) {
      counts.skipped += 1;
      errors.push(created.error || `Failed to upsert finding ${nodeKey}`);
      continue;
    }

    if (prior) {
      counts.updated += 1;
    } else {
      counts.created += 1;
    }
  }

  const staleTargets = priorResult.findings.filter((finding) => {
    if (incomingKeys.has(finding.node_key)) return false;
    if (finding.status === "stale") return false;
    if (
      options.mode === "incremental" &&
      options.repositoryUrl &&
      finding.repositoryUrl !== options.repositoryUrl
    ) {
      return false;
    }
    return true;
  });

  for (const finding of staleTargets) {
    const updated = await updateNodeV2(config, finding.ref_id, { status: "stale" });
    if (!updated.success) {
      errors.push(updated.message || `Failed to mark finding stale: ${finding.ref_id}`);
      continue;
    }
    counts.stale += 1;
  }

  return { counts, errors };
}

/**
 * Read-modify-write a finding's verification so concurrent review upserts
 * cannot clobber other attributes.
 */
export async function updateFindingVerification(
  config: JarvisConnectionConfig,
  refId: string,
  verification: ProtectFindingVerification,
): Promise<{ success: boolean; finding?: ProtectFinding; error?: string }> {
  const existing = await getProtectFindingByRef(config, refId);
  if (!existing) {
    return { success: false, error: "Finding not found" };
  }

  const updated = await updateNodeV2(config, refId, { verification });
  if (!updated.success) {
    return { success: false, error: updated.message || "Failed to update verification" };
  }

  return { success: true, finding: { ...existing, verification } };
}

export function serializeFindingForWorkflow(finding: ProtectFinding): Record<string, unknown> {
  const evidence = finding.category === "secret" ? "[redacted]" : finding.evidence;
  return {
    ref_id: finding.ref_id,
    node_key: finding.node_key,
    category: finding.category,
    severity: finding.severity,
    area: finding.area,
    file: finding.file,
    line: finding.line,
    title: finding.title,
    description: finding.description,
    evidence,
    recommendation: finding.recommendation,
    status: finding.status,
    repositoryUrl: finding.repositoryUrl,
  };
}
