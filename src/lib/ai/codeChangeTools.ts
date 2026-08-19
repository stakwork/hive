/**
 * `propose_code_change` tool — read-only preview of a real unified diff.
 *
 * Builds a `buildCodeChangeTools(ctx)` factory that fits the standard
 * capability-registry `buildTools` contract so it can be registered in
 * `capabilities.ts` under the `code_change` capability.
 *
 * ## What this tool does
 *
 * 1. Validates the caller-supplied `repositoryUrl` against the DB — must
 *    belong to the workspace and the workspace must have exactly one repo.
 * 2. Fetches `baseBranchDisplay` live from GitHub (default_branch) rather
 *    than trusting `Repository.branch`.
 * 3. Runs a **read-only** `repo_agent` call without `toolsConfig.create_pr`
 *    (structural guarantee — `create_pr` is never registered).
 * 4. Passes the extracted diff through `diffHygiene` (parse, caps, secrets).
 * 5. Computes SHA-256 over the approved diff bytes.
 * 6. Returns a `ProposalOutput` of `kind: "codeChange"`.
 *
 * ## Security invariants
 *
 * - `toolsConfig.create_pr` is **never** included in the swarm request —
 *   this is a structural guarantee, not a naming convention.
 * - A `secrets_found` hygiene hit discards the diff immediately and returns
 *   a clean refusal. The bytes never reach a log or transcript.
 * - The full diff is returned on `payload.diff` (the approval handler needs
 *   those exact bytes), and `toModelMessages` truncates it on the way into
 *   model messages so a 200 KB diff does not re-enter LLM context on every
 *   turn.
 */

import crypto from "crypto";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  repoAgent,
  REPO_AGENT_CANCELLED_MARKER,
} from "@/lib/ai/askTools";
import {
  parseUnifiedDiff,
  enforceDiffCaps,
  scanForSecrets,
  unifiedDiffToActionResults,
} from "@/lib/github/diffHygiene";
import { getBifrostForLLM } from "@/services/bifrost/orchestrator";
import { parseGithubOwnerRepo } from "@/utils/repositoryParser";
import type { CapabilityContext } from "@/lib/ai/capabilities";
import { PROPOSE_CODE_CHANGE_TOOL } from "@/lib/proposals/types";
import type { ProposalOutput } from "@/lib/proposals/types";
import { EncryptionService } from "@/lib/encryption";

// ─── Helpers ──────────────────────────────────────────────────────────────

/** SHA-256 hex digest of the diff bytes (UTF-8 encoded). */
function sha256Hex(text: string): string {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Fetch the GitHub default branch for a repo via a plain authenticated GET.
 * Falls back to "main" on any error so a PAT scope issue doesn't block preview.
 */
async function fetchDefaultBranch(
  owner: string,
  repo: string,
  pat: string,
): Promise<string> {
  try {
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${pat}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) return "main";
    const data = (await res.json()) as { default_branch?: string };
    return data.default_branch ?? "main";
  } catch {
    return "main";
  }
}

// ─── Tool factory ─────────────────────────────────────────────────────────

export function buildCodeChangeTools(ctx: CapabilityContext): ToolSet {
  return {
    [PROPOSE_CODE_CHANGE_TOOL]: tool({
      description:
        "Generate a real unified diff preview for a proposed code change " +
        "in a single repository, then surface it as an approvable proposal card. " +
        "The swarm runs a read-only analysis — no PR is opened during preview. " +
        "The user reviews the diff and clicks Approve to land it as a PR. " +
        "**Requires exactly one repository in the workspace.** " +
        "If the workspace has multiple repos, use `propose_feature` instead " +
        "(the feature pipeline resolves the repo context). " +
        "Do NOT use this for database migrations, schema changes, or large " +
        "multi-file refactors — use `propose_feature` for those.",
      inputSchema: z.object({
        workspaceSlug: z
          .string()
          .describe("The workspace slug that owns the target repository."),
        repositoryUrl: z
          .string()
          .url()
          .describe(
            "HTTPS URL of the GitHub repository to patch " +
              "(e.g. https://github.com/org/repo). " +
              "Must be the single repository registered in the workspace.",
          ),
        title: z
          .string()
          .min(1)
          .max(256)
          .describe(
            "Short PR title (no leading dash). " +
              "The [Jamie] prefix is added automatically.",
          ),
        body: z
          .string()
          .max(65536)
          .default("")
          .describe("PR body / description (markdown)."),
        prompt: z
          .string()
          .min(1)
          .describe(
            "Instruction for the swarm's repo_agent describing the exact change " +
              "to make. Be specific: filenames, function names, what to add/remove. " +
              "The agent will apply the change and output a git diff.",
          ),
      }),
      execute: async ({
        workspaceSlug,
        repositoryUrl,
        title,
        body,
        prompt,
      }): Promise<ProposalOutput | { error: string }> => {
        // ── 1. Workspace + repository validation ──────────────────────
        const workspace = await db.workspace.findUnique({
          where: { slug: workspaceSlug },
          select: {
            id: true,
            name: true,
            sourceControlOrg: { select: { id: true } },
            swarm: { select: { swarmUrl: true, swarmApiKey: true } },
            members: {
              where: { userId: ctx.userId },
              select: { userId: true },
            },
          },
        });
        if (!workspace) {
          return { error: `Workspace '${workspaceSlug}' not found.` };
        }

        // Authorization: verify ctx.userId is a member of this workspace
        // before any credentials or swarm keys are accessed.
        if (workspace.members.length === 0) {
          return {
            error:
              "You do not have access to workspace '" + workspaceSlug + "'.",
          };
        }

        // Org-membership check: ctx.orgId is the SourceControlOrg.id the
        // caller already validated. Refuse cross-org requests.
        if (
          ctx.orgId &&
          workspace.sourceControlOrg &&
          workspace.sourceControlOrg.id !== ctx.orgId
        ) {
          return {
            error:
              "Repository does not belong to the active org. " +
              "Use `propose_feature` for cross-org changes.",
          };
        }

        // Validate the requested repositoryUrl belongs to this workspace.
        const dbRepo = await db.repository.findFirst({
          where: { workspaceId: workspace.id, repositoryUrl },
          select: { id: true, name: true, repositoryUrl: true },
        });
        if (!dbRepo) {
          return {
            error:
              `Repository '${repositoryUrl}' is not registered in ` +
              `workspace '${workspaceSlug}'. Add it via workspace Settings first.`,
          };
        }

        // Refuse multi-repo ambiguity — server-side enforcement mirrors the
        // prompt guidance that routes multi-repo work to `propose_feature`.
        const repoCount = await db.repository.count({
          where: { workspaceId: workspace.id },
        });
        if (repoCount > 1) {
          return {
            error:
              "This workspace has multiple repositories. " +
              "`propose_code_change` requires exactly one — " +
              "use `propose_feature` so the feature pipeline can resolve " +
              "the correct repository context.",
          };
        }

        // ── 2. Swarm credentials ───────────────────────────────────────
        if (!workspace.swarm?.swarmUrl || !workspace.swarm.swarmApiKey) {
          return {
            error: `Swarm not configured for workspace '${workspaceSlug}'.`,
          };
        }

        let swarmApiKey: string;
        try {
          swarmApiKey = EncryptionService.getInstance().decryptField(
            "swarmApiKey",
            workspace.swarm.swarmApiKey,
          );
        } catch {
          return {
            error: "Failed to decrypt swarm credentials for this workspace.",
          };
        }

        const swarmUrlRaw = workspace.swarm.swarmUrl;
        const swarmUrlObj = new URL(swarmUrlRaw);
        const swarmUrl = swarmUrlRaw.includes("localhost")
          ? "http://localhost:3355"
          : `https://${swarmUrlObj.hostname}:3355`;

        // ── 3. GitHub PAT ──────────────────────────────────────────────
        const { getGithubUsernameAndPAT } = await import(
          "@/lib/auth/nextauth"
        );
        const githubProfile = await getGithubUsernameAndPAT(
          ctx.userId,
          workspaceSlug,
        );
        const pat = githubProfile?.token ?? "";

        // ── 4. Fetch live baseBranchDisplay from GitHub ────────────────
        // Do NOT use Repository.branch — it's Hive-configured and may differ
        // from what the swarm will actually branch from.
        let baseBranchDisplay = "main";
        try {
          const { owner, repo } = parseGithubOwnerRepo(repositoryUrl);
          baseBranchDisplay = await fetchDefaultBranch(owner, repo, pat);
        } catch {
          // Non-fatal: display value only.
        }

        // ── 5. Bifrost routing for cost attribution ────────────────────
        const bifrost = await getBifrostForLLM(
          {
            workspaceId: workspace.id,
            workspaceSlug,
            userId: ctx.userId,
          },
          { agentName: "repo-agent" },
        );

        // ── 6. Abort/active-run hooks ──────────────────────────────────
        const convId = ctx.currentCanvasConversationId;
        let activeRequestId: string | undefined;
        const hooks = convId
          ? await (async () => {
              const {
                setActiveRun,
                isAbortRequestedForRun,
                notifyRunActive,
              } = await import("@/services/canvas-active-runs-hooks");
              return {
                onRequestId: async (requestId: string) => {
                  activeRequestId = requestId;
                  await setActiveRun(
                    convId,
                    {
                      requestId,
                      workspaceId: workspace.id,
                      startedAt: new Date().toISOString(),
                    },
                    requestId, // turnId fallback
                  );
                  await notifyRunActive(convId, true);
                },
                isAbortRequested: async () =>
                  isAbortRequestedForRun(convId, activeRequestId ?? ""),
              };
            })()
          : undefined;

        // ── 7. READ-ONLY repo_agent call ───────────────────────────────
        // `toolsConfig.create_pr` is INTENTIONALLY ABSENT — structural
        // guarantee that no PR is opened during this preview run.
        const agentPrompt =
          `${prompt}\n\n` +
          `Repository: ${repositoryUrl}\n` +
          `IMPORTANT: This is a READ-ONLY preview run. Do NOT push any branch ` +
          `or open a pull request. Apply the change locally using apply_patch ` +
          `or git apply, then output the full unified diff by running: git diff HEAD\n` +
          `Output ONLY the raw unified diff (starting with "--- " / "+++ ") ` +
          `with no additional commentary after it.`;

        let rawResult:
          | Record<string, string>
          | typeof REPO_AGENT_CANCELLED_MARKER;
        try {
          rawResult = await repoAgent(
            swarmUrl,
            swarmApiKey,
            {
              repo_url: repositoryUrl,
              prompt: agentPrompt,
              pat,
              // `toolsConfig.create_pr` deliberately absent.
            },
            bifrost,
            hooks,
          );
        } catch {
          return {
            error:
              "The code-change preview timed out or the swarm returned an error. " +
              "For large or multi-file changes, use `propose_feature` so the " +
              "work runs as a background task instead.",
          };
        } finally {
          if (convId && activeRequestId) {
            const { clearActiveRun, notifyRunActive } = await import(
              "@/services/canvas-active-runs-hooks"
            );
            const { wasLast } = await clearActiveRun(
              convId,
              activeRequestId,
            ).catch(() => ({ wasLast: true }));
            if (wasLast) await notifyRunActive(convId, false).catch(() => {});
          }
        }

        if (rawResult === REPO_AGENT_CANCELLED_MARKER) {
          return {
            error:
              "Code-change preview was cancelled. " +
              "For large changes, use `propose_feature` instead.",
          };
        }

        // ── 8. Extract unified diff from swarm output ──────────────────
        const agentOutput =
          typeof rawResult.content === "string"
            ? rawResult.content
            : JSON.stringify(rawResult);

        // Grab the first unified-diff block from the output.
        const diffMatch = agentOutput.match(
          /(---[ \t][^\n]+\n\+\+\+[ \t][^\n]+[\s\S]*)/,
        );
        const rawDiff = diffMatch
          ? diffMatch[1].trimEnd()
          : agentOutput.trim();

        // ── 9. diffHygiene validation ──────────────────────────────────
        const parseResult = parseUnifiedDiff(rawDiff);
        if (!parseResult.ok) {
          return {
            error:
              `The swarm did not return a valid unified diff ` +
              `(${parseResult.code}: ${parseResult.message}). ` +
              "Try a more specific prompt, or use `propose_feature` for " +
              "complex changes.",
          };
        }

        const capsResult = enforceDiffCaps(rawDiff);
        if (!capsResult.ok) {
          return {
            error:
              `Diff exceeds size limits (${capsResult.code}). ` +
              "Use `propose_feature` — the feature pipeline handles large changes.",
          };
        }

        const secretsResult = scanForSecrets(rawDiff);
        if (!secretsResult.ok) {
          // Hard rule: never return or persist a diff containing credentials.
          // The bytes are discarded here.
          return {
            error:
              "The diff contains patterns matching known credentials. " +
              "Review the change manually and ensure no secrets are included " +
              "before proposing.",
          };
        }

        // ── 10. diffSha256 ─────────────────────────────────────────────
        const diffSha256 = sha256Hex(rawDiff);

        // ── 11. Convert diff to ActionResult[] for DiffContent card ────
        let repoName: string;
        try {
          const { owner, repo } = parseGithubOwnerRepo(repositoryUrl);
          repoName = `${owner}/${repo}`;
        } catch {
          repoName = dbRepo.name ?? repositoryUrl;
        }

        const diffs = unifiedDiffToActionResults(rawDiff, repoName);

        // ── 12. Build ProposalOutput (kind: "codeChange") ──────────────
        const proposalId = crypto.randomUUID();

        // The payload carries the full diff for the approval handler to
        // re-verify and forward to the swarm's create_pr.
        const output: ProposalOutput = {
          kind: "codeChange",
          proposalId,
          payload: {
            workspaceId: workspace.id,
            workspaceSlug,
            repositoryUrl,
            title: title.replace(/[\r\n]+/g, " ").trim(),
            body,
            diff: rawDiff,
            diffSha256,
            filesChanged: diffs.length,
            baseBranchDisplay,
          },
          // Stamped server-side from the tool's own context — never a caller
          // input. The approval handler reads this back off the STORED
          // transcript to enforce that only the originator can approve.
          originatorUserId: ctx.userId,
          rationale:
            `Preview diff for '${title}' — ${diffs.length} file(s) changed. ` +
            `Base branch: ${baseBranchDisplay}. ` +
            `Diff SHA-256: ${diffSha256.slice(0, 16)}…`,
          meta: {
            repoName,
            workspaceName: workspace.name,
            workspaceSlug,
          },
        };

        // ── 13. Return ─────────────────────────────────────────────────
        // `payload.diff` carries the FULL bytes: they are persisted on
        // `CanvasChatMessage.toolCalls[].output`, which is the only place
        // the approved diff lives, and the approval handler re-hashes them
        // against `diffSha256`. Keeping the model's context from carrying
        // those bytes on every later turn is handled at the replay boundary
        // (`toModelMessages` in `@/lib/ai/conversationHelpers`), which
        // truncates the diff on the way into model messages while leaving
        // the stored row intact.
        return output;
      },
    }),
  };
}
