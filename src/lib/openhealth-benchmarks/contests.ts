/**
 * Contested gold, as the OpenHealth workflows report it. Pure.
 *
 * Since `openhealth-run` v12 a run's score is ADJUSTED: answer-key items an
 * improve run contested — the chart contradicts them, with verbatim quotes
 * the workflow checked — are excluded, and the untouched score is reported
 * beside it as `scoreOfficial`. The three workflows name the contested items
 * in three shapes, read here:
 *
 *   run        `contested: [{ id, ref_id, list, name, icd10, reason, evidence: string[] }]`
 *              `contestsNotAccepted: [{ id, ref_id, name, description }]`
 *   loop       history entries carry `contested` and `contestsAccepted` as
 *              NAMES, `contestsRejected` as `[{ error_id, why }]`
 *   improve    `contests_accepted` (as the run's items), `contests_rejected`
 *              as `[{ error_id, why }]`
 *
 * Everything reads field by field, so another shape degrades to less.
 */

import type { OpenHealthContest, OpenHealthContestRejected } from "@/types/openhealth";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const str = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

/** A quote as the run reports it (`chart.md: "…"`), or as the improve run proposed it (`{ source, quote }`). */
function evidenceOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (typeof raw === "string") return raw.trim() ? [raw] : [];
    if (!isRecord(raw)) return [];
    const quote = str(raw.quote);
    if (!quote) return [];
    const source = str(raw.source);
    return [source ? `${source}: "${quote}"` : quote];
  });
}

/** The contested items a list names, in full. A bare name (the loop's history) is an item with nothing else. */
export function contestsOf(value: unknown): OpenHealthContest[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): OpenHealthContest[] => {
    if (typeof raw === "string") {
      return raw.trim()
        ? [{ id: null, refId: null, name: raw, list: null, icd10: null, reason: null, evidence: [] }]
        : [];
    }
    if (!isRecord(raw)) return [];
    const name = str(raw.name) ?? str(raw.display_name);
    if (!name) return [];
    return [
      {
        id: str(raw.id),
        refId: str(raw.ref_id),
        name,
        list: str(raw.list),
        icd10: str(raw.icd10),
        reason: str(raw.reason) ?? str(raw.description),
        evidence: evidenceOf(raw.evidence),
      },
    ];
  });
}

/** The contested items a list names, by name only. */
export function contestNames(value: unknown): string[] {
  return contestsOf(value).map((c) => c.name);
}

/** Contests the workflow refused: the error they were raised for and why. */
export function rejectedContestsOf(value: unknown): OpenHealthContestRejected[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw): OpenHealthContestRejected[] => {
    if (!isRecord(raw)) return [];
    const error = str(raw.error_id) ?? str(raw.name);
    if (!error) return [];
    return [{ error, reason: str(raw.why) ?? str(raw.reason) ?? str(raw.description) }];
  });
}
