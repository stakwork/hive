/** LongMemory benchmark wire types. Never carries an answer key — only the model's `hypothesis`. */

export interface LongMemoryQuestion {
  id: string;
  type: string;
  abstention: boolean;
}

export interface LongMemoryTaskList {
  total: number;
  tasks: LongMemoryQuestion[];
}

export interface LongMemoryMiss {
  question_id: string;
  questionType?: string;
  missCause?: string;
}

export interface LongMemoryTypeAccuracy {
  n?: number;
  accuracy?: number;
}

export interface LongMemoryRunResult {
  /** "single" for `longmemory-run`, "batch" for `longmemory-batch`. */
  mode: "single" | "batch";
  workflow: string;
  strutRunId?: string;
  errorMessage?: string;
  // single
  question_id?: string;
  questionType?: string;
  abstention?: boolean;
  /** 0 | 1 */
  score?: number;
  metric?: string;
  officialScore?: number;
  summary?: string;
  judgeModel?: string;
  missCause?: string;
  /** The model's answer. */
  hypothesis?: string;
  // batch
  limit?: number;
  n?: number;
  accuracy?: number;
  byType?: Record<string, LongMemoryTypeAccuracy>;
  abstentionAccuracy?: number;
  misses?: LongMemoryMiss[];
  totalCost?: number;
}

export interface LongMemoryRunWireRow {
  id: string;
  workspaceId: string;
  status: string;
  /** JSON string of a `LongMemoryRunResult`. */
  result: string;
  hasReport: boolean;
  createdAt: string;
  updatedAt: string;
}

export function parseLongMemoryRunResult(result: string | null | undefined): LongMemoryRunResult | null {
  if (!result) return null;
  try {
    const v = JSON.parse(result);
    return v && typeof v === "object" ? (v as LongMemoryRunResult) : null;
  } catch {
    return null;
  }
}
