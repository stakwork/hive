import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { completeProtectReview, isProtectReviewInFlight, PROTECT_ERRORS } from "@/services/protect";
import { canonicalRepoKey } from "@/lib/utils/error-fingerprint";
import {
  PROTECT_FINDING_CATEGORIES,
  PROTECT_FINDING_SEVERITIES,
  PROTECT_FINDING_STATUSES,
  PROTECT_STRING_LIMITS,
  type IncomingProtectFinding,
} from "@/types/protect";

const findingSchema = z
  .object({
    id: z.string().max(200).optional(),
    category: z.enum(PROTECT_FINDING_CATEGORIES),
    severity: z.enum(PROTECT_FINDING_SEVERITIES),
    area: z.string().max(PROTECT_STRING_LIMITS.area).default(""),
    file: z.string().min(1).max(PROTECT_STRING_LIMITS.file),
    line: z.number().int().nullable().optional().default(null),
    title: z.string().min(1).max(PROTECT_STRING_LIMITS.title),
    description: z.string().max(PROTECT_STRING_LIMITS.description).default(""),
    evidence: z.string().max(PROTECT_STRING_LIMITS.evidence).default(""),
    recommendation: z.string().max(PROTECT_STRING_LIMITS.recommendation).default(""),
    status: z.enum(PROTECT_FINDING_STATUSES).optional(),
    repositoryUrl: z.string().min(1).max(PROTECT_STRING_LIMITS.repositoryUrl),
    titlefingerprint: z.string().min(1).optional(),
  })
  .strip();

const webhookSchema = z
  .object({
    runId: z.string().min(1),
    status: z.enum(["completed", "failed", "complete", "success", "error"]).optional(),
    workspaceId: z.string().optional(),
    findings: z.array(findingSchema).max(500).optional().default([]),
    results: z
      .object({
        findings: z.array(findingSchema).max(500).optional(),
      })
      .optional(),
    error: z.string().optional(),
  })
  .strip();

function isAuthorized(request: NextRequest): boolean {
  const apiToken = request.headers.get("x-api-token");
  const expectedToken = process.env.API_TOKEN ?? "";
  const apiTokenBuf = Buffer.from(apiToken ?? "");
  const expectedTokenBuf = Buffer.from(expectedToken);
  return Boolean(
    apiToken &&
      expectedToken &&
      apiTokenBuf.length === expectedTokenBuf.length &&
      timingSafeEqual(apiTokenBuf, expectedTokenBuf),
  );
}

function normalizeStatus(status: string | undefined): "completed" | "failed" {
  if (!status) return "completed";
  const lowered = status.toLowerCase();
  if (lowered === "failed" || lowered === "error") return "failed";
  return "completed";
}

export async function POST(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const payload = webhookSchema.parse(body);

    const run = await db.protectReviewRun.findUnique({
      where: { id: payload.runId },
      select: {
        id: true,
        workspaceId: true,
        status: true,
        mode: true,
        repositoryUrl: true,
        snapshotRepos: {
          select: { canonicalUrl: true },
        },
        workspace: {
          select: {
            repositories: {
              select: { repositoryUrl: true },
            },
          },
        },
      },
    });

    if (!run || !isProtectReviewInFlight(run.status)) {
      return NextResponse.json({ error: PROTECT_ERRORS.RUN_NOT_FOUND }, { status: 404 });
    }

    const workspaceCanonicalUrls = new Set(
      run.workspace.repositories
        .map((repo) => canonicalRepoKey(repo.repositoryUrl))
        .filter((key) => key !== "unknown"),
    );
    const snapshotCanonicalUrls = new Set(
      run.snapshotRepos
        .map((row) => row.canonicalUrl)
        .filter((key) => key && key !== "unknown"),
    );
    if (snapshotCanonicalUrls.size === 0 && run.repositoryUrl) {
      const incrementalKey = canonicalRepoKey(run.repositoryUrl);
      if (incrementalKey !== "unknown") snapshotCanonicalUrls.add(incrementalKey);
    }

    const rawFindings = payload.findings.length > 0 ? payload.findings : payload.results?.findings ?? [];
    const findings: IncomingProtectFinding[] = [];
    for (const finding of rawFindings) {
      const findingKey = canonicalRepoKey(finding.repositoryUrl);
      const ownedByWorkspace = workspaceCanonicalUrls.has(findingKey);
      const allowedBySnapshot = snapshotCanonicalUrls.has(findingKey);

      if (!ownedByWorkspace || !allowedBySnapshot) {
        return NextResponse.json(
          { error: "repositoryUrl is not owned by this workspace" },
          { status: 400 },
        );
      }
      findings.push({
        id: finding.id,
        category: finding.category,
        severity: finding.severity,
        area: finding.area,
        file: finding.file,
        line: finding.line ?? null,
        title: finding.title,
        description: finding.description,
        evidence: finding.evidence,
        recommendation: finding.recommendation,
        status: finding.status,
        repositoryUrl: finding.repositoryUrl,
        titlefingerprint: finding.titlefingerprint,
      });
    }

    const result = await completeProtectReview({
      runId: run.id,
      status: normalizeStatus(payload.status),
      findings,
      error: payload.error,
    });

    return NextResponse.json({
      success: true,
      runId: result.run.id,
      status: result.run.status,
      counts: result.counts,
    });
  } catch (error) {
    console.error("[Protect] webhook error:", error);

    if (error && typeof error === "object" && "issues" in error) {
      return NextResponse.json(
        { error: "Invalid webhook payload", details: (error as { issues: unknown }).issues },
        { status: 400 },
      );
    }

    if (error instanceof Error && error.message === PROTECT_ERRORS.RUN_NOT_FOUND) {
      return NextResponse.json({ error: PROTECT_ERRORS.RUN_NOT_FOUND }, { status: 404 });
    }

    if (error instanceof Error && error.message === PROTECT_ERRORS.RUN_NOT_IN_FLIGHT) {
      return NextResponse.json({ error: PROTECT_ERRORS.RUN_NOT_IN_FLIGHT }, { status: 409 });
    }

    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
