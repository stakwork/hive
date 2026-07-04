/**
 * Shared eval-node/edge creation logic for all eval-capture routes.
 *
 * Extracts EvalRequirement, EvalTrigger, HiveAgent upsert, and
 * HAS_REQUIREMENT / HAS_TRIGGER / ATTRIBUTED_TO / EVALUATED edge wiring
 * so both routes and both record-type branches call the same code.
 */
import { randomUUID } from "crypto";
import { addNode, addEdge } from "@/services/swarm/api/nodes";
import { getCaptureAgentSpec } from "@/lib/utils/hive-agent";
import { logger } from "@/lib/logger";
import type { JarvisConnectionConfig } from "@/types/jarvis";
import type { EvalTriggerSource } from "@/lib/utils/eval-source";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CreateEvalNodesOptions {
  nodeConfig: JarvisConnectionConfig;
  evalSetRef: string;
  requirement: string;
  reason?: string | null;
  /** Sliced conversation already turned into a JSON-serialisable prompt snapshot */
  promptSnapshot: string;
  changeType: string;
  evalTriggerSource: EvalTriggerSource;
  resolvedAgent: string;
  scopeKey: string;
  environment: string;
  /** Array of individually JSON-stringified prompt resolution strings */
  metadataPrompts?: string[];
}

export interface CreateEvalNodesResult {
  requirementRef: string;
  triggerRef: string;
  agentName: string;
}

// ── Implementation ────────────────────────────────────────────────────────────

export async function createEvalNodes(
  options: CreateEvalNodesOptions,
): Promise<CreateEvalNodesResult | { error: string; status: number }> {
  const {
    nodeConfig,
    evalSetRef,
    requirement,
    reason,
    promptSnapshot,
    changeType,
    evalTriggerSource,
    resolvedAgent,
    scopeKey,
    environment,
    metadataPrompts = [],
  } = options;

  // 1. Create EvalRequirement node
  const reqResult = await addNode(nodeConfig, {
    node_type: "EvalRequirement",
    node_data: {
      id: randomUUID(),
      name: requirement.trim(),
    },
  });

  if (!reqResult.success || !reqResult.ref_id) {
    logger.error("[AgentEvalCapture] Failed to create EvalRequirement", reqResult.error);
    return { error: "Failed to create requirement", status: 502 };
  }
  const requirementRef = reqResult.ref_id;
  logger.info(`[AgentEvalCapture] EvalRequirement created, ref_id: ${requirementRef}`);

  // 2. Create EvalTrigger node
  const triggerResult = await addNode(nodeConfig, {
    node_type: "EvalTrigger",
    node_data: {
      id: randomUUID(),
      agent: resolvedAgent,
      environment,
      change_type: changeType,
      source: evalTriggerSource,
      start_point: scopeKey,
      end_point: scopeKey,
      body: JSON.stringify({
        prompt_snapshot: promptSnapshot,
        output_snapshot: null,
        tool_call_trace: null,
        feedback_note: reason ?? null,
      }),
      ...(metadataPrompts.length > 0
        ? { prompts: metadataPrompts }
        : {}),
    },
  });

  if (!triggerResult.success || !triggerResult.ref_id) {
    logger.error("[AgentEvalCapture] Failed to create EvalTrigger", triggerResult.error);
    return { error: "Failed to create trigger", status: 502 };
  }
  const triggerRef = triggerResult.ref_id;
  logger.info(`[AgentEvalCapture] EvalTrigger created, ref_id: ${triggerRef}`);

  // 3. Upsert HiveAgent node + ATTRIBUTED_TO edge (non-fatal)
  try {
    const agentSpec = getCaptureAgentSpec(resolvedAgent);
    const hiveAgentResult = await addNode(nodeConfig, {
      node_type: "HiveAgent",
      node_data: {
        name: resolvedAgent,
        display_name: agentSpec.displayName,
        description: agentSpec.description,
      },
    });
    logger.info(
      `[AgentEvalCapture] HiveAgent upsert: success=${hiveAgentResult.success} alreadyExists=${hiveAgentResult.alreadyExists ?? false} ref_id=${hiveAgentResult.ref_id ?? "n/a"}`,
    );

    if (hiveAgentResult.success) {
      const attrEdgeResult = await addEdge(nodeConfig, {
        edge: { edge_type: "ATTRIBUTED_TO" },
        source: { ref_id: triggerRef },
        target: { node_type: "HiveAgent", node_data: { name: resolvedAgent } },
      });
      logger.info(`[AgentEvalCapture] ATTRIBUTED_TO edge: success=${attrEdgeResult.success}`);
      if (!attrEdgeResult.success) {
        logger.warn(`[AgentEvalCapture] ATTRIBUTED_TO edge failed (non-fatal): ${attrEdgeResult.error}`);
      }
    } else {
      logger.warn(`[AgentEvalCapture] HiveAgent upsert failed (non-fatal): ${hiveAgentResult.error}`);
    }
  } catch (err) {
    logger.warn(`[AgentEvalCapture] HiveAgent/ATTRIBUTED_TO step threw (non-fatal): ${String(err)}`);
  }

  // 4. EvalSet -[HAS_REQUIREMENT]-> EvalRequirement
  await addEdge(nodeConfig, {
    edge: { edge_type: "HAS_REQUIREMENT" },
    source: { ref_id: evalSetRef },
    target: { ref_id: requirementRef },
  });
  logger.info("[AgentEvalCapture] HAS_REQUIREMENT edge created");

  // 5. EvalRequirement -[HAS_TRIGGER]-> EvalTrigger
  await addEdge(nodeConfig, {
    edge: { edge_type: "HAS_TRIGGER" },
    source: { ref_id: requirementRef },
    target: { ref_id: triggerRef },
  });
  logger.info("[AgentEvalCapture] HAS_TRIGGER edge created");

  return { requirementRef, triggerRef, agentName: resolvedAgent };
}
