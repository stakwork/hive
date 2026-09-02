/**
 * The shape the exported document embeds as `window.__CASCADE_EXPORT__`.
 *
 * Types only, and imported by both sides of the file:// boundary — the
 * server assembler (assemble.ts) writes it, the browser entry
 * (offline.entry.tsx) reads it. Keep this module free of value imports so
 * the browser bundle never reaches server code through it.
 */

import type { RunCascadeModel } from "../types";
import type { NodePeek } from "@/components/run-report/NodePeek";

export interface CascadeExportMeta {
  runId: string;
  /** The identifier that matched the run's sessions (projectId or run id). */
  identifier: string | null;
  exportedAt: string;
  /** Concept ref_ids the peek phase could not capture (cap, timeout, error). */
  skippedPeeks: string[];
}

export interface CascadeExportPayload {
  model: RunCascadeModel;
  /** Keyed by ref_id — a plain object so it survives JSON. */
  peeks: Record<string, NodePeek>;
  meta: CascadeExportMeta;
}
