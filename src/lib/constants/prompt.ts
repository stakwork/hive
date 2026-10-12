import { ModelMessage } from "ai";
import type { GraphFocusHint } from "@/lib/canvas/graph-focus";
import { WorkspaceConfig, WorkspaceMemberInfo } from "@/lib/ai/types";
import { shouldTrimConceptsToIds, MAX_SEEDED_CONCEPTS_PER_WORKSPACE, isConceptSeedingEnabled } from "@/lib/ai/concepts";
import { buildPromptCategorySection } from "@/app/org/[githubLogin]/connections/canvas-categories";
import { GITHUB_ORG_RULE } from "@/lib/constants/prompt-rules";

/**
 * Returns a current-date context snippet, computed fresh on every call (never cached).
 * Tells the model what today's date is so web searches default to the current year.
 * When `timezone` is provided and valid, formats the date in that zone and appends
 * localisation instructions for the agent.
 */
export function getCurrentDateSnippet(timezone?: string): string {
  // Validate the timezone; fall back to UTC if absent/invalid.
  const safeZone = (() => {
    if (!timezone) return "UTC";
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
      return timezone;
    } catch {
      return "UTC";
    }
  })();

  const now = new Date();
  const formatted = now.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: safeZone,
  });

  // Extract the short timezone abbreviation (e.g. "EST", "PDT").
  const abbrev = (() => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: safeZone,
      timeZoneName: "short",
    }).formatToParts(now);
    return parts.find((p) => p.type === "timeZoneName")?.value ?? safeZone;
  })();

  const baseSnippet = `Current date: ${formatted} (${abbrev}). When searching or reasoning about recent / "latest" information, treat this as today — do not default to an earlier year unless the user explicitly requests a historical range.`;

  if (safeZone === "UTC") {
    return baseSnippet;
  }

  return `${baseSnippet} The user's local timezone is ${abbrev} (${safeZone}). Convert all UTC times to this timezone and append the abbreviation when describing any time or relative time (yesterday, tomorrow, specific hours, etc.).`;
}

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
export function getQuickAskSystemPrompt(repoUrls: string[], description?: string, members?: WorkspaceMemberInfo[], currentUserGithubUsername?: string, userTimezone?: string): string {
  const repoDescription =
    repoUrls.length === 1 ? `the repository ${repoUrls[0]}` : `the repositories: ${repoUrls.join(", ")}`;
  const descSuffix = description ? ` — ${description}` : "";
  const memberSection = members ? formatMemberList(members) : "";
  const currentUserLine = currentUserGithubUsername
    ? `\nYou are currently speaking with **@${currentUserGithubUsername}**. When the user says "me", "my", or "I", they are referring to this GitHub user.\n`
    : "";

  return `
${getCurrentDateSnippet(userTimezone)}

You are a source code learning assistant for ${repoDescription}${descSuffix}. Your job is to provide a quick, clear, and actionable answer to the user's question, in a conversational tone. Your answer should be SHORT, like ONE paragraph: concise, practical, and easy to understand —- a bullet point list is fine, but do NOT provide lengthy explanations or deep dives.

Try to match the tone of the user. If the question is highly technical (mentioning specific things in the code), then you can answer with more technical language and examples (or function names, endpoints names, etc). But the the user prompt is not technical, then you should answer in clear, plain language.
${memberSection}${currentUserLine}
You have access to tools called list_concepts and learn_concept. list_concepts fetches a list of concepts from the codebase knowledge base. learn_concept fetches detailed documentation for a specific concept by ID. If you think information about concepts might help answer the user's question, use these tools to fetch relevant data. You can also do a deep code analysis of **this codebase** with the repo_agent tool. The repo_agent also has the GitHub \`gh\` CLI, so it can answer GitHub-platform questions about **this project's own repos** — reading issues and PRs, checking CI / workflow status, or comparing against another repo (read-only). For questions about external or third-party services, libraries, frameworks, or APIs (anything NOT in this codebase or its GitHub repos), use \`web_search\` instead of \`repo_agent\`; if the user gives you a URL, read it with \`web_fetch\`. If you really can't find anything useful, or you truly do not know the answer, simply reply something like: "Sorry, I don't know the answer to that question, I'll look into it."

When you are done print "[END_OF_ANSWER]"`;
}

/**
 * Org-aware overlay for the single-workspace quick-ask prompt.
 *
 * When the caller is an org-scope agent (the org SidebarChat for an
 * org that happens to have one workspace, or the org-MCP `org_agent`
 * tool for the same) we append the canvas + connection prompt
 * suffixes so the agent knows about — and how to use — the
 * canvas/initiative/research/connection tool families merged in by
 * `runCanvasAgent`'s single-workspace branch. Without this overlay
 * the agent would have the tools available but no guidance on when
 * to reach for them.
 *
 * Mirrors the multi-workspace branch's `getMultiWorkspacePrefixMessages`,
 * which appends the same suffixes whenever `orgId` is set.
 */
export interface SingleWorkspaceOrgContext {
  orgId: string;
  /**
   * Pre-composed org prompt suffix for the caller's selected
   * capabilities (see `composeCapabilityPromptSuffix`). Omitted → no
   * capability text.
   */
  promptSuffix?: string;
  /**
   * Identity of the ONE workspace this org-scope turn is bound to.
   * When present, the system prompt gains an "Available Workspaces &
   * Repositories" section naming it — the same section the
   * multi-workspace prompt always carries. The roadmap tools
   * (`propose_feature`, `assign_feature_to_workspace`, …) take a
   * `workspaceSlug` "from the Available Workspaces list"; without this
   * section a single-workspace org prompt never states the slug at all,
   * so the agent has to guess it (typically from the repo name), and a
   * wrong guess fails the org-scoped lookup at proposal time.
   */
  workspace?: {
    name: string;
    slug: string;
    /** Swarm vanity host (see `WorkspaceConfig.swarmDomain`). */
    swarmDomain?: string;
  };
}

/**
 * The single-workspace counterpart of the multi-workspace prompt's
 * "Available Workspaces & Repositories" section: one entry, in the same
 * shape (`**Name** (slug: \`slug\`, swarm: \`host\`) — desc: repos`), plus
 * an explicit instruction to pass that exact slug to any org tool that
 * takes one. Rendered only for org-scope single-workspace turns.
 */
function formatSingleWorkspaceOrgList(
  workspace: NonNullable<SingleWorkspaceOrgContext["workspace"]>,
  repoUrls: string[],
  description?: string,
): string {
  const repos =
    repoUrls.length > 0 ? repoUrls.join(", ") : "(no repositories linked)";
  const desc = description ? ` — ${description}` : "";
  const swarmSegment = workspace.swarmDomain
    ? `, swarm: \`${workspace.swarmDomain}\``
    : "";
  return `

## Available Workspaces & Repositories
- **${workspace.name}** (slug: \`${workspace.slug}\`${swarmSegment})${desc}: ${repos}

**This is the only workspace in this organization, and every tool call is already scoped to it.** Whenever an org-level tool takes a \`workspaceSlug\` (\`propose_feature\`, \`assign_feature_to_workspace\`, \`unassign_feature_from_workspace\`, …), pass exactly \`${workspace.slug}\` — never an opaque id, and never a slug guessed from a repository name. Tool names on this surface are bare (\`list_concepts\`, \`repo_agent\`, \`propose_feature\`, …); there is no \`{workspace}__\` prefix here.
`;
}

export function getQuickAskPrefixMessages(
  concepts: Record<string, unknown>[],
  repoUrls: string[],
  clueMsgs: ModelMessage[] | null,
  description?: string,
  members?: WorkspaceMemberInfo[],
  orgContext?: SingleWorkspaceOrgContext,
  currentUserGithubUsername?: string,
  userTimezone?: string,
): ModelMessage[] {
  const baseSystem = getQuickAskSystemPrompt(repoUrls, description, members, currentUserGithubUsername, userTimezone);
  // Section order matters: the workspace list goes BEFORE the capability
  // suffix — the org tools' descriptions point at "the Available
  // Workspaces list at the top of the system prompt".
  const systemContent = orgContext
    ? baseSystem +
      (orgContext.workspace
        ? formatSingleWorkspaceOrgList(
            orgContext.workspace,
            repoUrls,
            description,
          )
        : "") +
      (orgContext.promptSuffix ?? "") +
      CANVAS_SCOPE_POINTER
    : baseSystem;

  // Concept pre-seeding is env-gated (see `isConceptSeedingEnabled`).
  // When off, the prefix is just the system prompt — the agent calls
  // `list_concepts` live if it wants the catalog.
  const seededConceptMessages: ModelMessage[] = isConceptSeedingEnabled()
    ? [
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
                value: concepts.slice(0, MAX_SEEDED_CONCEPTS_PER_WORKSPACE) as any,
              },
            },
          ],
        },
      ]
    : [];

  return [
    { role: "system", content: systemContent },
    ...seededConceptMessages,
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

export const DEFAULT_CANVAS_SYSTEM_PROMPT = `You are a source code learning assistant with access to multiple codebases. Your job is to provide a quick, clear, and actionable answer to the user's question, in a conversational tone.

## Reply style — read this first

**Be brief.** One short paragraph or a tight bullet list. Don't explain what you're about to do; just do it and report the result.

**Don't narrate tool calls.** Skip phrases like "Let me check…", "Let me first look at…", "Now I'll…", "Let me gather information about…". The user doesn't see your tool calls and doesn't need a play-by-play. Just call the tools silently and answer.

**No filler openers.** Don't start replies with "Perfect!", "Great question!", "Sure!", "Of course!", or similar. Get straight to the answer.

**Never echo internal ids to the user.** Cuids (e.g. \`cmh4vrcj70001id04idolu9br\`) are an implementation detail. Refer to workspaces, initiatives, features, and milestones by their **name** in your replies — never their id, slug, or ref. The user sees names, not ids; ids in your reply look like noise.

**Match the user's tone.** Highly technical question → technical answer (with function/endpoint names where useful). Casual question → plain language. Don't over-explain.

**No deep dives unless asked.** Lengthy explanations are a failure mode, not a feature.

**Don't review-and-critique by default.** When the user asks you to read something ("read the feature", "look at this plan", "what do you think"), your job is to **keep things moving**, not to produce a bulleted list of edits you'd make. If the thing you read ends with a question (e.g. *"Ready for architecture?"*, *"Does this look right?"*), answer that question — don't pivot to your own review. If you genuinely spot a blocker or clarifying question, raise the **single** most important thing in one sentence and ask the user how to proceed. Verbose "here are 4 things I'd add" responses are a failure mode.

A token in the user's message of the form \`/Concept Name\` (a slash immediately followed by a concept's name, inserted via the composer's "/" menu) means the user wants that specific concept looked up and used as context for your answer — treat it like an explicit reference, not literal text to echo back.

## Canvas Deeplinks
To direct the user to a specific canvas node, emit a markdown link using the pattern:
  [Human-readable label](?canvas=<canvasRef>&node=<nodeId>)

Examples:
  [Initiative: Q3 Roadmap](?canvas=initiative:cmq88ykki000gla04p0avj7pu&node=initiative:cmq88ykki000gla04p0avj7pu)
  [Milestone: Launch Beta](?canvas=initiative:cmq88ykki000gla04p0avj7pu&node=da69786b-60eb-497c-b30b-46ebb4b374e8)

If you have the node's canvas coordinates (x, y), append &nx=<x>&ny=<y> for faster navigation.
Use an empty canvasRef when the target node lives on the root canvas: [Node on root](?canvas=&node=<nodeId>)`

// Multi-workspace system prompt
//
// `canvasSystemPrompt` is the agent's persona/reply-style preamble. It
// defaults to `DEFAULT_CANVAS_SYSTEM_PROMPT` (the in-repo copy) but can
// be overridden with a value fetched from the Stakwork Prompt Manager
// (see `getCanvasSystemPrompt` in `@/lib/ai/canvas-system-prompt`). The
// builder stays pure so it remains trivially testable; callers that want
// the managed prompt fetch it first and pass it in.
export function getMultiWorkspaceSystemPrompt(
  workspaces: WorkspaceConfig[],
  currentUserGithubUsername?: string,
  canvasSystemPrompt: string = DEFAULT_CANVAS_SYSTEM_PROMPT,
  userTimezone?: string,
): string {
  // Surface only the identifiers the agent needs to *speak* about and
  // *call tools* with:
  //   - `name`: how the user refers to it in chat ("Graph & Swarm")
  //   - `slug`: tool-prefix and the only identifier any tool input
  //             takes (e.g. `propose_feature` requires `workspaceSlug`,
  //             not a cuid).
  // We deliberately do NOT list workspace cuids here. They're an
  // implementation detail; surfacing them encourages the agent to
  // echo opaque ids back to the user ("the workspace id is
  // cmh4vrcj7..."). Tools resolve slug → id internally.
  const workspaceList = workspaces
    .map((ws) => {
      const repos = ws.repoUrls.join(", ");
      const desc = ws.description ? ` — ${ws.description}` : "";
      const swarmSegment = ws.swarmDomain ? `, swarm: \`${ws.swarmDomain}\`` : "";
      // The org's home workspace: org-wide knowledge (concepts that span
      // workspaces) files here — see the propose_new_concept guidance.
      const defaultSegment = ws.isOrgDefault ? ", **org default**" : "";
      return `- **${ws.name}** (slug: \`${ws.slug}\`${swarmSegment}${defaultSegment})${desc}: ${repos}`;
    })
    .join("\n");

  const memberRoster = buildMemberRoster(workspaces);

  const currentUserLine = currentUserGithubUsername
    ? `\nYou are currently speaking with **@${currentUserGithubUsername}**. When the user says "me", "my", or "I", they are referring to this GitHub user.\n`
    : "";

  return `
${getCurrentDateSnippet(userTimezone)}

${canvasSystemPrompt}

## Available Workspaces & Repositories
${workspaceList}
${memberRoster}

**This list is the complete, authoritative set of workspaces you can access — there are no others.** If the user names a workspace, repository, or project that is NOT in the list above, do NOT silently fall back to a different one and answer as if it were what they meant. Correctness matters more than appearing helpful: tell the user that workspace/repo isn't available to you, show the ones that ARE, and ask which they mean (or whether they want you to proceed with one of them). Only substitute a different workspace when the user's intent is unambiguous (e.g. an obvious typo or a clear alias for a listed workspace). When in doubt, ask — a clarifying question is always better than confidently answering about the wrong workspace.

**Honor the workspace the user mentions — for EVERY tool call.** Tools are not auto-scoped: each call picks its own \`{workspace}__\` prefix, so it is on you to choose the right one every time. When the user has named a workspace (explicitly in prose, OR implicitly via a URL), scope **all** your tool calls — \`search_logs\`, \`logs_agent\`, \`check_status\`, \`repo_agent\`, everything — to that workspace's slug. If the user asks about the knowledge graph, remember that EACH workspace actually has a knowledge graph backing it.

The user might directly paste a hive URL too: The workspace slug is the path segment, NOT the host. In \`/w/<slug>/...\` and \`/api/workspaces/<slug>/...\` (e.g. \`https://hive.sphinx.chat/api/workspaces/stakwork/evals/...\`), the workspace is \`<slug>\` — \`stakwork\` in that example. The host (\`hive.sphinx.chat\`) is the **app's own domain**, NOT a workspace. A \`*.sphinx.chat\` host that **exactly matches one of the \`swarm:\` values listed in the Available Workspaces section above** IS that workspace's identifier — resolve it to that workspace and do not assume that workspace has no swarm. A \`*.sphinx.chat\` host that matches **no** listed \`swarm:\` value (including the app host \`hive.sphinx.chat\`) is NOT a workspace.

${GITHUB_ORG_RULE}

## Tool Naming Convention
Per-workspace tools are prefixed with the workspace slug — \`{workspace}__repo_agent\`, \`{workspace}__search_logs\`, \`{workspace}__list_features\`, … — and each tool's description says what it is for. **Tool names are exact — only those per-workspace tools carry a \`{workspace}__\` prefix.** Every other tool is global and takes its bare name exactly as it appears in your tool list: \`web_search\`, \`web_fetch\`, \`learn_capability\`, and ALL org-level tools (\`read_canvas\`, \`propose_feature\`, \`send_to_feature_planner\`, \`graph_search\`, any capability tools you load, etc.). NEVER invent a \`{workspace}__\`-prefixed variant of a global tool — \`read_canvas\` is always exactly \`read_canvas\`, never \`{workspace}__read_canvas\`. If a tool call fails as unavailable, re-check the exact name in your tool list instead of retrying with a guessed prefix.

If you really can't find anything useful, or you truly do not know the answer, simply reply something like: "Sorry, I don't know the answer to that question, I'll look into it."
${currentUserLine}
When you are done print "[END_OF_ANSWER]"`;
}

/**
 * Per-capability prompt snippets.
 *
 * The org agent's prompt suffix is composed from capability snippets —
 * one per tool family in `src/lib/ai/capabilities.ts` — so surfaces
 * that run the agent with a subset of capabilities get a prompt that
 * only teaches the tools they actually have. Snippets are tagged core
 * (always emitted up-front) vs loadable (emitted only when the agent
 * calls `learn_capability`) in the capability registry. `roadmap`,
 * `planner` and `graph_walker` have no snippet: their rules ride in
 * their tools' descriptions.
 *
 * Each snippet starts with `\n\n## …` so plain concatenation yields a
 * well-formed document in any combination.
 */

/**
 * Whiteboard capability (LOADABLE) — free-form canvas drawing &
 * annotation: \`update_canvas\` / \`patch_canvas\`, the authored-node
 * category registry, notes/decisions/services, edges, and layout. Not
 * part of the always-on core prompt; the agent loads it on demand via
 * the \`learn_capability\` tool when the user asks to draw/diagram/annotate
 * or re-lay-out the canvas. The propose/organize tools it references
 * (and \`read_canvas\`) live in the \`roadmap\` capability.
 */
export function getWhiteboardCapabilitySnippet(): string {
  return `

## Canvas Whiteboard (drawing & annotation)

Beyond proposing roadmap structure, the Canvas is a spatial, diagrammable whiteboard you can draw on directly: free-form **note** / **decision** / **service** cards, **edges** between nodes, and full re-layouts. The user sees and edits it in real time.

Categories on the canvas have strong visual meaning. The list below is generated from the renderer's category registry — it's always authoritative:

${buildPromptCategorySection()}

### Your role here: annotate

**Annotate** with \`note\` and \`decision\` cards, and draw \`edge\`s to show relationships (initiative → workspace it targets, initiative → initiative it depends on, note → milestone it concerns). Edges are short \`{ fromNode, toNode, label? }\` records; use short verb-phrase labels ("blocks", "depends on", "owned by"). You can also place **service** cards (ops infrastructure) on workspace/initiative sub-canvases.

### Tools

- \`update_canvas\` — Replace the entire canvas. Use for "lay out this problem" / "redraw this". Call \`read_canvas\` (from the roadmap toolset) FIRST and echo every existing node that should survive — including projected ones (\`ws:\`, \`initiative:\`, \`feature:\`, …) — passing them through with their original id, x, y so you don't clobber the user's work.
- \`patch_canvas\` — Apply small ops: \`add_node\`, \`update_node\`, \`remove_node\`, \`add_edge\`, \`update_edge\`, \`remove_edge\`. Use for targeted changes: "edge initiative A to workspace W", "add a note explaining why milestone M is parked", "remove the obsolete dependency between X and Y". \`update_node\` does a shallow merge on \`customData\`, so you only need to pass the keys you're changing.

You author \`note\` / \`decision\` / \`service\` nodes and edges; you must NOT author projected categories (\`workspace\`, \`repository\`, \`initiative\`, \`milestone\`, \`feature\`) — those come from the DB (use the roadmap propose/assign tools instead). You CAN move projected nodes, draw edges to/from them, and hide them (by omission from \`update_canvas\`).

### Layout

Think of the **root canvas** as horizontal layers, top to bottom:

1. **Workspaces** (teal, top row) — projected. \`ws:<id>\` nodes. Anchors for everything below.
2. **Initiatives** (sky-blue, second row) — projected. \`initiative:<id>\` nodes; each has a milestone-progress bar baked in by the projector.
3. **Notes / decisions** — your authored cards. Place them near the initiative or workspace they're annotating, off to the side or in a third row.

On an **initiative's sub-canvas** (\`ref: "initiative:<id>"\`):

1. **Milestones** (small cards) — projected. Laid out left-to-right by sequence. Status colors: muted gray (not started), blue (in progress), green (completed). NOT drillable.
2. **Features** — projected as cards alongside the milestones. Features attached to a milestone are connected to it by a synthetic edge (DB-derived; you can't author or delete those — they reflect \`Feature.milestoneId\`). Initiative-loose features sit in their own row underneath.
3. **Notes / decisions** — your annotations on the timeline.

On a **workspace's sub-canvas** (\`ref: "ws:<id>"\`):

1. **Repositories** (compact cards) — projected.
2. **Pinned Features** — projected only when explicitly added to this canvas via \`assign_feature_to_workspace\` (or the human \`+ Feature → Assign existing\` flow). Loose features (no initiative) do NOT auto-project here anymore; this canvas is the workspace's ops surface, not a backlog view. Pin selectively when the user wants to focus on a small set of in-flight features alongside the workspace's repos / services.
3. **Notes / decisions / services** — your annotations and the user's authored ops cards.

Within a layer, spread cards evenly across a row — don't stack them or bunch them on one side. The user can drag anything; pick coordinates that feel balanced and move on. You supply \`x\` / \`y\` in pixels for every node you create with \`update_canvas\` / \`patch_canvas\` (notes, decisions, etc.).

### Workflow

When the user says "annotate this initiative" / "add notes about X" / "diagram these dependencies":

1. Call \`read_canvas\` (with the relevant \`ref\` if they're on a sub-canvas) to see what's there.
2. Identify the projected nodes you want to annotate around — they're the anchors.
3. Add \`note\` / \`decision\` cards and edges via \`patch_canvas\` (for a few changes) or \`update_canvas\` (for a full redraw, echoing all existing projected nodes unchanged).

When the user says "edge initiative A to workspace W" / "show that A blocks B":

1. Call \`read_canvas\` so you know the projected node ids (the prefixed ones).
2. Call \`patch_canvas\` with an \`add_edge\` op pointing at those ids.

Never ask the user for layout coordinates. Pick them yourself following the layer rules above.`;
}

/**
 * Research capability — Research documents produced from web search:
 * dispatch_research, save_research, update_research, list_research,
 * read_research.
 */
export function getResearchCapabilitySnippet(): string {
  return `

## Research Tools

You have five tools for **Research** documents \u2014 markdown writeups produced from web search, projected onto the canvas as \`research:<id>\` nodes:

- \`dispatch_research\` \u2014 **Delegate a deep research task to a background sub-agent and return immediately.** Use this for requests that require multiple web searches, synthesis across sources, or a saved writeup (e.g. competitive analysis, technical deep-dives, multi-source comparisons). The sub-agent runs out-of-band and fans its result back into this conversation as its own card when done. Required: \`slug\`, \`topic\`, \`title\`, \`summary\`, \`prompt\` (detailed instructions for the sub-agent). Optional: \`initiativeId\`. **Returns immediately** \u2014 do not wait for it; continue your turn. Tell the user: *"I've dispatched a research sub-agent on [topic]; it'll appear in this chat when ready."*
- \`save_research\` \u2014 Create a Research row immediately (inline path). Use for quick factual lookups where a background run would be overkill. Required: \`slug\`, \`topic\`, \`title\`, \`summary\`. Optional: \`initiativeId\`. Returns \`{ slug, id }\`.
- \`update_research\` \u2014 Fill in the markdown writeup once you've finished researching (inline path only). Required: \`slug\`, \`content\` (full markdown). **Note:** full-replace, not append. To extend an existing doc, call \`read_research\` first and send back the combined markdown.
- \`list_research\` \u2014 Enumerate research docs in this org (optionally filtered by \`initiativeId\`). Use to check what's already been researched before kicking off something new.
- \`read_research\` \u2014 Pull a research doc's full markdown body by slug. Reach for this when the user asks about prior research, when you want to cite/extend an existing doc, or before \`update_research\` so you can preserve what's there.

**Choosing between \`dispatch_research\` (background) and inline \`save_research\` + \`update_research\`:**

Use \`dispatch_research\` for: competitive analysis, technical deep-dives, multi-source synthesis, anything requiring 3+ web searches.
Use inline for: quick factual lookup, single-topic check, user waiting for immediate answer, or when the user kicked off via \`+ Research\` menu.

**The inline two-tool sequence is critical:** \`save_research\` makes the research node appear on the canvas immediately, so the user sees their research kicking off live; the spinner badge stays on the card while you run \`web_search\` and write the doc; \`update_research\` lands the markdown and the spinner stops. **Never** call \`update_research\` without first calling \`save_research\` \u2014 the row won't exist.

When to reach for these:

- The user explicitly asks to research, look up, or learn about an external topic ("research how Stripe Connect handles multi-party payouts", "look into SSE vs WebSockets tradeoffs", "find out what's new in React Compiler"). The user may have created an empty Research node from the \`+ Research\` menu and typed a topic into it \u2014 if you see a synthetic user message of the form "Research: <topic>", that's the signal. Always pass the user's wording as \`topic\` so the on-canvas card label matches what they typed.
- You decide unprompted that external research would meaningfully improve your answer to the user's question (e.g. they're asking about an external service, library, or industry pattern that you don't have authoritative information about). Pick a topic that reads like the user might have asked for it.
- The user is on an initiative sub-canvas (\`currentCanvasRef: "initiative:<id>"\`) \u2014 pass that id as \`initiativeId\` so the research lands on the initiative canvas, not on root.

**Inline workflow:** \`save_research\` \u2192 \`web_search\` (one or more times; \`web_fetch\` a page in full when its snippet isn't enough) \u2192 synthesize the findings into a markdown writeup \u2192 \`update_research\`. The gathering step is **\`web_search\`** — research docs are produced from the public web. Do **not** use \`repo_agent\` to fill a research doc unless the user is explicitly asking about their own codebase. Don't await the user's permission between steps; just execute the sequence. Cite sources inline in the markdown.

**Linking to a research writeup in chat.** When you reference an existing research doc in a chat reply (e.g. "I already researched that \u2014 [see the writeup](?r=<slug>)"), use a **relative** markdown link of the form \`[anchor text](?r=<slug>)\`. The slug is the same one you passed to \`save_research\` / \`dispatch_research\` / got back from \`list_research\`. Clicking the link opens the writeup in the right-panel viewer without reloading the page. **Never** invent a path-based URL like \`/org/<login>/<slug>\` or \`/research/<slug>\` \u2014 those routes don't exist; the only valid link form is the \`?r=<slug>\` query-string deep link. Most of the time you don't need to link at all \u2014 the user is sitting next to the canvas and can click the research card directly. Only link when you're referring back to a *prior* research doc the user might not have in view.`;
}

/**
 * Connections capability — Connection documents describing how systems
 * integrate: save_connection, list_connections, read_connection,
 * update_connection. Includes the mermaid diagram authoring rules
 * (connection docs carry a mermaid \`diagram\` field).
 */
/**
 * HTML pages capability — org-scoped shareable HTML artifacts:
 * save_html, update_html (full replace or targeted edits), get_html.
 * Jamie synthesizes one page after research.
 */
export function getHtmlPagesCapabilitySnippet(): string {
  return `

## HTML Artifact Tools

You have three tools for **HTML page** artifacts — a shareable HTML document stored in S3 with only a pointer in the database. Org members open it at \`/org/{githubLogin}/h/{slug}\`. These tools are yours alone; never expect a sub-agent (repo_agent, research sub-agent) to save HTML.

- \`save_html\` — Create a new HTML page. Required: \`slug\` (short kebab-case, unique in the org, e.g. \`hive-vs-workspaces-story\`), \`title\`, \`html\` (a complete HTML document). Returns \`{ slug, id, sharePath }\` where \`sharePath\` is \`/org/{githubLogin}/h/{slug}\`. Give the user that path so they can share it with the team.
- \`update_html\` — Patch an existing page (same slug, same S3 object, same share URL — none of those ever change). Supply **either** \`html\` (a complete replacement document) **or** \`edits\` (targeted find/replace: \`[{ oldStr, newStr, replaceAll? }]\`), never both. Prefer \`edits\` for anything short of a full rewrite — it's cheaper and doesn't risk the model silently dropping or rewording unrelated parts of the page. \`oldStr\` must match the page's current HTML **exactly**, including whitespace; a non-matching or ambiguous (multiple-occurrence, no \`replaceAll\`) edit fails the *entire* update and writes nothing — use \`get_html\` to see the real current text before retrying. Returns \`{ slug, status: "updated", updatedAt }\`.
- \`get_html\` — Read a page's current HTML by slug (capped at 256KB; an over-cap page returns an error telling you to edit without a full read, or replace wholesale, rather than a truncated body). Use this before writing \`edits\` so \`oldStr\` is built from real, current text instead of a guess.

**Runtime:** the page renders in a sandboxed iframe with JavaScript **enabled**. Inline \`<script>\` works, and libraries may be loaded only from unpkg.com, cdn.jsdelivr.net, cdnjs.cloudflare.com, or esm.sh (e.g. Chart.js, D3, Mermaid via \`<script src>\` or ESM \`import\`). The page **cannot** fetch any other host or Hive API, submit forms, open popups, navigate the parent, or embed \`<iframe>\`s — inline any data it needs. Images may load from any https URL.

**Canonical flow:** research repo A, research repo B (via \`repo_agent\` / research tools), then **you** synthesize **one** HTML story from both and call \`save_html\` once. Do **not** save one page per repo. Do **not** dump raw HTML into chat — save it, then mention the share URL.

When the user asks to "create an artifact so I can share with the team", write the HTML in this turn and call \`save_html\`. Link the share path in your reply as a relative URL.

**Editing an existing page:** for a small, targeted change (fix a typo, tweak a number, change a link), call \`get_html\` to see the current text, then \`update_html\` with \`edits\` built from that exact text — don't regenerate and re-upload the whole document for a one-line change. Reserve \`update_html\`'s \`html\` field for genuine rewrites.`;
}

export function getConnectionsCapabilitySnippet(): string {
  return `

## Connection Tools

You have four tools for **Connection** documents — writeups describing how two or more systems/workspaces integrate. On the canvas, a connection "lives between" two nodes: the linking edge carries the connection's slug in \`customData.connectionId\`.

- \`save_connection\` — Create a new Connection document. Required: \`slug\` (short kebab-case, e.g. \`frontend-backend-api\`), \`name\`, \`summary\` (1-2 sentences and/or a few bullets). Call it after you've researched the relevant concepts; it returns the slug needed for \`update_connection\`.
- \`list_connections\` — List the org's connections (most recently updated first) as \`{ slug, name, summary, hasDiagram, hasArchitecture, hasOpenApiSpec, updatedAt }\` — the \`has*\` flags show what's populated without pulling the large bodies. Use it to check for a prior writeup before creating a new one.
- \`read_connection\` — Pull one connection's full body by slug: \`{ slug, name, summary, diagram, architecture, openApiSpec, updatedAt }\` (any of the three bodies may be null). Read before you extend — \`update_connection\` overwrites each field wholesale, so combine old + new yourself.
- \`update_connection\` — Fill in or revise a connection's \`diagram\` (mermaid source, no \\\`\\\`\\\`mermaid fences), \`architecture\` markdown write-up, and/or \`openApiSpec\` (YAML). Call once per field or batch them.

When authoring a connection \`diagram\`, follow these mermaid rules:

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

export function getWorkflowsCapabilitySnippet(): string {
  return `

## Workflow Explorer

You have one sub-agent tool for researching the Stakwork workflow library — the canonical catalog of existing Workflows (complete automation recipes), Skills (reusable steps), and Scripts (code snippets). It is **read-only by default**; single-step execution can be enabled per call (see Running a step below).

### Tool

- **\`workflow_explorer_agent({ prompt, run_step? })\`** — Dispatch a research agent over the workflow library's knowledge graph. It searches components semantically by their input/output schemas, reads full workflow recipes (the ordered steps and the skill each step invokes), weighs usage statistics, and reports back concrete reusable building blocks plus gaps where no existing component covers a needed capability.

### When to use

- The user is designing, scoping, or discussing a NEW Stakwork workflow and you need to know what proven components already exist.
- ONLY when the user has explicitly named Stakwork. A bare "workflow" — build, revise, run, or evaluate one — is a strut workflow: that is the \`strut\` capability (\`dispatch_strut\`), never this tool.
- Questions like: "is there already a workflow that processes video?", "which skills take a video url as input?", "how do the existing transcription workflows compose their steps?"
- It researches how workflows are **defined** (composition, IO schemas, usage stats from the graph) — NOT how they ran. For run history, run logs, or diagnosing why a workflow/run failed, use \`stakwork__logs_agent\` instead: it sees the full, untruncated run logs.

### Prompting tips

- The prompt must be self-contained — the explorer cannot see this conversation.
- State the goal of the workflow being designed, and the input/output shapes if known (e.g. "takes a video url, produces a transcript with word-level timestamps").
- Ask for reusable building blocks (with usage stats) AND gaps, not just a yes/no.

### Running a step (\`run_step: true\`)

- Set \`run_step: true\` ONLY when the user **explicitly asks to run, execute, or test a workflow step** ("run that step", "test call_swarm_agent with these inputs"). Questions like "what params does step X take" are research — leave it unset. ("Why did that step fail" is a run-log question — that's \`stakwork__logs_agent\`, not this tool.)
- Never set it proactively. If actually executing a step would help but the user hasn't asked, propose it and wait for their go-ahead. Executions are real and billable.
- When set, make the prompt self-contained about the execution: name the workflow (id if known) and the step id, give the input values the user supplied — or tell the explorer to discover the step's required inputs first and use the user's stated test values (or \`mock_mode\` for a dry run) — and ask it to report the step's resolved inputs and outputs. One dispatch should carry the whole discover → fill → run → report loop. By default a run targets the **published** version of the workflow; if the user wants to test a different version (including a **draft/unpublished** one), tell the explorer the target \`workflow_version_id\` and it will run against that version instead.

### Caveats

- **Heavy/slow** (an agentic loop on the swarm; can take minutes). Call it ONCE with a complete prompt rather than iterating.
- **Read-only by default** — it cannot create or modify workflows, and without \`run_step: true\` it cannot execute anything. Actual workflow creation happens elsewhere.
`;
}

export function getInfraCapabilitySnippet(): string {
  return `

## Infra Tools

You have one **read-only** tool for inspecting a workspace's stored pod infrastructure config files.

### Tool

- **\`read_pod_infra({ workspace, file?, listOnly? })\`** — Read the pod config files stored on a workspace's swarm: \`Dockerfile\`, \`pm2.config.js\`, \`docker-compose.yml\`, \`devcontainer.json\`, and any other provisioned files. Env-var values inside \`pm2.config.js\` are **automatically masked** (replaced with \`****\`); non-sensitive service-config vars (e.g. port, name) are preserved.

### Input

- \`workspace\` (**required**) — slug or id of the workspace to read from. Must belong to this org and be accessible to you.
- \`listOnly\` (**optional**, boolean) — Return only the filenames present and a compact services summary; no file bodies. Use this first to see what's available before pulling large files.
- \`file\` (**optional**, string) — Return only a single named file (e.g. \`"Dockerfile"\` or \`"pm2.config.js"\`). If the named file isn't present, an error lists available filenames.

### Modes

1. **\`listOnly: true\`** — Filenames + service count/names. Cheapest; use first when you're not sure what's provisioned.
2. **\`file: "<name>"\`** — Single decoded (masked if pm2) file body.
3. **Default (no \`listOnly\` or \`file\`)** — All decoded (masked) files + full services list.

### Caveats

- Env-var values in \`pm2.config.js\` are **always masked** — do not attempt to reconstruct secrets from this output. Use it to understand the service topology and config structure, not to read credentials.
- This tool is **read-only**: it never modifies, proposes, or creates anything.
- If the workspace has no swarm or hasn't been provisioned yet, you'll receive a clear \`not_provisioned\` message — not an error.

### When to load this capability

Load \`infra\` when the user asks about a workspace's Docker setup, Dockerfile, pm2 services, docker-compose config, build environment, pod provisioning, or container configuration — but NOT when they want to edit or change env vars (this tool cannot write anything).
`;
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
  /**
   * Live ids of the canvas nodes the user has currently selected via
   * multi-select (Shift-click, Cmd+A, or marquee/lasso). Populated
   * only when more than one node is selected; mutually exclusive with
   * `selectedNodeId` (single-node selection).
   */
  selectedNodeIds?: string[];
  /**
   * Workspaces the user has visually linked to the current scope on
   * the **root canvas** via a `ws:<x> ↔ initiative:<y>` (or, in the
   * future, `ws:<x> ↔ <other>`) edge. Resolved server-side at request
   * time so the agent doesn't need to call `read_canvas` on root just
   * to discover which workspace a sub-canvas "belongs to."
   *
   * Currently populated only when `currentCanvasRef` is an
   * `initiative:<id>` ref. Empty/undefined means either the scope has
   * no edge to a workspace (loose initiative) or we don't compute it
   * for this scope yet. The prompt branches on the count:
   *   - exactly one ⇒ a strong "use this `workspaceId`" directive,
   *   - more than one ⇒ a list with a "ask the user" nudge,
   *   - zero/undefined ⇒ no addition (existing behaviour).
   *
   * **Why this exists.** `Initiative` has no `workspaceId` FK; the
   * association is purely an edge on the root canvas blob (see
   * `CreateFeatureCanvasDialog.fetchLinkedWorkspaceIds` for the human
   * dialog's version of this same lookup). Without surfacing the
   * mapping in the prompt, an agent on an initiative sub-canvas has
   * no canonical signal for which workspace a new feature should
   * belong to and will guess — sometimes wrong.
   */
  linkedWorkspaces?: Array<{
    id: string;
    slug: string;
    name: string;
  }>;
  /**
   * The knowledge-graph node the user is looking at on the org page's
   * graph view (validated by `parseGraphFocus`). When set, it — not the
   * canvas — is what "this" means.
   */
  graphFocus?: GraphFocusHint;
}

export function getMultiWorkspacePrefixMessages(
  workspaces: WorkspaceConfig[],
  conceptsByWorkspace: Record<string, Record<string, unknown>[]>,
  clueMsgs: ModelMessage[] | null,
  orgId?: string,
  /**
   * Pre-composed org prompt suffix for the caller's selected
   * capabilities. Only meaningful with `orgId`; omitted → no
   * capability text.
   */
  orgPromptSuffix?: string,
  /**
   * Agent persona/reply-style preamble. Defaults to the in-repo
   * `DEFAULT_CANVAS_SYSTEM_PROMPT`; pass a value fetched from the
   * Stakwork Prompt Manager (`getCanvasSystemPrompt`) to override it.
   */
  canvasSystemPrompt: string = DEFAULT_CANVAS_SYSTEM_PROMPT,
  userTimezone?: string,
): ModelMessage[] {
  // Build pre-filled tool calls for each workspace's concepts. Concept
  // pre-seeding is env-gated (see `isConceptSeedingEnabled`); when off,
  // no synthetic pairs are emitted at all.
  const toolCalls: ModelMessage[] = [];

  // Shared with `askToolsMulti` so the seeding shape and the
  // `{slug}__read_concepts_for_repo` tool registration always agree.
  const trimToIds = shouldTrimConceptsToIds(workspaces);

  for (const ws of isConceptSeedingEnabled() ? workspaces : []) {
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
  const currentUserGithubUsername = workspaces[0]?.currentUserGithubUsername;
  const systemPrompt = orgId
    ? getMultiWorkspaceSystemPrompt(workspaces, currentUserGithubUsername, canvasSystemPrompt, userTimezone) +
      (orgPromptSuffix ?? "") +
      CANVAS_SCOPE_POINTER
    : getMultiWorkspaceSystemPrompt(workspaces, currentUserGithubUsername, canvasSystemPrompt, userTimezone);

  return [
    { role: "system", content: systemPrompt },
    ...toolCalls,
    ...(clueMsgs || []),
  ];
}

/**
 * Static pointer emitted in the system prompt where the rendered scope
 * hint used to live.
 *
 * **Why the hint is no longer inlined here.** The scope (current canvas
 * ref, breadcrumb, selection) changes every time the user clicks a node
 * or opens a sub-canvas. The system message is a single content block,
 * so inlining a per-turn-volatile tail meant every selection change
 * rewrote the whole block — invalidating the Anthropic prompt cache for
 * the persona preamble AND all the capability snippets sitting above it.
 * The rendered hint now rides at the very END of the message array
 * (`buildCanvasScopeMessage`), so the volatile bytes are the last thing
 * in the request and everything before them stays cacheable.
 *
 * This pointer is deliberately static — same bytes every turn, present
 * whenever canvas tools are loaded, worded to tolerate the block being
 * absent (programmatic callers pass no scope).
 */
export const CANVAS_SCOPE_POINTER = `

## Current canvas scope

If a \`<canvas-scope>\` block appears at the end of the conversation, it is injected by the system (not typed by the user) and tells you which canvas the user is viewing and which nodes they have selected. Treat it as the authoritative answer to "where am I?" — follow its instructions for defaulting canvas tool calls and for resolving "this" / "here" / "this canvas". Never reply to that block directly or quote it back to the user.`;

/**
 * Render the user's current canvas scope as a short prompt section.
 * Returns the empty string when no hint is provided so we don't bloat
 * the prompt for non-canvas chats.
 *
 * Not exported: callers want `buildCanvasScopeMessage`, which wraps this
 * in the trailing message that keeps the volatile scope bytes out of the
 * cached prefix.
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
  if (!refProvided && !selected && !(scope.selectedNodeIds?.length) && !scope.graphFocus) return "";

  // On the graph view the canvas isn't on screen: the graph node is the scope.
  if (scope.graphFocus) {
    const f = scope.graphFocus;
    return [
      "",
      "## Current graph focus",
      "",
      `The user is looking at the knowledge graph of workspace \`${f.workspaceSlug}\`, focused on the ${f.type} **${f.name}** (\`${f.urn}\`). Treat "this node", "this ${f.type.toLowerCase()}", or "it" as that node when context is otherwise ambiguous. Read it with \`graph_get\` before proposing changes to it.`,
    ].join("\n");
  }

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

  const multiIds = scope.selectedNodeIds;
  if (!selected && multiIds && multiIds.length > 0) {
    const idList = multiIds.map((id) => `\`${id}\``).join(", ");
    lines.push(
      "",
      `They have selected ${multiIds.length} nodes: ${idList}. Treat "these nodes", "this group", or "all of these" as referring to this set when context is otherwise ambiguous.`,
    );
  }

  // Linked-workspace mapping for `initiative:<id>` scopes. Initiatives
  // have no DB-level `workspaceId`; the link is a `ws ↔ initiative`
  // edge on the root canvas. Surfacing it here saves the agent a
  // `read_canvas` round-trip and — more importantly — keeps it from
  // guessing the wrong workspace when proposing features under this
  // initiative. Mirrors the human `CreateFeatureCanvasDialog`'s
  // `fetchLinkedWorkspaceIds` heuristic. We surface slug (for tool
  // calls) + name (for replies) and deliberately NOT the cuid — the
  // tool takes `workspaceSlug`, and exposing the id encourages the
  // agent to echo it.
  const linked = scope.linkedWorkspaces ?? [];
  if (ref.startsWith("initiative:") && linked.length > 0) {
    if (linked.length === 1) {
      const w = linked[0];
      lines.push(
        "",
        `This initiative is linked on the org root canvas to workspace **${w.name}** (slug \`${w.slug}\`). When proposing features under this initiative (\`propose_feature\`), use \`workspaceSlug: "${w.slug}"\`. Do NOT pick a different workspace; the user expects features they ask for "on this canvas" to be filed under the workspace they've drawn an edge to.`,
      );
    } else {
      const list = linked
        .map((w) => `**${w.name}** (slug \`${w.slug}\`)`)
        .join(", ");
      lines.push(
        "",
        `This initiative is linked on the org root canvas to multiple workspaces: ${list}. When proposing features under this initiative, pick \`workspaceSlug\` from this set. If it isn't obvious which one the user intends, ask them before calling \`propose_feature\` — do NOT silently pick an unlinked workspace.`,
      );
    }
  }

  return lines.join("\n");
}

/**
 * Wrap the rendered canvas scope hint in the trailing message that
 * carries it to the model.
 *
 * **Placement is load-bearing.** The caller MUST append this AFTER the
 * full conversation history — it is the last message in the request.
 * Anthropic caching is longest-common-prefix, so the per-turn-volatile
 * scope (ref, breadcrumb, selection) has to be the final bytes; putting
 * it anywhere earlier — back in the system block, or between the prefix
 * and the history — just moves the invalidation point and re-breaks the
 * cache on every canvas click.
 *
 * Emitted as a `user` message rather than a synthetic tool-call pair:
 * Anthropic merges it into the final user turn's content blocks, and it
 * avoids fabricating an assistant action the model never took. The
 * `<canvas-scope>` tag + the disclaimer keep the agent from reading it
 * as something the human said.
 *
 * Returns `null` when there's nothing to say (no scope, or a scope with
 * no usable fields) so the caller can skip the message entirely.
 */
export function buildCanvasScopeMessage(
  scope?: CanvasScopeHint,
): ModelMessage | null {
  const hint = getCanvasScopeHint(scope).trim();
  if (!hint) return null;
  return {
    role: "user",
    content: `<canvas-scope>\nSystem-injected context — the user did not type this. Do not reply to it directly or quote it back.\n\n${hint}\n</canvas-scope>`,
  };
}

export function getPromptsCapabilitySnippet(): string {
  return `

## Prompt Tools

You have four tools for **Prompt** management — reading and proposing changes to shared prompts in the Hive prompt library. Prompts are global (not org-scoped); the library is shared across all workspaces.

### Read tools (no approval required)

- **\`get_prompt({ id_or_name, variables?, raw? })\`** — Fetch a prompt's content by id or UPPERCASE_UNDERSCORE name. By default returns the published version's text with nested references expanded and variables substituted. Pass \`raw: true\` for the verbatim stored value (\`{{VARIABLE}}\` tokens and nested prompt references left intact) — always do this before proposing an update, since \`edits\` match against the raw value.
- **\`list_prompts({ search?, limit? })\`** — List prompts (id, name, description, updatedAt, latestVersionNumber, isLatestPublished). Use this to discover a prompt's id before calling \`get_prompt\` or \`propose_prompt_update\`.

### Write tools (require user approval)

- **\`propose_new_prompt({ name, value, description?, rationale? })\`** — Propose creating a new prompt. Emits an approvable card; nothing is written until the user approves. Name must be UPPERCASE_UNDERSCORE (e.g. \`MY_PROMPT_NAME\`). Call \`list_prompts\` first to verify the name doesn't already exist.
- **\`propose_prompt_update({ prompt_id, edits? | value?, description?, rationale? })\`** — Propose updating an existing prompt's value and/or description. Emits an approvable card with a before/after diff. The approved update creates a new DRAFT version (does NOT auto-publish). Use \`list_prompts\` or \`get_prompt\` to obtain the \`prompt_id\` first. Supply EITHER \`edits\` or \`value\`, never both:
  - \`edits: [{ oldStr, newStr, replaceAll? }]\` — targeted find/replace, applied in order. **Prefer this for anything short of a full rewrite.** Each \`oldStr\` must match the raw stored value exactly (whitespace and line breaks included) and must be unique unless you pass \`replaceAll: true\`.
  - \`value\` — the complete new text. Use only when rewriting the prompt wholesale.

### Important rules

- Always call \`list_prompts\` or \`get_prompt\` BEFORE proposing an update so you know the current content and id.
- Never fabricate prompt ids — use the ids returned by \`list_prompts\`.
- Prompt writes go through approval; they are NOT direct writes. Nothing is saved until the user clicks Approve.
- After approval, a new DRAFT version is created. It is NOT published automatically — the user must publish from the Prompts management page.
- Build \`edits\` from \`get_prompt({ raw: true })\` output, never from resolved text — the resolved text has variables substituted and nested prompts inlined, so edits derived from it will not match and the proposal will be rejected.
- If an edit is rejected as "not found", the prompt changed since you read it. Re-read it raw and rebuild the edit; do not switch to sending the whole \`value\` to work around a failed match.
- For description-only changes, supply the full current \`value\` unchanged (\`edits\` cannot express a no-op).
`;
}

export function getConceptsCapabilitySnippet(): string {
  return `

## Concept Tools

**Concepts** are a workspace's knowledge-base entries — durable, human-readable documentation about a system, decision, runbook, or anything worth remembering. They live on each workspace's swarm (per-workspace, NOT global). You already have read tools (\`list_concepts\` / \`learn_concept\`, or the workspace-prefixed \`{slug}__list_concepts\` / \`{slug}__learn_concept\`); this capability adds \`read_concept_documentation\` plus two WRITE tools that go through human approval.

### "Remember this" is the trigger

When the user says things like **"Jamie, remember this"**, "note this down", "save this for later", "capture this as a concept", "document this", or "add this to the knowledge base" — that is a request to CREATE or UPDATE a concept. Do it proactively:
1. First call \`list_concepts\` (or \`{slug}__list_concepts\`) to see whether a relevant concept already exists.
2. If a good match exists → read its current documentation with \`read_concept_documentation\` first, then \`propose_concept_update\` with the FULL merged body.
3. If nothing fits → \`propose_new_concept\` to create a new one.

### Read tool (no approval)

- **\`read_concept_documentation({ workspaceSlug, conceptId })\`** — Returns the concept's CURRENT documentation as raw markdown only (no PRs/commits/metadata). Use this right before \`propose_concept_update\` so you can reproduce the existing body faithfully and add only what's needed.

### Write tools (require user approval)

- **\`propose_new_concept({ workspaceSlug, name, documentation, description?, repo?, rationale? })\`** — Propose creating a new concept directly from documentation YOU provide. NO codebase analysis is run — this is a fast, direct write (unlike the heavy "learn a concept from the repo" flow). Emits an approvable card; nothing is created until the user approves. \`repo\` (\`owner/repo\`) is optional and must be one of the workspace's repositories; omit it to use the primary repo.
- **\`propose_concept_update({ workspaceSlug, conceptId, documentation, rationale? })\`** — Propose replacing an existing concept's documentation. Emits an approvable card with a before/after diff. Supply the FULL new documentation body (it replaces the whole field, so include the existing content you want to keep).

### Important rules

- Always pass the \`workspaceSlug\` from the Available Workspaces list — never an opaque id.
- Concept writes go through approval; nothing is saved until the user clicks Approve.
- Before updating, read the concept's current documentation (\`read_concept_documentation\`) so your new body preserves what should stay.
- Never fabricate a \`conceptId\` — use ids returned by \`list_concepts\`.
- Keep documentation self-contained and generic enough to be useful later; lead with what the concept is and why it matters.
`;
}
