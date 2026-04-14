/**
 * Default prompts for the Scorer analysis system.
 * Workspaces can override these via scorerPatternPrompt / scorerSinglePrompt fields.
 */

export const DEFAULT_SINGLE_SESSION_PROMPT = `You are analyzing a single agent coding session from our AI development platform.
The session shows the full journey: the human's request, the plan agent's exploration,
and each coding agent's execution through to the PR.

Identify specific issues in this session:
- Where did the agent waste time or go in the wrong direction?
- Did the agent misunderstand the human's intent? What words or concepts caused confusion?
- Were there files or modules the agent should have found faster?
- What could we change in our prompts, context, or tooling to improve this specific case?

Be specific — reference exact tool calls, search queries, and file paths from the transcript.

Return your findings as a JSON array. Each element must have these fields:
- "severity": "HIGH" | "MEDIUM" | "LOW"
- "pattern": short label (under 80 chars)
- "description": full explanation
- "featureIds": array of feature IDs mentioned (use the ones from the session)
- "suggestion": what to change

Return ONLY the JSON array, no markdown fences or commentary.

{session}`;

export const DEFAULT_PATTERN_DETECTION_PROMPT = `You are reviewing {N} recent agent coding sessions from our AI development platform.
Each session shows a task given to a coding agent, what context it received,
how the conversation went, and the outcome.

Your job: identify the highest-priority issues we should address to improve
agent performance. Focus on patterns that appear across multiple sessions.
Rank by impact.

For each issue, explain:
- What the pattern is
- Which sessions exhibit it
- What the root cause likely is
- What we could change (in prompts, context, tooling, or documentation)

Return your findings as a JSON array. Each element must have these fields:
- "severity": "HIGH" | "MEDIUM" | "LOW"
- "pattern": short label (under 80 chars)
- "description": full explanation
- "featureIds": array of feature IDs that exhibit this pattern
- "suggestion": what to change

Return ONLY the JSON array, no markdown fences or commentary.

{digests}`;

export const DIGEST_COMPRESSION_PROMPT = `Compress this full agent session into a concise digest (50-100 lines).

Preserve:
- Feature title, workspace, plan accuracy metrics
- Per-task: title, status, message count, correction count, duration, files planned vs touched
- Key moments: direction changes, user corrections, agent getting stuck, pivots
- PR URLs and outcomes, CI results

Drop:
- Individual tool call inputs (collapse to summaries: "searched N files, read N, edited N")
- Routine agent reasoning ("I'll do X next")
- Full plan context (keep only brief + file list)

Output format:
Feature: {title} | Workspace: {workspace}
Plan accuracy: precision {X}%, recall {Y}%

Task 1: {title} [{status}]
  Messages: {N} | Corrections: {N} | Duration: {X}min
  Files planned: [list] | Files touched: [list]
  Key moments:
    - {moment}
  PR: {url} — {merged/cancelled} | CI: {pass/fail first attempt}

Task 2: ...

{session}`;

/**
 * Resolve the prompt for a given workspace, falling back to defaults.
 */
export function resolvePrompt(
  mode: "single" | "pattern",
  workspacePrompt: string | null | undefined
): string {
  if (workspacePrompt) return workspacePrompt;
  return mode === "single"
    ? DEFAULT_SINGLE_SESSION_PROMPT
    : DEFAULT_PATTERN_DETECTION_PROMPT;
}
