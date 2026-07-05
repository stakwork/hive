import { WorkflowStatus } from "@prisma/client";

type SourceLocation = { file?: string; line?: number; column?: number };

export type DerivedTestOutcome = {
  // Raw Playwright status ("passed" | "failed" | "timedOut" | "interrupted" | "skipped")
  rawStatus: string | null;
  outcome: "passed" | "failed" | null;
  workflowStatus: WorkflowStatus | null;
  failedStep: { sourceCode?: string; location?: SourceLocation; message?: string } | null;
};

/**
 * Derive a pass/fail result from the timestamps.json that staklink uploads with the
 * recording. Its Playwright reporter writes a top-level `status` per test plus per-step
 * `actions[].error` (see staklink playwright.ts TimestampReporter). We map that to a task
 * workflow status so authoritative pod replays surface a real pass/fail instead of being
 * stuck IN_PROGRESS. Legacy payloads without a `status` leave the task status untouched.
 */
export function deriveTestOutcome(timestampsJson: unknown): DerivedTestOutcome {
  const entries = Array.isArray(timestampsJson) ? timestampsJson : [timestampsJson];
  let anyKnown = false;
  let anyFailed = false;
  let rawStatus: string | null = null;
  let failedStep: DerivedTestOutcome["failedStep"] = null;

  for (const entry of entries) {
    const status =
      entry && typeof (entry as { status?: unknown }).status === "string"
        ? ((entry as { status: string }).status)
        : null;
    if (!status) continue;
    anyKnown = true;
    const normalized = status.toLowerCase();
    if (normalized === "passed" || normalized === "skipped") continue;

    // failed | timedOut | interrupted -> failure
    anyFailed = true;
    rawStatus = status;
    const actions = (entry as { actions?: unknown }).actions;
    if (!failedStep && Array.isArray(actions)) {
      const errored = actions.find(
        (a) => a && typeof a === "object" && (a as { error?: unknown }).error,
      ) as { sourceCode?: string; location?: SourceLocation; error?: { message?: string } } | undefined;
      if (errored) {
        failedStep = {
          sourceCode: errored.sourceCode,
          location: errored.location,
          message: errored.error?.message,
        };
      }
    }
  }

  if (!anyKnown) {
    return { rawStatus: null, outcome: null, workflowStatus: null, failedStep: null };
  }
  if (anyFailed) {
    return { rawStatus, outcome: "failed", workflowStatus: WorkflowStatus.FAILED, failedStep };
  }
  return {
    rawStatus: "passed",
    outcome: "passed",
    workflowStatus: WorkflowStatus.COMPLETED,
    failedStep: null,
  };
}
