import type { ErrorIssueRecord, ErrorEventRecord } from "@/types/error-issues";
import type { StructuredFrame, ParsedBlob } from "@/lib/utils/error-frames";

/**
 * Builds the initial plan-chat seed message for "Fix in Plan Mode".
 * All fields are optional-safe: missing values are omitted gracefully.
 */
export function buildErrorPlanSeedMessage(
  issue: ErrorIssueRecord,
  latestEvent: ErrorEventRecord | undefined,
  parsedBlob?: ParsedBlob,
): string {
  const lines: string[] = [];

  lines.push(
    "Investigate the root cause of this production error and propose a fix.\n",
  );

  // Exception type
  if (issue.exceptionType) {
    lines.push(`**Exception Type:** \`${issue.exceptionType}\``);
  }

  // Message (from latest event)
  if (latestEvent?.message) {
    lines.push(`**Message:** ${latestEvent.message}`);
  }

  // Environment / Release
  const env = latestEvent?.environment ?? issue.environment;
  const release = latestEvent?.release ?? issue.release;
  if (env) lines.push(`**Environment:** ${env}`);
  if (release) lines.push(`**Release:** \`${release}\``);

  // Commit SHA
  if (latestEvent?.commitSha) {
    lines.push(`**Commit:** \`${latestEvent.commitSha}\``);
  }

  // Repository URL
  if (latestEvent?.repositoryUrl) {
    lines.push(`**Repository:** ${latestEvent.repositoryUrl}`);
  } else if (issue.repoKey) {
    lines.push(`**Repository:** ${issue.repoKey}`);
  }

  // Stack trace / structured frames from blob
  if (parsedBlob) {
    const { stackTrace, frames } = parsedBlob;

    if (frames.length > 0) {
      lines.push("\n**Stack Frames:**");
      lines.push("```");
      for (const frame of frames) {
        const parts = [frame.filename];
        if (frame.lineno != null) parts.push(`:${frame.lineno}`);
        if (frame.function) parts.push(` in ${frame.function}`);
        lines.push(parts.join(""));
      }
      lines.push("```");
    } else if (stackTrace) {
      lines.push("\n**Stack Trace:**");
      lines.push("```");
      lines.push(stackTrace);
      lines.push("```");
    }
  }

  return lines.join("\n");
}
