import { ModelMessage } from "ai";
import { WorkspaceConfig, WorkspaceMemberInfo } from "@/lib/ai/types";
import { buildPromptCategorySection } from "@/app/org/[githubLogin]/connections/canvas-categories";

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
You have access to tools called list_concepts and learn_concept. list_concepts fetches a list of concepts from the codebase knowledge base. learn_concept fetches detailed documentation for a specific concept by ID. If you think information about concepts might help answer the user's question, use these tools to fetch relevant data. You can also do a deep code analysis with the repo_agent tool. If you really can't find anything useful, or you truly do not know the answer, simply reply something like: "Sorry, I don't know the answer to that question, I'll look into it."

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

export function getCanvasPromptSuffix(): string {
  return `

## Canvas Tools

You also have access to tools for managing the organization's **Canvas** — a spatial, diagrammable whiteboard that sits as the live background of this page. The user can see and edit it in real time. Think of it as "the shared map of what the org is working on."

Categories in the canvas have strong visual meaning. The list below is generated from the renderer's category registry — it's always authoritative:

${buildPromptCategorySection()}

### Projected nodes (DB-backed) — read-only for you

Several categories are **projected from the database** rather than authored. Their ids carry a \`<kind>:\` prefix:

- \`ws:<cuid>\` — Workspaces. From the \`Workspace\` table.
- \`repo:<cuid>\` — Repositories. From the \`Repository\` table; only appear on a workspace's sub-canvas.
- \`initiative:<cuid>\` — Initiatives. From the \`Initiative\` table; appear on the org root canvas.
- \`milestone:<cuid>\` — Milestones. From the \`Milestone\` table; appear on an initiative's sub-canvas, laid out left-to-right by sequence.

Rules for projected nodes:

- **Never create them.** Do not emit \`workspace\`, \`repository\`, \`initiative\`, or \`milestone\` category nodes via \`update_canvas\` or \`add_node\`. They appear automatically from the DB and the tool schema's category enum already excludes them.
- **Never edit their text, category, or customData** — those come from the DB and will be silently discarded by the server on write. Humans manage them via the OrgInitiatives table UI or the canvas \`+\` menu (which opens a real DB-create dialog). You don't have a tool for that, and that's intentional.
- **You CAN edit their position, draw edges to/from them, and hide them.** Position changes are persisted as a per-canvas overlay; edges are persisted verbatim; hiding works by omission from \`update_canvas\`.

### Drilling into sub-canvases

Some projected nodes carry a \`ref\` field — clicking them in the UI opens that sub-canvas. You can address sub-canvases too:

- A workspace's sub-canvas: \`ref: "ws:<id>"\` (shows that workspace's repos).
- An initiative's timeline: \`ref: "initiative:<id>"\` (shows that initiative's milestones, ordered by sequence).

Pass the \`ref\` argument to any canvas tool to operate on a specific sub-canvas. Omit it to address the org root.

### Your role: annotate, don't structure

Initiatives and Milestones are **structure** — humans create them. Your job is **annotation**:

- Leave \`note\` cards explaining context, open questions, or risks.
- Leave \`decision\` cards capturing trade-offs the team has discussed.
- Draw \`edge\`s between things to show relationships: an initiative → its target workspace, an initiative → another initiative it depends on, a note → the milestone it concerns. Edges are short \`{ fromNode, toNode, label? }\` records; use short verb-phrase labels ("blocks", "depends on", "owned by").

If the user asks you to "create an initiative" or "add a milestone," tell them to use the \`+\` button on the canvas (or the Initiatives table) — those open a creation dialog that writes to the database. Do not try to fake it with a \`note\`.

### Tools

- \`read_canvas\` — Returns \`{ nodes, edges }\` for a canvas (root or any sub-canvas via \`ref\`). Call this FIRST before any modification so you can preserve everything the user has already drawn.
- \`update_canvas\` — Replace the entire canvas. Use for "lay out this problem" / "redraw this". Echo every existing node that should survive (including projected ones — pass them through with their original id, x, y).
- \`patch_canvas\` — Apply small ops: \`add_node\`, \`update_node\`, \`remove_node\`, \`add_edge\`, \`update_edge\`, \`remove_edge\`. Use for targeted changes: "edge initiative A to workspace W", "add a note explaining why milestone M is parked", "remove the obsolete dependency between X and Y". \`update_node\` does a shallow merge on \`customData\`, so you only need to pass the keys you're changing.

### Layout

Think of the **root canvas** as horizontal layers, top to bottom:

1. **Workspaces** (teal, top row) — projected. \`ws:<id>\` nodes. Anchors for everything below.
2. **Initiatives** (sky-blue, second row) — projected. \`initiative:<id>\` nodes; each has a milestone-progress bar baked in by the projector.
3. **Notes / decisions** — your authored cards. Place them near the initiative or workspace they're annotating, off to the side or in a third row.

On an **initiative's timeline sub-canvas** (\`ref: "initiative:<id>"\`):

1. **Milestones** (small cards) — projected. Laid out left-to-right by sequence. Status colors: muted gray (not started), blue (in progress), green (completed).
2. **Notes / decisions** — your annotations on the timeline.

On a **workspace's sub-canvas** (\`ref: "ws:<id>"\`):

1. **Repositories** (compact cards) — projected.
2. **Notes / decisions** — your annotations.

Within a layer, spread cards evenly across a row — don't stack them or bunch them on one side. The user can drag anything; pick coordinates that feel balanced and move on. You supply \`x\` / \`y\` in pixels for every node you create.

### Workflow

When the user says "annotate this initiative" / "add notes about X" / "diagram these dependencies":

1. Call \`read_canvas\` (with the relevant \`ref\` if they're on a sub-canvas) to see what's there.
2. Identify the projected nodes you want to annotate around — they're the anchors.
3. Add \`note\` / \`decision\` cards and edges via \`patch_canvas\` (for a few changes) or \`update_canvas\` (for a full redraw, echoing all existing projected nodes unchanged).

When the user says "mark X as done" / "update the status of milestone M" / "the initiative is at 80%":

That's a request to mutate DB state, which you don't have tools for. Tell the user to use the Initiatives table UI (where they can edit milestone status, dates, and assignees). The canvas will reflect the change automatically once they save.

When the user says "edge initiative A to workspace W" / "show that A blocks B":

1. Call \`read_canvas\` so you know the projected node ids (the prefixed ones).
2. Call \`patch_canvas\` with an \`add_edge\` op pointing at those ids.

Never ask the user for layout coordinates. Pick them yourself following the layer rules above.

The canvas and the Connections sidebar are separate. A **connection** is a written integration document (diagram, architecture, OpenAPI). A **canvas node** is a visual card on the shared map. Connections live in the sidebar; canvas nodes float on the background.`;
}

export function getConnectionPromptSuffix(): string {
  return `

## Connection Tools
You also have access to tools for creating **Connections** — documents that describe how two or more systems/workspaces work together:
- \`save_connection\` — Create a new Connection with a slug, name, and short overview. Returns the slug you must use for subsequent updates.
- \`update_connection\` — Update an existing Connection (by slug) with a diagram, architecture write-up, and/or OpenAPI spec. Call once per field.

The slug should be a short kebab-case identifier describing the systems involved, e.g. \`sphinx-hive\`, \`frontend-backend-api\`, \`payments-checkout\`.

When a user asks you to create a connection between systems:
1. **Research first** — immediately use list_concepts, learn_concept, and repo_agent across the involved workspaces to understand how they integrate. Do NOT ask broad clarifying questions before researching. Only ask targeted questions after you've done initial research and found genuine ambiguity.
2. **Overview** — write a brief overview (1-2 sentences and/or a few bullet points) of the connection, then call save_connection with a slug, name, and the overview
3. **Diagram** — generate a simple, high-level mermaid flowchart showing how the pieces interact. Keep it minimal! Follow the mermaid style guide below. Call update_connection with the slug and diagram
4. **Architecture** — write a high-level architecture summary. Focus on cross-cutting concerns: auth flow, communication protocols, data ownership, error handling patterns. Do NOT go deep into individual endpoints (that's what the API docs are for). Keep it concise. Call update_connection with the slug and architecture
5. **API Docs** — generate an OpenAPI spec documenting the actual endpoints/procedures involved in the integration. Call update_connection with the slug and openApiSpec
6. Each step should be visible to the user — stream your text before saving, explain what you're generating next

## Mermaid Diagram Style Guide

When generating mermaid diagrams, follow these rules:

### Structure
- Use \`graph TD\` (top-down) for system/architecture diagrams
- Group related nodes with \`subgraph Name["Label"]\`
- Use cylinder syntax \`[("label")]\` for databases/stores
- Use descriptive edge labels: \`-->|"verb phrase"|\`

### Color Classes
Always end the diagram with classDef definitions and class assignments.
Use this palette (dark-mode optimized, muted fills, bright borders):

\`\`\`
classDef client    fill:#1e3a5f,stroke:#5b9cf6,color:#c7e2ff
classDef gateway   fill:#431c0d,stroke:#fb923c,color:#ffe4cc
classDef service   fill:#2e1a4a,stroke:#a78bfa,color:#ede9fe
classDef data      fill:#2a1040,stroke:#c084fc,color:#f3e8ff
classDef external  fill:#3b1030,stroke:#f472b6,color:#fce7f3
classDef observe   fill:#0d3328,stroke:#34d399,color:#d1fae5
\`\`\`

Assign every node to a class. No unstyled nodes.

### Grouping Rules
- Only create a subgraph when there are 2+ related nodes that benefit from grouping
- Let the content dictate the shape — don't force layers that aren't there
- Keep it simple: a connection between 2 systems might only need 4-6 nodes total

### Edge Labels
- Keep labels short: 2-3 words (\`read/write\`, \`publish event\`, \`HTTPS\`)
- Use \`-->\` for sync, \`-.->\` for async/optional

### Syntax Rules
- Every \`subgraph\` MUST have a matching \`end\` keyword on its own line
- Every edge must have exactly one source and one target
- Every node referenced in an edge or \`class\` assignment must be defined first
- Do not nest subgraphs

### Avoid
- Don't use \`style\` on individual nodes — only \`classDef\` + \`class\`
- Don't exceed ~15 nodes for a connection diagram (keep it high-level!)
- Don't leave subgraphs with only 1 node
- DO NOT use curly braces {} in node names!!!!! Mermaid parsing interpets that as a rhombus node.
- Make sure to create valid mermaid syntax, avoid special characters in node names in general.`;
}

export interface CanvasScopeHint {
  /**
   * Canvas ref the user is currently viewing on the org canvas page.
   * `""` (or undefined) means the org root canvas; non-empty values are
   * sub-canvas refs like `"initiative:<id>"`, `"ws:<id>"`,
   * `"node:<id>"`. Threaded into the system prompt so the agent
   * defaults canvas tool calls to this scope instead of always
   * targeting root.
   */
  currentCanvasRef?: string;
  /**
   * Human-readable breadcrumb trail for the current scope, joined with
   * ` › ` — e.g. `"Acme"` on root, `"Acme › Auth Refactor"` on a
   * sub-canvas. Surfaced to the agent so it can refer to the user's
   * scope by name in replies (e.g. "I'll add it on Auth Refactor")
   * rather than echoing an opaque ref id. The ref id is still the
   * authoritative tool-call target — this is purely for natural
   * language. Optional; omitted hint just falls back to ref-only.
   */
  currentCanvasBreadcrumb?: string;
  /**
   * Live id of the canvas node the user has currently selected — e.g.
   * `"initiative:abc"`, `"ws:xyz"`, or an authored note id. Lets the
   * agent resolve "this" / "here" references in chat without guessing.
   */
  selectedNodeId?: string;
}

export function getMultiWorkspacePrefixMessages(
  workspaces: WorkspaceConfig[],
  conceptsByWorkspace: Record<string, Record<string, unknown>[]>,
  clueMsgs: ModelMessage[] | null,
  orgId?: string,
  scope?: CanvasScopeHint,
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

  // When `orgId` is present we expose BOTH org-scoped toolsets (connections
  // + canvas), and let the agent pick based on the user's intent:
  //   - "draw/lay out/diagram this"  → canvas tools
  //   - "document the integration"   → connection tools
  // The two suffixes have disjoint vocabulary so they don't fight.
  const systemPrompt = orgId
    ? getMultiWorkspaceSystemPrompt(workspaces) +
      getConnectionPromptSuffix() +
      getCanvasPromptSuffix() +
      getCanvasScopeHint(scope)
    : getMultiWorkspaceSystemPrompt(workspaces);

  return [
    { role: "system", content: systemPrompt },
    ...toolCalls,
    ...(clueMsgs || []),
  ];
}

/**
 * Render the user's current canvas scope as a short prompt section.
 * Returns the empty string when no hint is provided so we don't bloat
 * the prompt for non-canvas chats.
 */
function getCanvasScopeHint(scope?: CanvasScopeHint): string {
  if (!scope) return "";
  // Distinguish "field omitted" from "explicitly empty" — `""` is the
  // root canvas and the agent benefits from being told that, just as
  // much as it benefits from being told a sub-canvas ref.
  const refProvided = scope.currentCanvasRef !== undefined;
  const ref = scope.currentCanvasRef ?? "";
  const selected = scope.selectedNodeId;
  const breadcrumb = scope.currentCanvasBreadcrumb?.trim();
  if (!refProvided && !selected) return "";

  // Compose the human-friendly description. The breadcrumb (when
  // available) is the agent's preferred way to *talk about* the scope
  // in replies; the ref is the tool-call address. Showing both keeps
  // the two roles explicit so the agent doesn't accidentally use the
  // ref id as a name.
  let refDescription: string;
  if (breadcrumb) {
    refDescription = ref
      ? `**${breadcrumb}** (\`${ref}\` sub-canvas)`
      : `**${breadcrumb}** (the org root canvas)`;
  } else {
    refDescription = ref ? `\`${ref}\` sub-canvas` : "the org root canvas";
  }

  const lines = [
    "",
    "## Current canvas scope",
    "",
    `The user is viewing ${refDescription} right now. Default canvas tool calls (\`read_canvas\`, \`patch_canvas\`, \`update_canvas\`) to \`ref: "${ref}"\` unless the user explicitly asks about a different scope. When they say "this", "here", or "this canvas", they mean this scope.${
      breadcrumb
        ? ` When you need to refer to it in your reply, use the name "${breadcrumb}" — not the ref id.`
        : ""
    }`,
  ];

  if (selected) {
    lines.push(
      "",
      `They have selected node \`${selected}\` on the canvas. Treat "this node", "this initiative/workspace/milestone", or "it" as referring to that node when context is otherwise ambiguous.`,
    );
  }

  return lines.join("\n");
}
