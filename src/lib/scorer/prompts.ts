/**
 * Default prompts for the Scorer analysis system.
 * Workspaces can override these via scorerPatternPrompt / scorerSinglePrompt fields.
 */

export const DEFAULT_SINGLE_SESSION_PROMPT = `You are analyzing a single agent coding session from our AI development platform.
The session shows the full journey from human request through planning, task generation,
coding, building, testing, and PR creation.

## Agent types in the transcript

Our system uses multiple specialized agents, each labeled in the transcript:

- **plan-agent-{featureId}** — Explores the codebase and produces the implementation plan
  (brief, architecture, user stories), then generates actionable dev tickets from that plan.
  May re-explore the codebase to verify claims and get exact signatures/interfaces.
  Runs first. Has access to search and read tools.
- **coding-agent-{taskId}** — Implements the code changes for a single task. Has shell, edit,
  and file tools. Produces a PR.
- **build-agent-{taskId}** — Runs the project build and fixes any build errors.
- **test-agent-{taskId}** — Determines which tests to run, runs them, and fixes failures.
- **browser-agent-{taskId}** — Takes screenshots and validates UI changes in the browser.

Each agent runs as a separate LLM session with its own conversation history. The plan-agent
handles the entire planning phase (plan + task generation). The coding/build/test/browser
agents are part of the execution phase and run per-task.

IMPORTANT: Each agent session accumulates tokens cumulatively — every tool call iteration
sends the full conversation history so far. When two agents explore the same files, the
token cost of that exploration is paid twice. This is a key cost consideration.

## What to look for

- Where did a specific agent (name it) waste time or go in the wrong direction?
- Did the plan-agent spend excessive tokens re-exploring files during task generation that
  it already read during planning? If so, quantify the overlap (how many identical tool calls).
- Did the coding-agent misunderstand the task? What in the task description caused confusion?
- Were there files or modules a specific agent should have found faster?
- Did the build/test agents have to fix issues the coding-agent should have caught?
- What could we change in our prompts, context passing, or tooling to improve this case?

Be specific — name the exact agent, reference exact tool calls, search queries, and file paths.

Return your findings as a JSON array. Each element must have these fields:
- "severity": "HIGH" | "MEDIUM" | "LOW"
- "pattern": short label (under 80 chars)
- "description": full explanation. Always name the specific agent(s) involved.
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
