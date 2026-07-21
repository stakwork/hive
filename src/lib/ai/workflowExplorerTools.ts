/**
 * `workflow_explorer_agent` — a read-only research sub-agent over the
 * Stakwork workflow library.
 *
 * Unlike the per-workspace `repo_agent` tool (built in `askTools` from the
 * acting workspace's swarm), this tool ALWAYS targets the hardcoded
 * `stakwork` workspace's swarm — that swarm's Jarvis knowledge graph holds
 * the canonical library of Stakwork Workflows, Skills, and Scripts. It
 * invokes the swarm's `/repo/agent` endpoint with `mode: "workflow"`, a
 * persona specialized for researching those node types (IO-schema semantic
 * search, reading workflow recipes) so the canvas agent can ground new
 * workflow designs in proven, reusable building blocks.
 *
 * Composed via the `workflows` capability, which is org-gated to the
 * Stakwork source-control org (see `capabilities.ts`) — other orgs' agents
 * never see this tool.
 */

import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { config } from "@/config/env";
import { repoAgent } from "./askTools";

/** The workspace whose swarm hosts the Jarvis workflow-library graph. */
const WORKFLOW_LIBRARY_WORKSPACE_SLUG = "stakwork";

/**
 * Resolve the workflow-library workspace's swarm credentials by slug.
 * Deliberately skips per-user membership validation — the tool is a
 * fixed backend shared by every caller the `workflows` capability gate
 * admits, not a per-user workspace surface. Mirrors the URL/decrypt
 * conventions of `buildWorkspaceConfigs`.
 */
async function resolveWorkflowLibrarySwarm(): Promise<{
  swarmUrl: string;
  swarmApiKey: string;
}> {
  const workspace = await db.workspace.findFirst({
    where: { slug: WORKFLOW_LIBRARY_WORKSPACE_SLUG, deleted: false },
    select: { id: true },
  });
  if (!workspace) {
    throw new Error(
      `Workflow library workspace not found: ${WORKFLOW_LIBRARY_WORKSPACE_SLUG}`,
    );
  }

  const swarm = await db.swarm.findFirst({
    where: { workspaceId: workspace.id },
  });
  if (!swarm?.swarmUrl) {
    throw new Error(
      `Swarm not configured for workspace: ${WORKFLOW_LIBRARY_WORKSPACE_SLUG}`,
    );
  }

  const swarmUrlObj = new URL(swarm.swarmUrl);
  let baseSwarmUrl = `https://${swarmUrlObj.hostname}:3355`;
  if (swarm.swarmUrl.includes("localhost")) {
    baseSwarmUrl = "http://localhost:3355";
  }

  return {
    swarmUrl: baseSwarmUrl,
    swarmApiKey: EncryptionService.getInstance().decryptField(
      "swarmApiKey",
      swarm.swarmApiKey || "",
    ),
  };
}

export function buildWorkflowExplorerTools(): ToolSet {
  return {
    workflow_explorer_agent: tool({
      description:
        "Dispatch a research agent over the Stakwork workflow library (the stakwork workspace's knowledge graph) to find existing Workflows, Skills, and Scripts relevant to a workflow being designed. " +
        "It searches components semantically by what they take as input and produce as output, reads full workflow recipes (step orderings + the skills each step uses), and reports proven, reusable building blocks with usage statistics — plus gaps where nothing exists yet. " +
        "It can also pull ground-truth run data from the Stakwork API: which workflows invoke a skill (with real use counts), recent runs and their success/error states, and the actual params and outputs each step sent — useful for citing working configurations (exact URL formats, variable interpolations) or diagnosing why a similar workflow failed. " +
        "Use it when designing or discussing a NEW Stakwork workflow: e.g. 'what existing skills take a video url as input?', 'is there already a transcription workflow, and how does it compose its steps?', 'show me real params from a successful run that uses AzureOCR'. " +
        "STRICTLY READ-ONLY research — it cannot create or modify workflows. Heavy/slow (minutes): call it ONCE with a complete, self-contained prompt rather than several times.",
      inputSchema: z.object({
        prompt: z
          .string()
          .describe(
            "Self-contained research task for the workflow explorer. State the goal of the workflow being designed, the input/output shapes if known (e.g. 'takes a video url, produces a transcript with timestamps'), and ask for reusable building blocks and gaps.",
          ),
      }),
      execute: async ({ prompt }: { prompt: string }) => {
        try {
          const { swarmUrl, swarmApiKey } = await resolveWorkflowLibrarySwarm();
          // No repo_url: workflow mode works entirely off the swarm's graph.
          // No Bifrost routing either — the acting user generally isn't a
          // member of the stakwork workspace, so we fall back to the swarm's
          // default LLM key rather than minting a cross-workspace VK.
          //
          // STAKWORK_API_KEY is the Stakwork supercustomer token (same one the
          // rest of Hive uses for Stakwork API calls): forwarded server-to-
          // server so the swarm agent can research real run data (skill usage
          // stats, recent runs, per-step params/outputs) across ALL customers'
          // library workflows — per-customer keys 404 on workflows they don't
          // own. Optional: without it the explorer still works, minus the
          // run-research tools.
          const rr = await repoAgent(swarmUrl, swarmApiKey, {
            prompt,
            mode: "workflow",
            stakworkApiKey: config.STAKWORK_API_KEY || undefined,
          });
          return rr.content;
        } catch (e) {
          console.error("Error executing workflow explorer agent:", e);
          return "Could not execute workflow explorer agent";
        }
      },
    }),
  };
}
