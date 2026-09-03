import { NextRequest, NextResponse } from "next/server";
import { config } from "@/config/env";
import { getSwarmConfig, decideProposal } from "@/app/api/learnings/utils";
import {
  resolveWorkspaceAccess,
  requireMemberAccess,
} from "@/lib/auth/workspace-access";
import { hasRoleLevel, WorkspaceRole } from "@/lib/auth/roles";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import {
  BULK_PROPOSAL_DECISION_CAP,
  BULK_PROPOSAL_FAILURE_MESSAGE,
  type BulkProposalDecisionCode,
  type BulkProposalDecisionResult,
} from "@/types/concept-proposals";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;
const SOFT_DEADLINE_MS = 270_000;
const BULK_REJECT_REASON = "Bulk rejected";
const RATE_LIMIT = 10;
const RATE_WINDOW_SECS = 60;

/**
 * POST /api/learnings/concepts/proposals/bulk?workspace=<slug>
 *
 * Accept or reject up to 25 proposals in one request. Decisions are applied
 * sequentially against the workspace's own proposal set; the response is
 * always 200 with a per-id result (never all-or-nothing).
 *
 * `decidedBy` is always set server-side. `force` is not settable here.
 * Bulk reject uses a fixed server-side reason — free-text reasons stay on
 * the single-proposal flow.
 */
export async function POST(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const workspaceSlug = searchParams.get("workspace");

    if (!workspaceSlug) {
      return NextResponse.json(
        { error: "Missing required parameter: workspace" },
        { status: 400 },
      );
    }

    const parsed = await parseBody(request);
    if (parsed instanceof NextResponse) return parsed;
    const { action, ids } = parsed;

    const access = await resolveWorkspaceAccess(request, { slug: workspaceSlug });
    const ok = requireMemberAccess(access);
    if (ok instanceof NextResponse) return ok;

    if (!hasRoleLevel(ok.role, WorkspaceRole.DEVELOPER)) {
      return NextResponse.json(
        { error: "Forbidden: DEVELOPER role or above required" },
        { status: 403 },
      );
    }

    const rl = await checkRateLimit(
      `${ok.userId}:${ok.workspaceId}:proposals-bulk`,
      RATE_LIMIT,
      RATE_WINDOW_SECS,
    );
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests", retryAfter: rl.retryAfter },
        { status: 429 },
      );
    }

    let base: string;
    let apiKey: string;

    if (config.USE_MOCKS) {
      base = `${config.MOCK_BASE}/api/mock/stakgraph`;
      apiKey = "mock";
    } else {
      const swarmConfig = await getSwarmConfig(ok.workspaceId);
      if ("error" in swarmConfig) {
        return NextResponse.json({ error: swarmConfig.error }, { status: swarmConfig.status });
      }
      base = swarmConfig.baseSwarmUrl;
      apiKey = swarmConfig.decryptedSwarmApiKey;
    }

    const ownedIds = await fetchOwnedProposalIds(base, apiKey);
    const results: BulkProposalDecisionResult[] = [];
    const startedAt = Date.now();
    let deadlineReached = false;

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];

      if (deadlineReached || Date.now() - startedAt >= SOFT_DEADLINE_MS) {
        deadlineReached = true;
        results.push(failure(id, "not_attempted"));
        continue;
      }

      if (!ownedIds || !ownedIds.has(id)) {
        const code: BulkProposalDecisionCode = ownedIds ? "not_found" : "upstream_error";
        results.push(failure(id, code));
        logIdFailure(id, action, undefined, code);
        continue;
      }

      try {
        const extraBody = action === "reject" ? { reason: BULK_REJECT_REASON } : undefined;
        const decided = await decideProposal({
          id,
          action,
          base,
          apiKey,
          decidedBy: ok.userId,
          extraBody,
        });
        const mapped = mapUpstreamResult(id, decided.status, decided.body);
        results.push(mapped);
        if (!mapped.ok) {
          logIdFailure(id, action, decided.status, mapped.code);
        }
      } catch {
        results.push(failure(id, "upstream_error"));
        logIdFailure(id, action, undefined, "upstream_error");
      }
    }

    const successCount = results.filter((r) => r.ok).length;
    logger.info("Proposal bulk decision completed", "proposals-bulk", {
      action,
      idCount: ids.length,
      successCount,
      failureCount: results.length - successCount,
      workspaceId: ok.workspaceId,
    });

    return NextResponse.json({ results });
  } catch {
    logger.error("Proposal bulk decision error", "proposals-bulk");
    return NextResponse.json({ error: "Failed to apply bulk proposal decision" }, { status: 500 });
  }
}

async function parseBody(
  request: NextRequest,
): Promise<{ action: "accept" | "reject"; ids: string[] } | NextResponse> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!raw || typeof raw !== "object") {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const record = raw as Record<string, unknown>;
  const action = record.action;
  const idsRaw = record.ids;

  if (action !== "accept" && action !== "reject") {
    return NextResponse.json(
      { error: 'action must be "accept" or "reject"' },
      { status: 400 },
    );
  }

  if (!Array.isArray(idsRaw) || idsRaw.length === 0) {
    return NextResponse.json(
      { error: "ids must be a non-empty array of proposal ids" },
      { status: 400 },
    );
  }

  for (const id of idsRaw) {
    if (typeof id !== "string" || !ID_PATTERN.test(id) || id.includes("..")) {
      return NextResponse.json(
        { error: "ids contains an invalid proposal id" },
        { status: 400 },
      );
    }
  }

  const ids = dedupe(idsRaw as string[]);

  if (ids.length > BULK_PROPOSAL_DECISION_CAP) {
    return NextResponse.json(
      { error: `ids exceeds the maximum of ${BULK_PROPOSAL_DECISION_CAP}` },
      { status: 400 },
    );
  }

  return { action, ids };
}

function dedupe(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

async function fetchOwnedProposalIds(
  base: string,
  apiKey: string,
): Promise<Set<string> | null> {
  try {
    const response = await fetch(`${base}/gitree/proposals`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-api-token": apiKey,
      },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || typeof body !== "object") {
      return null;
    }
    const proposals = (body as { proposals?: unknown }).proposals;
    if (!Array.isArray(proposals)) {
      return null;
    }
    const ids = new Set<string>();
    for (const proposal of proposals) {
      if (proposal && typeof proposal === "object" && typeof (proposal as { id?: unknown }).id === "string") {
        ids.add((proposal as { id: string }).id);
      }
    }
    return ids;
  } catch {
    return null;
  }
}

function mapUpstreamResult(
  id: string,
  status: number,
  body: unknown,
): BulkProposalDecisionResult {
  if (status >= 200 && status < 300) {
    const createdConceptId = readCreatedConceptId(body);
    return createdConceptId
      ? { id, ok: true, createdConceptId }
      : { id, ok: true };
  }

  if (status === 409) {
    const code = readBodyCode(body);
    if (code === "stale_base") {
      return failure(id, "stale_base");
    }
    return failure(id, "already_decided");
  }

  if (status === 404) {
    return failure(id, "not_found");
  }

  return failure(id, "upstream_error");
}

function readBodyCode(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const code = (body as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function readCreatedConceptId(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const proposal = (body as { proposal?: unknown }).proposal;
  if (!proposal || typeof proposal !== "object") return undefined;
  const createdConceptId = (proposal as { createdConceptId?: unknown }).createdConceptId;
  return typeof createdConceptId === "string" && createdConceptId.length > 0
    ? createdConceptId
    : undefined;
}

function failure(
  id: string,
  code: BulkProposalDecisionCode,
): BulkProposalDecisionResult {
  return {
    id,
    ok: false,
    code,
    message: BULK_PROPOSAL_FAILURE_MESSAGE[code],
  };
}

function logIdFailure(
  id: string,
  action: "accept" | "reject",
  upstreamStatus: number | undefined,
  code: BulkProposalDecisionCode | undefined,
) {
  logger.error("Proposal bulk decision failed for id", "proposals-bulk", {
    id,
    action,
    upstreamStatus,
    code,
  });
}
