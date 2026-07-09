/**
 * Minimal unified line diff — the "show ONLY the part that changed" util.
 *
 * Given a `before` and `after` string, produces the changed regions (hunks)
 * with a few lines of surrounding context, collapsing long unchanged runs
 * into a gap marker. This is what lets a proposal card / modal show just the
 * edited slice of a large prompt instead of the whole before + whole after.
 *
 * Pure and dependency-free (LCS over lines), so it's safe to import into
 * client components. Inputs are prompt-sized (hundreds of lines at most).
 */

export type DiffRowType = "context" | "add" | "del";

export interface DiffRow {
  type: DiffRowType;
  text: string;
  /** 1-based line number in the `before` doc (undefined for pure additions). */
  oldLine?: number;
  /** 1-based line number in the `after` doc (undefined for pure deletions). */
  newLine?: number;
}

export interface DiffHunk {
  /** Rows in this contiguous changed region (incl. leading/trailing context). */
  rows: DiffRow[];
  /** Number of collapsed unchanged lines immediately BEFORE this hunk. */
  gapBefore: number;
}

export interface UnifiedDiff {
  hunks: DiffHunk[];
  added: number;
  removed: number;
  /** True when before === after (no changes to show). */
  unchanged: boolean;
}

type Op = { type: DiffRowType; text: string; oldLine?: number; newLine?: number };

/**
 * LCS-based line diff. Returns an ordered op list (context / del / add).
 * O(n·m) DP — fine for prompt-sized inputs.
 */
function diffLines(beforeLines: string[], afterLines: string[]): Op[] {
  const n = beforeLines.length;
  const m = afterLines.length;

  // dp[i][j] = LCS length of beforeLines[i:] and afterLines[j:]
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        beforeLines[i] === afterLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (beforeLines[i] === afterLines[j]) {
      ops.push({ type: "context", text: beforeLines[i], oldLine: i + 1, newLine: j + 1 });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "del", text: beforeLines[i], oldLine: i + 1 });
      i++;
    } else {
      ops.push({ type: "add", text: afterLines[j], newLine: j + 1 });
      j++;
    }
  }
  while (i < n) ops.push({ type: "del", text: beforeLines[i], oldLine: ++i });
  while (j < m) ops.push({ type: "add", text: afterLines[j], newLine: ++j });
  return ops;
}

/**
 * Build a unified diff with `context` lines around each change, collapsing
 * unchanged runs longer than `2 * context` into a gap.
 */
export function computeUnifiedDiff(
  before: string,
  after: string,
  context = 3,
): UnifiedDiff {
  if (before === after) {
    return { hunks: [], added: 0, removed: 0, unchanged: true };
  }

  const ops = diffLines(before.split("\n"), after.split("\n"));

  const added = ops.filter((o) => o.type === "add").length;
  const removed = ops.filter((o) => o.type === "del").length;

  // Mark which context ops to keep (within `context` of any change).
  const keep = new Array<boolean>(ops.length).fill(false);
  ops.forEach((op, idx) => {
    if (op.type !== "context") {
      for (let k = idx - context; k <= idx + context; k++) {
        if (k >= 0 && k < ops.length) keep[k] = true;
      }
    }
  });

  // Group kept ops into hunks; count dropped (collapsed) context lines
  // that precede each hunk.
  const hunks: DiffHunk[] = [];
  let current: DiffRow[] | null = null;
  let gap = 0;
  for (let idx = 0; idx < ops.length; idx++) {
    if (keep[idx]) {
      if (!current) {
        current = [];
        hunks.push({ rows: current, gapBefore: gap });
        gap = 0;
      }
      const op = ops[idx];
      current.push({ type: op.type, text: op.text, oldLine: op.oldLine, newLine: op.newLine });
    } else {
      // Dropped line — only unchanged (context) lines are ever dropped.
      current = null;
      gap++;
    }
  }

  return { hunks, added, removed, unchanged: false };
}
