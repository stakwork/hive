import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { decodeWebhookToken, verifyWebhookToken } from "@/lib/auth/agent-jwt";
import {
  completeClaimFromResult,
  markClaimRunFailed,
  parseCreatePrClaim,
} from "@/lib/proposals/codeChangeCompletion";
import { logger } from "@/lib/logger";

/**
 * Terminal-result webhook for async code-change (`create_pr`) runs.
 *
 * The swarm (`postTerminalWebhook`) POSTs here when a dispatched run reaches
 * a terminal state:
 *
 *   { request_id, status: "completed", result }            — run finished
 *   { request_id, status: "failed", error, retryable }     — run died
 *
 * `result` is the same envelope `/progress` serves; on `create_pr` runs
 * `result.pr` is always present (success, failure, or the
 * `create_pr_not_called` sentinel). Delivery retries up to 3 times and the
 * swarm's boot-time orphan sweep can fire long after dispatch.
 *
 * ## Auth
 *
 * The swarm sends NO custom headers, so the credential rides the URL: a JWT
 * over `{ taskId }` signed with a per-claim secret generated at approval
 * time and stored encrypted on the claim Task
 * (`Task.codeChangeWebhookSecret`). Mirrors `/api/agent/webhook`.
 *
 * ## Idempotency
 *
 * `completeClaimFromResult` no-ops when the claim already carries a
 * PULL_REQUEST artifact, and the transcript patch is a pure overwrite with
 * identical terminal data — a re-delivered webhook changes nothing.
 */
export async function POST(request: NextRequest) {
  // 1. Token from query (never logged — treat the full URL as secret).
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  // 2. Unverified decode to locate the claim Task's secret.
  const decoded = decodeWebhookToken(token);
  if (!decoded) {
    return NextResponse.json({ error: "Invalid token format" }, { status: 400 });
  }
  const { taskId } = decoded;

  // 3. Load the claim Task.
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      deleted: true,
      codeChangeWebhookSecret: true,
      codeChangeClaim: true,
    },
  });
  if (!task || task.deleted || !task.codeChangeWebhookSecret) {
    // Includes the claim-already-deleted case (a classified failure was
    // processed on an earlier delivery). 404 — the swarm stops retrying
    // only on 2xx, but there is nothing further to do here either way.
    logger.info(
      "[code-change-webhook] No claim task for delivery",
      "code-change-webhook",
      { taskId, hasTask: !!task },
    );
    return NextResponse.json({ error: "Claim not found" }, { status: 404 });
  }

  // 4. Decrypt the per-claim secret and verify the token.
  let webhookSecret: string;
  try {
    webhookSecret = EncryptionService.getInstance().decryptField(
      "codeChangeWebhookSecret",
      task.codeChangeWebhookSecret,
    );
  } catch (error) {
    logger.error(
      "[code-change-webhook] Failed to decrypt webhook secret",
      "code-change-webhook",
      { taskId, error: String(error) },
    );
    return NextResponse.json({ error: "Secret unavailable" }, { status: 500 });
  }

  const verified = await verifyWebhookToken(token, webhookSecret);
  if (!verified || verified.taskId !== taskId) {
    logger.warn(
      "[code-change-webhook] Token verification failed",
      "code-change-webhook",
      { taskId },
    );
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // 5. Parse and bind the payload to the dispatch receipt.
  let body: {
    request_id?: string;
    status?: string;
    result?: unknown;
    error?: string;
    retryable?: boolean;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const claim = parseCreatePrClaim(task.codeChangeClaim);
  if (!claim) {
    // Dispatch receipt never landed (onDispatch failed) or is corrupt —
    // nothing to bind the payload to. The reconcile path cannot help
    // without a requestId either; surface loudly.
    logger.error(
      "[code-change-webhook] Claim task has no parseable receipt",
      "code-change-webhook",
      { taskId },
    );
    return NextResponse.json({ error: "No dispatch receipt" }, { status: 409 });
  }

  if (body.request_id !== claim.requestId) {
    logger.warn(
      "[code-change-webhook] request_id mismatch — dropping delivery",
      "code-change-webhook",
      { taskId, got: body.request_id, expected: claim.requestId },
    );
    return NextResponse.json({ error: "request_id mismatch" }, { status: 400 });
  }

  // 6. Process by status.
  try {
    if (body.status === "completed") {
      const outcome = await completeClaimFromResult({
        taskId,
        claim,
        rawResult: body.result,
      });
      logger.info(
        "[code-change-webhook] Completed delivery processed",
        "code-change-webhook",
        { taskId, requestId: claim.requestId, outcome: outcome.outcome },
      );
      return NextResponse.json({ success: true, outcome: outcome.outcome });
    }

    if (body.status === "failed") {
      // No result envelope exists. Keep the claim (no auto-redispatch —
      // the reconcile cron keeps checking whether a PR landed) and patch
      // the stored card with an honest message.
      await markClaimRunFailed({
        taskId,
        claim,
        retryable: body.retryable === true,
      });
      return NextResponse.json({ success: true, outcome: "run-failed" });
    }

    return NextResponse.json({ error: "Unknown status" }, { status: 400 });
  } catch (error) {
    // 500 → the swarm retries the delivery; every handler above is
    // idempotent, so a replay is safe.
    logger.error(
      "[code-change-webhook] Processing error",
      "code-change-webhook",
      { taskId, error: String(error) },
    );
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }
}
