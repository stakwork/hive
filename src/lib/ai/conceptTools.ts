/**
 * Concept capability tools for the canvas agent (Jamie).
 *
 * Concepts are the workspace knowledge-base entries stored on each
 * workspace's swarm (reached via gitree HTTP), NOT in the Hive DB. Two
 * write tools, mirroring the prompt tools but workspace-scoped:
 *   - `propose_new_concept`     — emit an approvable card to create a new
 *     concept directly (name + documentation), no agentic codebase
 *     analysis. Backed by `POST /gitree/create-concept-direct`.
 *   - `propose_concept_update`  — emit an approvable card with a
 *     before/after diff of a concept's documentation. Backed by
 *     `PUT /gitree/concepts/:id/documentation`.
 *
 * Both are workspace-scoped (like `propose_feature`): the agent works in
 * `workspaceSlug`s, the tool resolves the slug → workspace cuid under the
 * calling `orgId`, and stores the cuid in the proposal payload so the
 * approval handler (which only has `orgId` + `userId`) can re-resolve the
 * workspace and reach its swarm.
 *
 * Discovering concept ids/slugs is covered by the existing `list_concepts`
 * tool. To read a single concept's CURRENT documentation before proposing
 * an update, this capability also exposes `read_concept_documentation`,
 * which returns the raw markdown body only (no PRs/commits/metadata
 * wrapper) so the agent can reproduce it faithfully in the FULL new body
 * that `propose_concept_update` requires.
 */

import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { nanoid } from "nanoid";
import { db } from "@/lib/db";
import { getSwarmAccessByWorkspaceId } from "@/lib/helpers/swarm-access";
import { parseOwnerRepo } from "@/lib/ai/utils";
import {
  PROPOSE_NEW_CONCEPT_TOOL,
  PROPOSE_CONCEPT_UPDATE_TOOL,
} from "@/lib/proposals/types";

/** Read-only tool: fetch a single concept's current documentation body. */
export const READ_CONCEPT_DOCUMENTATION_TOOL =
  "read_concept_documentation" as const;

/** Resolve a workspace slug to its cuid + name, scoped to the org. */
async function resolveWorkspace(orgId: string, slug: string) {
  return db.workspace.findFirst({
    where: { slug, sourceControlOrgId: orgId, deleted: false },
    select: {
      id: true,
      name: true,
      slug: true,
      repositories: {
        select: { repositoryUrl: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

/** Normalize a repository URL to "owner/repo" (or null if unparseable). */
function repoSlugFromUrl(url: string): string | null {
  try {
    const { owner, repo } = parseOwnerRepo(url);
    if (!owner || !repo) return null;
    return `${owner}/${repo}`;
  } catch {
    return null;
  }
}

/**
 * Resolve the agent's `person` arg to a workspace human. Matched
 * case-insensitively against each member's github username and display
 * name, over active members plus the owner (who has no member row).
 * Returns the userId (stored in the payload for the approval handler's
 * member -PREFERENCE-> Concept edge) and a display name for the card.
 */
async function resolvePerson(
  workspaceId: string,
  person: string,
): Promise<
  | { ok: true; userId: string; name: string }
  | { ok: false; available: string[] }
> {
  const [members, workspace] = await Promise.all([
    db.workspaceMember.findMany({
      where: { workspaceId, leftAt: null },
      select: {
        userId: true,
        user: {
          select: {
            name: true,
            githubAuth: { select: { githubUsername: true } },
          },
        },
      },
    }),
    db.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        owner: {
          select: {
            id: true,
            name: true,
            githubAuth: { select: { githubUsername: true } },
          },
        },
      },
    }),
  ]);

  const people = [
    ...(workspace?.owner
      ? [
          {
            userId: workspace.owner.id,
            name: workspace.owner.name,
            github: workspace.owner.githubAuth?.githubUsername,
          },
        ]
      : []),
    ...members.map((m) => ({
      userId: m.userId,
      name: m.user.name,
      github: m.user.githubAuth?.githubUsername,
    })),
  ];

  const wanted = person.trim().toLowerCase();
  const match = people.find(
    (p) =>
      p.github?.toLowerCase() === wanted || p.name?.toLowerCase() === wanted,
  );
  if (!match) {
    return {
      ok: false,
      available: people
        .map((p) => p.github ?? p.name)
        .filter((n): n is string => !!n),
    };
  }
  return {
    ok: true,
    userId: match.userId,
    name: match.name ?? match.github ?? "member",
  };
}

export function buildConceptTools(orgId: string, userId: string): ToolSet {
  void userId; // carried through the proposal payload for attribution at approval time

  return {
    [READ_CONCEPT_DOCUMENTATION_TOOL]: tool({
      description:
        "Read the CURRENT documentation of a single concept and return it " +
        "as raw markdown — nothing else (no PRs, commits, or metadata). Use " +
        "this before `propose_concept_update` so you can reproduce the " +
        "existing body faithfully and add only what's needed (the update " +
        "replaces the whole documentation field). Obtain the concept id " +
        "from `list_concepts` first.",
      inputSchema: z.object({
        workspaceSlug: z
          .string()
          .min(1)
          .describe(
            "Slug of the workspace the concept belongs to (from the " +
              "Available Workspaces list). Required.",
          ),
        conceptId: z
          .string()
          .min(1)
          .describe(
            "The concept id to read (obtain via `list_concepts`). Never " +
              "fabricate this.",
          ),
      }),
      execute: async ({
        workspaceSlug,
        conceptId,
      }: {
        workspaceSlug: string;
        conceptId: string;
      }) => {
        try {
          const workspace = await resolveWorkspace(orgId, workspaceSlug);
          if (!workspace) {
            return {
              error:
                "Workspace slug not found in this organization. Pick a slug from the Available Workspaces list.",
            };
          }

          const swarm = await getSwarmAccessByWorkspaceId(workspace.id);
          if (!swarm.success) {
            return {
              error: `The ${workspace.slug} swarm is not available (${swarm.error.type}).`,
            };
          }

          const res = await fetch(
            `${swarm.data.swarmUrl}/gitree/concepts/${encodeURIComponent(conceptId)}`,
            {
              method: "GET",
              headers: {
                "Content-Type": "application/json",
                "x-api-token": swarm.data.swarmApiKey,
              },
            },
          );
          if (res.status === 404) {
            return {
              error: `Concept '${conceptId}' not found in ${workspace.slug}. Use list_concepts to find the correct id.`,
            };
          }
          if (!res.ok) {
            return {
              error: `Failed to read concept '${conceptId}' from ${workspace.slug} (status ${res.status}).`,
            };
          }
          const data = await res.json();
          const concept = data?.concept ?? data?.feature ?? {};
          const documentation =
            typeof concept.documentation === "string"
              ? concept.documentation
              : "";
          return { documentation };
        } catch (e) {
          console.error(
            "[conceptTools.read_concept_documentation] error:",
            e,
          );
          const message =
            e instanceof Error ? e.message : "Failed to read concept";
          return { error: message };
        }
      },
    }),

    [PROPOSE_NEW_CONCEPT_TOOL]: tool({
      description:
        "Propose creating a NEW concept (a workspace knowledge-base entry) " +
        "with documentation you provide directly — NO codebase analysis is " +
        "run. Emits an approvable card in chat; the concept is NOT created " +
        "until the user approves. Use this when the user asks you to " +
        "remember, note, capture, or document something for a workspace — " +
        "e.g. 'Jamie, remember this', 'save this as a concept', 'write this " +
        "down for later'. First check `list_concepts` (or the workspace's " +
        "`{slug}__list_concepts`) to see whether a relevant concept already " +
        "exists — if so, prefer `propose_concept_update` to extend it " +
        "instead of creating a duplicate.",
      inputSchema: z.object({
        workspaceSlug: z
          .string()
          .min(1)
          .describe(
            "Slug of the workspace this concept belongs to (from the " +
              "Available Workspaces list). Required.",
          ),
        name: z
          .string()
          .min(1)
          .describe(
            "Human-readable concept name (e.g. 'Deployment Runbook'). The " +
              "swarm derives a slug id from it.",
          ),
        documentation: z
          .string()
          .min(1)
          .describe(
            "The full documentation body to store (markdown). This is the " +
              "knowledge you are capturing.",
          ),
        description: z
          .string()
          .optional()
          .describe("Short one-line description of what this concept covers."),
        repo: z
          .string()
          .optional()
          .describe(
            "Optional repository in 'owner/repo' format to file the concept " +
              "under. Must be one of the workspace's repositories. Set it " +
              "ONLY when the knowledge is about that specific repo's code; " +
              "omit for general knowledge — user preferences, process " +
              "guidelines, conventions that span repos.",
          ),
        parent: z
          .string()
          .optional()
          .describe(
            "Optional id of an existing Concept to file this one under. " +
              "Use the id exactly as returned by list_concepts (repo-scoped " +
              "concepts are repo-prefixed, e.g. 'owner/repo/slug'; general " +
              "concepts are a bare slug). Omit for a top-level concept.",
          ),
        kind: z
          .enum(["preference", "best_practice", "gotcha", "process", "general"])
          .optional()
          .describe(
            "What KIND of knowledge this is — it controls how the concept is " +
              "anchored in the workspace graph. 'preference' = how a specific " +
              "person likes things done (pair with `person`); 'best_practice' " +
              "= how the team agrees things should be done; 'gotcha' = a trap " +
              "or surprising behavior to watch out for; 'process' = a runbook " +
              "or how-we-work procedure. Omit (or 'general') for anything else.",
          ),
        person: z
          .string()
          .optional()
          .describe(
            "The workspace member this knowledge is ABOUT (github username or " +
              "display name) — usually with kind: 'preference', e.g. capturing " +
              "'Evan likes short PR descriptions'. The concept gets linked to " +
              "that person in the graph. Omit for team-level knowledge.",
          ),
        rationale: z
          .string()
          .optional()
          .describe("Why this concept is being created — shown on the card."),
      }),
      execute: async ({
        workspaceSlug,
        name,
        documentation,
        description,
        repo,
        parent,
        kind,
        person,
        rationale,
      }: {
        workspaceSlug: string;
        name: string;
        documentation: string;
        description?: string;
        repo?: string;
        parent?: string;
        kind?: "preference" | "best_practice" | "gotcha" | "process" | "general";
        person?: string;
        rationale?: string;
      }) => {
        try {
          const workspace = await resolveWorkspace(orgId, workspaceSlug);
          if (!workspace) {
            return {
              error:
                "Workspace slug not found in this organization. Pick a slug from the Available Workspaces list.",
            };
          }

          // Validate an explicitly-chosen repo against the workspace's
          // "owner/repo" set. No repo means a general (repo-less) concept —
          // deliberately NOT defaulted to the primary repo, so preferences
          // and process guidelines aren't stamped with a repo they don't
          // belong to.
          const repoSlugs = workspace.repositories
            .map((r) => repoSlugFromUrl(r.repositoryUrl))
            .filter((r): r is string => !!r);
          let resolvedRepo: string | undefined;
          if (repo && repo.trim()) {
            const wanted = repo.trim().toLowerCase();
            const match = repoSlugs.find((r) => r.toLowerCase() === wanted);
            if (!match) {
              return {
                error:
                  `Repository '${repo}' is not configured for this workspace. ` +
                  (repoSlugs.length
                    ? `Available: ${repoSlugs.join(", ")}.`
                    : "This workspace has no repositories."),
              };
            }
            resolvedRepo = match;
          }

          // Resolve `person` to a workspace human (github username or display
          // name, case-insensitive, members + owner). The userId lands in the
          // payload so the approval handler can write the
          // member -PREFERENCE-> Concept edge; the display name is card-only.
          let resolvedPerson: { userId: string; name: string } | undefined;
          if (person?.trim()) {
            const found = await resolvePerson(workspace.id, person);
            if (!found.ok) {
              return {
                error:
                  `'${person}' is not a member of the ${workspace.slug} workspace. ` +
                  (found.available.length
                    ? `Members: ${found.available.join(", ")}.`
                    : "No members found."),
              };
            }
            resolvedPerson = { userId: found.userId, name: found.name };
          }

          return {
            kind: "conceptCreate" as const,
            proposalId: nanoid(),
            payload: {
              workspaceId: workspace.id,
              workspaceSlug: workspace.slug,
              name: name.trim(),
              documentation,
              ...(description && { description }),
              ...(resolvedRepo && { repo: resolvedRepo }),
              ...(parent?.trim() && { parent: parent.trim() }),
              ...(kind && { kind }),
              ...(resolvedPerson && { personUserId: resolvedPerson.userId }),
            },
            meta: {
              workspaceName: workspace.name,
              workspaceSlug: workspace.slug,
              ...(resolvedRepo && { repo: resolvedRepo }),
              ...(kind && { kind }),
              ...(resolvedPerson && { personName: resolvedPerson.name }),
            },
            ...(rationale && { rationale }),
          };
        } catch (e) {
          console.error("[conceptTools.propose_new_concept] error:", e);
          const message =
            e instanceof Error ? e.message : "Failed to propose concept";
          return { error: message };
        }
      },
    }),

    [PROPOSE_CONCEPT_UPDATE_TOOL]: tool({
      description:
        "Propose updating an existing concept's documentation. Emits an " +
        "approvable card with a before/after diff — nothing is written " +
        "until the user approves. Use this when the user asks you to " +
        "update, extend, correct, or add to something already captured in a " +
        "concept (including 'Jamie, remember this' when a relevant concept " +
        "already exists). Call `list_concepts` / `learn_concept` (or the " +
        "workspace-prefixed variants) FIRST to obtain the concept id and " +
        "its current documentation — supply the FULL new documentation body " +
        "(the update replaces the whole documentation field).",
      inputSchema: z.object({
        workspaceSlug: z
          .string()
          .min(1)
          .describe(
            "Slug of the workspace the concept belongs to (from the " +
              "Available Workspaces list). Required.",
          ),
        conceptId: z
          .string()
          .min(1)
          .describe(
            "The concept id to update (obtain via `list_concepts` / " +
              "`learn_concept`). Never fabricate this.",
          ),
        documentation: z
          .string()
          .min(1)
          .describe(
            "The FULL proposed new documentation body (markdown). Replaces " +
              "the concept's entire documentation field — include the " +
              "existing content you want to keep, not just the delta.",
          ),
        rationale: z
          .string()
          .optional()
          .describe("Why this change is being proposed — shown on the card."),
      }),
      execute: async ({
        workspaceSlug,
        conceptId,
        documentation,
        rationale,
      }: {
        workspaceSlug: string;
        conceptId: string;
        documentation: string;
        rationale?: string;
      }) => {
        try {
          const workspace = await resolveWorkspace(orgId, workspaceSlug);
          if (!workspace) {
            return {
              error:
                "Workspace slug not found in this organization. Pick a slug from the Available Workspaces list.",
            };
          }

          const swarm = await getSwarmAccessByWorkspaceId(workspace.id);
          if (!swarm.success) {
            return {
              error: `The ${workspace.slug} swarm is not available (${swarm.error.type}).`,
            };
          }

          // Fetch the current documentation for the diff "before". This is
          // render-only; the approval handler re-reads/writes on approval.
          let oldStr = "";
          let conceptName: string | undefined;
          try {
            const res = await fetch(
              `${swarm.data.swarmUrl}/gitree/concepts/${encodeURIComponent(conceptId)}`,
              {
                method: "GET",
                headers: {
                  "Content-Type": "application/json",
                  "x-api-token": swarm.data.swarmApiKey,
                },
              },
            );
            if (res.status === 404) {
              return {
                error: `Concept '${conceptId}' not found in ${workspace.slug}. Use list_concepts to find the correct id.`,
              };
            }
            if (!res.ok) {
              return {
                error: `Failed to read concept '${conceptId}' from ${workspace.slug} (status ${res.status}).`,
              };
            }
            const data = await res.json();
            const concept = data?.concept ?? data?.feature ?? {};
            oldStr = typeof concept.documentation === "string" ? concept.documentation : "";
            conceptName = typeof concept.name === "string" ? concept.name : undefined;
          } catch (e) {
            console.error(
              "[conceptTools.propose_concept_update] read error:",
              e,
            );
            return {
              error: `Could not read the current concept documentation from ${workspace.slug}.`,
            };
          }

          return {
            kind: "conceptUpdate" as const,
            proposalId: nanoid(),
            payload: {
              workspaceId: workspace.id,
              workspaceSlug: workspace.slug,
              conceptId,
              documentation,
            },
            meta: {
              oldStr,
              newStr: documentation,
              ...(conceptName && { conceptName }),
              workspaceSlug: workspace.slug,
            },
            ...(rationale && { rationale }),
          };
        } catch (e) {
          console.error("[conceptTools.propose_concept_update] error:", e);
          const message =
            e instanceof Error ? e.message : "Failed to propose concept update";
          return { error: message };
        }
      },
    }),
  };
}
