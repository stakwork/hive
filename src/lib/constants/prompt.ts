import { ModelMessage } from "ai";
import { WorkspaceConfig, WorkspaceMemberInfo } from "@/lib/ai/types";

/**
 * Format a flat list of members for the single-workspace prompt.
 */
function formatMemberList(members: WorkspaceMemberInfo[]): string {
  if (members.length === 0) return "";
  const lines = members.map((m) => {
    const display = m.name || m.githubUsername || "Unknown";
    const gh = m.githubUsername ? ` (@${m.githubUsername})` : "";
    const desc = m.description ? ` — ${m.description}` : "";
    return `- **${display}**${gh}: ${m.role}${desc}`;
  });
  return `\n## Team Members\n${lines.join("\n")}\n`;
}

// System prompt for the quick ask learning assistant
export function getQuickAskSystemPrompt(repoUrls: string[], description?: string, members?: WorkspaceMemberInfo[]): string {
  const repoDescription =
    repoUrls.length === 1 ? `the repository ${repoUrls[0]}` : `the repositories: ${repoUrls.join(", ")}`;
  const descSuffix = description ? ` — ${description}` : "";
  const memberSection = members ? formatMemberList(members) : "";

  return `
You are a source code learning assistant for ${repoDescription}${descSuffix}. Your job is to provide a quick, clear, and actionable answer to the user's question, in a conversational tone. Your answer should be SHORT, like ONE paragraph: concise, practical, and easy to understand —- a bullet point list is fine, but do NOT provide lengthy explanations or deep dives.

Try to match the tone of the user. If the question is highly technical (mentioning specific things in the code), then you can answer with more technical language and examples (or function names, endpoints names, etc). But the the user prompt is not technical, then you should answer in clear, plain language.
${memberSection}
You have access to tools called list_concepts and learn_concept. list_concepts fetches a list of concepts from the codebase knowledge base. learn_concept fetches detailed documentation for a specific concept by ID. If you think information about concepts might help answer the user's question, use these tools to fetch relevant data. You might also get a list of clues from the search_relevant_clues tool, which may or may not be relevant. If you really can't find anything useful, or you truly do not know the answer, simply reply something like: "Sorry, I don't know the answer to that question, I'll look into it."

When you are done print "[END_OF_ANSWER]"`;
}

export function getQuickAskPrefixMessages(concepts: Record<string, unknown>[], repoUrls: string[], clueMsgs: ModelMessage[] | null, description?: string, members?: WorkspaceMemberInfo[]): ModelMessage[] {
  return [
    { role: "system", content: getQuickAskSystemPrompt(repoUrls, description, members) },
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "list-1",
          toolName: "list_concepts",
          input: {},
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "list-1",
          toolName: "list_concepts",
          output: {
            type: "json",
            value: concepts as any,
          },
        },
      ],
    },
    ...(clueMsgs || []),
  ];
}

/**
 * Build a deduplicated member roster across all workspaces.
 * Groups by github username (or name as fallback key), showing which
 * workspaces each person belongs to and their role/description.
 */
function buildMemberRoster(workspaces: WorkspaceConfig[]): string {
  // key → aggregated info
  const roster = new Map<string, {
    name: string | null;
    githubUsername: string | null;
    entries: { slug: string; role: string; description: string | null }[];
  }>();

  for (const ws of workspaces) {
    for (const m of ws.members) {
      const key = m.githubUsername?.toLowerCase() || m.name?.toLowerCase() || "unknown";
      const existing = roster.get(key);
      const entry = { slug: ws.slug, role: m.role, description: m.description };
      if (existing) {
        existing.entries.push(entry);
      } else {
        roster.set(key, {
          name: m.name,
          githubUsername: m.githubUsername,
          entries: [entry],
        });
      }
    }
  }

  if (roster.size === 0) return "";

  const lines: string[] = [];
  for (const person of roster.values()) {
    const display = person.name || person.githubUsername || "Unknown";
    const gh = person.githubUsername ? ` (@${person.githubUsername})` : "";
    const workspaceInfo = person.entries
      .map((e) => {
        const desc = e.description ? ` — ${e.description}` : "";
        return `${e.slug} (${e.role}${desc})`;
      })
      .join(", ");
    lines.push(`- **${display}**${gh}: ${workspaceInfo}`);
  }

  return `\n## Team Members\n${lines.join("\n")}\n`;
}

// Multi-workspace system prompt
export function getMultiWorkspaceSystemPrompt(workspaces: WorkspaceConfig[]): string {
  const workspaceList = workspaces
    .map((ws) => {
      const repos = ws.repoUrls.join(", ");
      const desc = ws.description ? ` — ${ws.description}` : "";
      return `- **${ws.slug}**${desc}: ${repos}`;
    })
    .join("\n");

  const memberRoster = buildMemberRoster(workspaces);

  return `
You are a source code learning assistant with access to multiple codebases. Your job is to provide a quick, clear, and actionable answer to the user's question, in a conversational tone. Your answer should be SHORT, like ONE paragraph: concise, practical, and easy to understand — a bullet point list is fine, but do NOT provide lengthy explanations or deep dives.

Try to match the tone of the user. If the question is highly technical (mentioning specific things in the code), then you can answer with more technical language and examples (or function names, endpoints names, etc). But if the user prompt is not technical, then you should answer in clear, plain language.

## Available Workspaces & Repositories
${workspaceList}
${memberRoster}

## Tool Naming Convention
Tools are prefixed with workspace slugs. For each workspace you have:
- \`{workspace}__list_concepts\` - List features/concepts from that codebase (if you only have concept IDs, re-run this tool to get full descriptions)
- \`{workspace}__learn_concept\` - Fetch detailed documentation for a feature by ID
- \`{workspace}__recent_commits\` - Query recent commits
- \`{workspace}__recent_contributions\` - Query PRs by a contributor
- \`{workspace}__search_logs\` - Search application logs (Lucene query syntax)
- \`{workspace}__repo_agent\` - Deep code analysis (if you can't find the answer with the other tools)
- \`{workspace}__list_features\` - List roadmap features/plans for a workspace. Use this if the user asks about features, plans, roadmap, or what's being worked on.
- \`{workspace}__read_feature\` - Read a feature's details, brief, requirements, architecture, and chat history
- \`{workspace}__list_tasks\` - List tasks for a workspace. Use this if the user asks about tasks or tickets.
- \`{workspace}__read_task\` - Read a task's details, status, and chat history
- \`{workspace}__check_status\` - Quick status check of active features and tasks (optionally filtered by user)

Use the repo_agent tool if the user asks about specific code in a specific repository. Use the feature/task tools when the user asks about project status, roadmap, planning, what's being worked on, or task progress. Otherwise, use the other tools to answer the question.

If you think information about concepts might help answer the user's question, use these tools to fetch relevant data. When comparing implementations or answering questions that span multiple projects, query the relevant workspaces. Always cite which workspace information came from.

If you really can't find anything useful, or you truly do not know the answer, simply reply something like: "Sorry, I don't know the answer to that question, I'll look into it."

When you are done print "[END_OF_ANSWER]"`;
}

export function getMultiWorkspacePrefixMessages(
  workspaces: WorkspaceConfig[],
  conceptsByWorkspace: Record<string, Record<string, unknown>[]>,
  clueMsgs: ModelMessage[] | null
): ModelMessage[] {
  // Build pre-filled tool calls for each workspace's concepts
  const toolCalls: ModelMessage[] = [];

  const trimToIds = workspaces.length > 2;

  for (const ws of workspaces) {
    const concepts = conceptsByWorkspace[ws.slug] || [];
    const output = trimToIds
      ? concepts.map((c) => c.id)
      : concepts;
    toolCalls.push({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: `list-${ws.slug}`,
          toolName: `${ws.slug}__list_concepts`,
          input: {},
        },
      ],
    });
    toolCalls.push({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: `list-${ws.slug}`,
          toolName: `${ws.slug}__list_concepts`,
          output: {
            type: "json",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            value: output as any,
          },
        },
      ],
    });
  }

  return [
    { role: "system", content: getMultiWorkspaceSystemPrompt(workspaces) },
    ...toolCalls,
    ...(clueMsgs || []),
  ];
}
