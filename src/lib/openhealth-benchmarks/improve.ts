/**
 * A `StrutRun` row of kind `openhealth_improve` → what the run viewer shows.
 * Pure.
 *
 * Like `runs.ts`, this reads the workflow's `output` field by field, so an
 * output of another shape degrades to nulls and empty lists. The run's
 * files (`digest.md` holds the answer key) are not named in what it returns.
 *
 * Besides Concepts, an improve run may CONTEST answer-key items the chart
 * contradicts (`contests.ts`): the ones the graph recorded are excluded from
 * the score from the next run on.
 */

import type { StrutRunStatus } from "@prisma/client";
import { contestsOf, rejectedContestsOf } from "./contests";
import type {
  OpenHealthConceptProposal,
  OpenHealthConceptWrite,
  OpenHealthImprovement,
  OpenHealthOutcome,
} from "@/types/openhealth";

export interface OpenHealthImproveSource {
  id: string;
  strutRunId: string | null;
  status: StrutRunStatus;
  output: unknown;
  error: string | null;
  durationMs: number | null;
  createdAt: Date;
  settledAt: Date | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);
const records = (value: unknown): Array<Record<string, unknown>> =>
  Array.isArray(value) ? value.filter(isRecord) : [];
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v !== "") : [];

const ERROR_KINDS: Record<string, string> = {
  // Diagnosis: the code is an ICD-10-CM code.
  missed: "missed",
  extra: "extra",
  code: "wrong code",
  acuity: "wrong acuity",
  // Summary: the code is a finding's name as a slug (`uterine-artery-doppler…`), or the specialty's.
  missed_finding: "missed finding",
  leaked: "leaked",
  abstain: "did not abstain for",
};

const SLUG_KINDS = new Set(["missed_finding", "leaked", "abstain"]);

/** `<run id>:<kind>:<code>` → "missed P011", "missed finding severe headache". An id of another form is shown as it is. */
export function describeScoringError(id: string): string {
  const [, kind, code, ...rest] = id.split(":");
  if (!kind || !code || rest.length > 0 || !ERROR_KINDS[kind]) return id;
  return `${ERROR_KINDS[kind]} ${SLUG_KINDS.has(kind) ? code.replace(/-/g, " ") : code}`;
}

/**
 * What the graph answered for one new Concept. The write step answers an
 * object on success and a plain string when it failed, without failing the run.
 */
function writeOf(answer: unknown): Pick<OpenHealthConceptProposal, "write" | "writeError"> {
  if (typeof answer === "string") return { write: "failed", writeError: answer };
  if (!isRecord(answer)) return { write: null, writeError: null };
  const written: OpenHealthConceptWrite | null =
    answer.status === "Success" ? "created" : answer.status === "Warning" ? "existed" : null;
  return { write: written, writeError: null };
}

function proposalsOf(output: Record<string, unknown>): OpenHealthConceptProposal[] {
  // The writes are in the order of the new Concepts among the proposals.
  const writes = Array.isArray(output.created) ? output.created : [];
  let created = 0;
  return records(output.proposals).flatMap((p): OpenHealthConceptProposal[] => {
    const write = p.action === "create" ? writeOf(writes[created++]) : { write: null, writeError: null };
    const name = str(p.name);
    if (!name || (p.action !== "create" && p.action !== "amend")) return [];
    return [
      {
        action: p.action,
        name,
        parent: p.action === "create" ? str(p.parent) : null,
        description: str(p.description),
        docs: str(p.docs),
        rationale: str(p.rationale),
        addresses: strings(p.addresses).map(describeScoringError),
        ...write,
      },
    ];
  });
}

function errorCountOf(output: Record<string, unknown>): number | null {
  if (!Array.isArray(output.runs)) return null;
  return records(output.runs).reduce((sum, run) => sum + (Array.isArray(run.errors) ? run.errors.length : 0), 0);
}

export function improveOutcomeOf(status: StrutRunStatus): OpenHealthOutcome {
  if (status === "PENDING") return "running";
  if (status === "CANCELLED") return "cancelled";
  return status === "SUCCESS" ? "succeeded" : "failed";
}

export function toOpenHealthImprovement(row: OpenHealthImproveSource): OpenHealthImprovement {
  const output = isRecord(row.output) ? row.output : {};
  const outcome = improveOutcomeOf(row.status);
  return {
    id: row.id,
    strutRunId: row.strutRunId,
    outcome,
    applied: output.applied === true,
    summary: str(output.summary),
    errorCount: errorCountOf(output),
    proposals: proposalsOf(output),
    rejected: records(output.rejected).flatMap((p) => {
      const name = str(p.name);
      return name ? [{ name, reasons: strings(p.rejected_because) }] : [];
    }),
    notAddressed: records(output.not_addressed).flatMap((e) => {
      const id = str(e.error_id);
      return id ? [{ error: describeScoringError(id), reason: str(e.reason) ?? "" }] : [];
    }),
    contestsAccepted: contestsOf(output.contests_accepted),
    contestsRejected: rejectedContestsOf(output.contests_rejected),
    durationMs: row.durationMs,
    error: outcome === "failed" ? (row.error ?? "The run did not finish.") : null,
    createdAt: row.createdAt.toISOString(),
    settledAt: row.settledAt?.toISOString() ?? null,
  };
}
