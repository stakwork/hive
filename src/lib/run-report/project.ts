/**
 * Bundle → persisted projection.
 *
 * Pipeline order: loose parse → schema_version gate → sanitize → redact →
 * strict projection → size check.
 *
 * Parsing is loose (unknown upstream keys do not fail the bundle) but the
 * PERSISTED object is built from an explicit known-field projection that drops
 * them. An undocumented field could carry HTML or credential-shaped text that
 * would otherwise bypass the sanitizer entirely.
 */

import { z } from "zod";
import { sanitizeDocumentHtml } from "./sanitize";
import { redactSensitiveKeys } from "./redact";
import {
  toEpochMs,
  groupRubrics,
  computeStats,
  isRecord,
  asString,
  readArray,
} from "./derive";
import {
  SUPPORTED_SCHEMA_VERSION,
  type RunReportProjection,
  type ProjectedSourceDoc,
  type ProjectedRubricLink,
  type ContractNotes,
} from "./types";

/** Cap on the SERIALIZED projection — the raw byte cap does not bound this. */
export const MAX_PROJECTION_BYTES = 6 * 1024 * 1024;

/** Top-level keys the projector knows about. Anything else is "unexpected". */
const KNOWN_TOP_LEVEL = [
  "schema_version",
  "page_data",
  "analysis",
  "concepts",
  "source_docs",
  "workfiles",
  "rubric_links",
  "generated_at",
];

export type ProjectOutcome =
  | { status: "ok"; projection: RunReportProjection; droppedElements: number }
  | { status: "unsupported_schema"; version: number }
  | { status: "unparseable" };

/** Loose top-level shape — everything optional, unknown keys preserved. */
const BundleSchema = z.looseObject({
  schema_version: z.number().optional(),
});

export function projectBundle(rawText: string): ProjectOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { status: "unparseable" };
  }

  const loose = BundleSchema.safeParse(parsed);
  if (!loose.success || !isRecord(parsed)) return { status: "unparseable" };

  // ── Schema version gate ────────────────────────────────────────────────────
  // The generator ships SCHEMA_VERSION = 1 and asks consumers to stay
  // backward-compatible, so a bump must be a HANDLED incompatibility rather
  // than a silently empty page.
  const version = typeof parsed.schema_version === "number" ? parsed.schema_version : 1;
  if (version !== SUPPORTED_SCHEMA_VERSION) {
    return { status: "unsupported_schema", version };
  }

  const contractNotes = describeContract(parsed);

  // ── page_data ──────────────────────────────────────────────────────────────
  // set_var / log_stats / outputs are config+trace surfaces, so they get the
  // scoped token-shape pass. security / health_notes / branches do not carry
  // free-form secrets and are key-redacted only.
  const pageDataRaw = isRecord(parsed.page_data) ? parsed.page_data : {};
  const pageData = {
    setVar: redactRecord(pageDataRaw.set_var, true),
    security: redactRecord(pageDataRaw.security, false),
    branches: redactArray(readArray(pageDataRaw, "branches"), false),
    healthNotes: redactArray(readArray(pageDataRaw, "health_notes"), false),
    logStats: redactRecord(pageDataRaw.log_stats, true),
    outputs: redactRecord(pageDataRaw.outputs, true),
  };

  // ── analysis ───────────────────────────────────────────────────────────────
  // traces are per-agent transcripts: the deepest, most secret-dense part of
  // the bundle, so they get the token-shape pass too.
  const analysisRaw = isRecord(parsed.analysis) ? parsed.analysis : {};
  const analysis = {
    summaries: redactArray(readArray(analysisRaw, "summaries"), false),
    traces: redactArray(readArray(analysisRaw, "traces"), true),
  };

  // ── concepts ───────────────────────────────────────────────────────────────
  // `{}` is the generator default (the concepts pass is opt-in behind
  // --concepts) and is the COMMON shape. It means "not run", never an error.
  const concepts = redactRecord(parsed.concepts, false);

  // ── source_docs ────────────────────────────────────────────────────────────
  // The only HTML-bearing field. Sanitized here, once, server-side.
  // Deliberately NOT passed through the token-shape pass: a blanket
  // high-entropy match over converted legal documents would corrupt docket
  // numbers, registration ids and base64 exhibits.
  let droppedElements = 0;
  const sourceDocs: ProjectedSourceDoc[] = [];
  for (const entry of readArray(parsed, "source_docs")) {
    if (!isRecord(entry)) continue;
    const id = asString(entry.id) ?? "";
    if (!id) continue;
    const { nodes, droppedCount } = sanitizeDocumentHtml(asString(entry.html) ?? "");
    droppedElements += droppedCount;
    sourceDocs.push({ id, title: asString(entry.title) ?? id, body: nodes });
  }

  // ── workfiles ──────────────────────────────────────────────────────────────
  // Plain text, rendered as escaped React text. Also excluded from the
  // token-shape pass for the same reason as source documents.
  const workfiles = readArray(parsed, "workfiles")
    .filter(isRecord)
    .map((entry) => ({
      name: asString(entry.name) ?? asString(entry.path),
      text: asString(entry.text) ?? "",
    }));

  // ── rubric_links ───────────────────────────────────────────────────────────
  // Sole data source for the failure → source-document deep link.
  const rubricLinks: Record<string, ProjectedRubricLink[]> = {};
  if (isRecord(parsed.rubric_links)) {
    for (const [rubricId, value] of Object.entries(parsed.rubric_links)) {
      if (!Array.isArray(value)) continue;
      const links: ProjectedRubricLink[] = [];
      for (const link of value) {
        if (!isRecord(link)) continue;
        const doc = asString(link.doc);
        if (!doc) continue;
        const tokens = Array.isArray(link.tokens)
          ? link.tokens.filter((t): t is string => typeof t === "string")
          : [];
        links.push({ doc, tokens });
      }
      if (links.length > 0) rubricLinks[rubricId] = links;
    }
  }

  const rubricRows = groupRubrics(analysisRaw);

  const projection: RunReportProjection = {
    schemaVersion: version,
    generatedAtMs: toEpochMs(parsed.generated_at ?? pageDataRaw.generated_at),
    pageData,
    analysis,
    concepts,
    sourceDocs,
    workfiles,
    rubricLinks,
    stats: computeStats({
      sourceDocs,
      workfiles,
      traces: analysis.traces,
      branches: pageData.branches,
      rubricRows,
    }),
    contractNotes,
    partial: false,
  };

  // ── Size check ─────────────────────────────────────────────────────────────
  // The raw-stream byte cap does not bound what is stored: the projection is
  // several times larger than the source HTML. On overflow, drop document
  // bodies (keeping ids and titles) and flag the report as partial, rather
  // than dropping the report entirely.
  if (serializedSize(projection) > MAX_PROJECTION_BYTES) {
    projection.sourceDocs = projection.sourceDocs.map(({ id, title }) => ({ id, title }));
    projection.partial = true;
  }

  return { status: "ok", projection, droppedElements };
}

function serializedSize(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value) ?? "", "utf8");
  } catch {
    // Cyclic or unserializable — treat as over-cap so it degrades to partial.
    return Number.MAX_SAFE_INTEGER;
  }
}

function redactRecord(value: unknown, tokenShapes: boolean): Record<string, unknown> {
  if (!isRecord(value)) return {};
  return redactSensitiveKeys(value, { tokenShapes }) as Record<string, unknown>;
}

function redactArray(value: unknown[], tokenShapes: boolean): unknown[] {
  return redactSensitiveKeys(value, { tokenShapes }) as unknown[];
}

/**
 * Distinguish *absent* from *present-and-empty* per top-level key, and collect
 * unexpected keys. Present-and-empty is normal and silent; absent alongside an
 * unexpected sibling is what raises the drift banner in the UI.
 */
function describeContract(bundle: Record<string, unknown>): ContractNotes {
  const absent: string[] = [];
  const presentButEmpty: string[] = [];

  for (const key of ["page_data", "analysis", "concepts", "source_docs", "workfiles", "rubric_links"]) {
    if (!(key in bundle)) {
      absent.push(key);
      continue;
    }
    const value = bundle[key];
    const empty = Array.isArray(value)
      ? value.length === 0
      : isRecord(value) && Object.keys(value).length === 0;
    if (empty) presentButEmpty.push(key);
  }

  const unexpected = Object.keys(bundle).filter((k) => !KNOWN_TOP_LEVEL.includes(k));

  return { absent, presentButEmpty, unexpected };
}
