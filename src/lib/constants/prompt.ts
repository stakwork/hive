import { ModelMessage } from "ai";
import type { GraphFocusHint } from "@/lib/canvas/graph-focus";
import { WorkspaceConfig, WorkspaceMemberInfo } from "@/lib/ai/types";
import { shouldTrimConceptsToIds, MAX_SEEDED_CONCEPTS_PER_WORKSPACE, isConceptSeedingEnabled } from "@/lib/ai/concepts";
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
  const systemContent = orgContext
    ? baseSystem +
      (orgContext.workspace
        ? formatSingleWorkspaceOrgList(
            orgContext.workspace,
            repoUrls,
            description,
          )
        : "") +
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

**Tool names are exact — per-workspace tools carry a \`{workspace}__\` prefix** (e.g. \`{workspace}__repo_agent\`, \`{workspace}__list_features\`); every other tool is global and takes its bare name exactly as it appears in your tool list (\`web_search\`, \`web_fetch\`, and every org-level tool — canvas/roadmap, research/connection, \`send_to_feature_planner\`, \`read_user_activity\`, and any other capability tools). NEVER invent a \`{workspace}__\`-prefixed variant of a global tool. If a tool call fails as unavailable, re-check the exact name in your tool list instead of retrying with a guessed prefix. Each tool's own description says what it's for and when to reach for it — these aren't repeated here.

If you think information about concepts might help answer the user's question, use these tools to fetch relevant data. When comparing implementations or answering questions that span multiple projects, query the relevant workspaces. Always cite which workspace information came from.

If you really can't find anything useful, or you truly do not know the answer, simply reply something like: "Sorry, I don't know the answer to that question, I'll look into it."
${currentUserLine}
When you are done print "[END_OF_ANSWER]"`;
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
