import { NextRequest, NextResponse } from "next/server";
import { randomUUID, createHmac } from "crypto";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { validateWorkspaceAccess } from "@/services/workspace";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";
import { transformSwarmUrlToRepo2Graph } from "@/lib/utils/swarm";
import { db } from "@/lib/db";
import { optionalEnvVars } from "@/config/env";
import { getJarvisConfigForWorkspace } from "@/lib/helpers/jarvis-config";
import { fetchHarveyTaskCriteria, ensureHarveyLabEvalNodes } from "@/lib/harvey-lab/eval-nodes";
import { addNode, addEdge } from "@/services/swarm/api/nodes";
import { getBifrostForLLM } from "@/services/bifrost/orchestrator";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import {
  getApiKeyForModel,
  isValidModel,
  DEFAULT_BENCHMARK_MODEL,
  DEFAULT_JUDGE_MODEL,
  DEFAULT_STANDARD_MODEL,
  DEFAULT_REASONING_MODEL,
  PROVIDER_API_KEY_ENV_VARS,
} from "@/lib/ai/models";
import { getStakworkTokenReference } from "@/lib/vercel/stakwork-token";
import {
  STRUT_ACTOR_HEADER,
  ensureStrutDelegation,
  resolveStrutActor,
} from "@/services/bifrost/strut-delegation";
import { WorkflowStatus, StakworkRunType, LlmProvider } from "@prisma/client";

type RouteParams = {
  params: Promise<{ slug: string }>;
};

interface TaskJson {
  title: string;
  instructions: string;
  work_type?: string;
  tags?: string[];
  deliverables?: Record<string, string>;
  criteria?: Array<{ id: string; title: string; match_criteria: string; deliverables?: string[] }>;
}

const HARVEY_BASE = "https://raw.githubusercontent.com/stakwork/harvey-labs/main";
const GITHUB_API = "https://api.github.com/repos/stakwork/harvey-labs/contents";

/** 30-minute staleness threshold for active runs. */
const STALE_RUN_THRESHOLD_MS = 30 * 60 * 1000;

/**
 * Minimum acceptable length for NEXTAUTH_SECRET before we trust it to sign a
 * run_token. A missing or too-short secret must never silently degrade to a
 * forgeable token — processStakworkRunWebhook rejects verification below this.
 */
const MIN_RUN_TOKEN_SECRET_LENGTH = 32;

/**
 * Bound on how many candidate active-run rows we scan per dispatch. taskSlug
 * lives inside serialized `result` JSON, so an unbounded scan would JSON-parse
 * every active LEGAL_BENCHMARK_RUNNER row inside the transaction.
 */
const ACTIVE_RUN_SCAN_LIMIT = 25;

/** Where a legal benchmark run executes. Absent in a request body = "stakwork". */
type LegalBenchmarkRunner = "stakwork" | "strut";
const LEGAL_BENCHMARK_RUNNERS: ReadonlySet<string> = new Set<LegalBenchmarkRunner>([
  "stakwork",
  "strut",
]);

/**
 * Published strut workflow name. Left unset on purpose: do not hardcode
 * harvey-produce or harvey-score. Those names are not in this repo, and the
 * published contract (accepts documents_json, does not call harvey/get-task)
 * is unconfirmed. A strut start with the name unset, empty, or failing the
 * regex returns 503 and creates no row.
 */
const LEGAL_STRUT_WORKFLOW_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Allowed characters for a Harvey LAB task slug.
 * Mirrors the constant in src/services/legal-benchmark-eval.ts to close the
 * path-traversal / URL-injection hole that exists when taskSlug is interpolated
 * directly into GitHub Contents and raw.githubusercontent.com URLs.
 */
const TASK_SLUG_RE = /^[a-z0-9_\-/]+$/i;
const githubHeaders: HeadersInit = {
  Accept: "application/vnd.github+json",
  ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
};

function handleSwarmAccessError(error: { type: string }) {
  const errorMap: Record<string, { message: string; status: number }> = {
    WORKSPACE_NOT_FOUND: { message: "Workspace not found", status: 404 },
    ACCESS_DENIED: { message: "Access denied", status: 403 },
    SWARM_NOT_ACTIVE: { message: "Swarm not active", status: 400 },
    SWARM_NAME_MISSING: { message: "Swarm name not found", status: 400 },
    SWARM_API_KEY_MISSING: { message: "Swarm API key not configured", status: 400 },
    SWARM_NOT_CONFIGURED: { message: "Swarm not configured", status: 400 },
  };
  const errorInfo = errorMap[error.type] || { message: "Unknown error", status: 500 };
  return NextResponse.json({ error: errorInfo.message }, { status: errorInfo.status });
}

/** Strip the "provider/" prefix to get the bare model name for the Stakwork runner. */
function bareModelName(model: string): string {
  return model.includes("/") ? model.split("/").slice(1).join("/") : model;
}

/**
 * POST /api/workspaces/[slug]/legal/benchmarks/run
 *
 * Start a Harvey LAB Task Runner workflow for a selected benchmark task.
 * Creates a single LEGAL_BENCHMARK_RUNNER StakworkRun row atomically,
 * then dispatches to the Harvey /projects endpoint.
 * Gated to the `openlaw` workspace only.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const context = getMiddlewareContext(request);
    const userOrResponse = requireAuth(context);
    if (userOrResponse instanceof NextResponse) return userOrResponse;

    const { slug } = await params;
    const userId = userOrResponse.id;

    if (slug !== "openlaw") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // IDOR: confirm the caller can write THIS workspace before any DB write,
    // secret access, or third-party call. 404, not 403 — no existence leak.
    const access = await validateWorkspaceAccess(slug, userId, true, {});
    if (!access.canWrite) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Fail closed. Before GitHub fetches, model catalog checks, Bifrost
    // resolution, or row creation.
    let rl: { allowed: boolean; retryAfter?: number };
    try {
      rl = await checkRateLimit(`legal-benchmark-run:${userId}`, 10, 60);
    } catch {
      return NextResponse.json(
        { error: "Rate limit service unavailable" },
        { status: 503 },
      );
    }
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests", retryAfter: rl.retryAfter },
        { status: 429 },
      );
    }

    const swarmResult = await getWorkspaceSwarmAccess(slug, userId);
    if (!swarmResult.success) {
      return handleSwarmAccessError(swarmResult.error);
    }

    const { workspaceId, swarmSecretAlias, swarmUrl, swarmApiKey } = swarmResult.data;

    // ── Parse + validate body (BEFORE Bifrost resolution) ─────────────────────
    let body: {
      taskSlug?: string;
      taskTitle?: string;
      model?: string;
      judgeModel?: string;
      standardModel?: string;
      reasoningModel?: string;
      generateJamieChat?: boolean;
      generateRunReport?: boolean;
      runner?: string;
    };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // Absent means stakwork. Reject anything else before any write.
    const runner: LegalBenchmarkRunner =
      body.runner === undefined ? "stakwork" : (body.runner as LegalBenchmarkRunner);
    if (!LEGAL_BENCHMARK_RUNNERS.has(runner)) {
      return NextResponse.json(
        { error: 'runner must be "stakwork" or "strut"' },
        { status: 400 },
      );
    }

    const { taskSlug, taskTitle } = body;
    if (!taskSlug || !taskTitle) {
      return NextResponse.json(
        { error: "taskSlug and taskTitle are required" },
        { status: 400 },
      );
    }

    // Validate taskSlug format — closes the path-traversal / URL-injection hole
    // that would otherwise exist when the raw value is interpolated into GitHub
    // Contents and raw.githubusercontent.com URLs below. The sibling service
    // (legal-benchmark-eval.ts) gates its equivalent slug usages on the same regex.
    if (typeof taskSlug !== "string" || !TASK_SLUG_RE.test(taskSlug)) {
      return NextResponse.json({ error: "Invalid taskSlug" }, { status: 400 });
    }

    // Validate taskTitle — both fields reach outbound URLs or LLM workflow prompt
    // vars, so tighten beyond the falsy check above.
    if (
      typeof taskTitle !== "string" ||
      taskTitle.trim().length === 0 ||
      taskTitle.length > 300
    ) {
      return NextResponse.json({ error: "Invalid taskTitle" }, { status: 400 });
    }

    // Apply defaults for model selection
    const model = body.model ?? DEFAULT_BENCHMARK_MODEL;
    const judgeModel = body.judgeModel ?? DEFAULT_JUDGE_MODEL;
    const generateJamieChat = body.generateJamieChat === true;
    const generateRunReport = body.generateRunReport === true;

    // Validate: isValidModel + Anthropic-only gate + DB catalog membership
    const validateModel = async (m: string, label: string): Promise<NextResponse | null> => {
      if (!isValidModel(m)) {
        return NextResponse.json(
          { error: `Invalid ${label}: "${m}"` },
          { status: 400 },
        );
      }
      if (!m.startsWith("anthropic/")) {
        return NextResponse.json(
          { error: `${label} must be an Anthropic model (got "${m}")` },
          { status: 400 },
        );
      }
      const namePart = bareModelName(m);
      const dbModels = await db.llmModel.findMany({
        where: {
          isPublic: true,
          provider: LlmProvider.ANTHROPIC,
          OR: [{ dateEnd: null }, { dateEnd: { gt: new Date() } }],
        },
        select: { name: true },
      });
      const knownNames = dbModels.map((r) => r.name);
      if (!knownNames.includes(namePart)) {
        return NextResponse.json(
          { error: `${label} "${m}" is not in the available model catalog` },
          { status: 400 },
        );
      }
      return null;
    };

    const modelErr = await validateModel(model, "model");
    if (modelErr) return modelErr;
    const judgeModelErr = await validateModel(judgeModel, "judgeModel");
    if (judgeModelErr) return judgeModelErr;

    // ── standard_model / reasoning_model pair (new workflow contract) ─────────
    // Both must come from the same provider so the single `apiKey` set_var,
    // resolved from that provider's hive env credential, is correct for both.
    const standardModel = body.standardModel ?? DEFAULT_STANDARD_MODEL;
    const reasoningModel = body.reasoningModel ?? DEFAULT_REASONING_MODEL;

    const validatePairedModel = (m: unknown, label: string): NextResponse | null => {
      if (typeof m !== "string" || !isValidModel(m) || !m.includes("/")) {
        return NextResponse.json(
          { error: `Invalid ${label}: "${String(m)}"` },
          { status: 400 },
        );
      }
      // The prefix is either a native LlmProvider enum value (anthropic/…) or a
      // normalized OTHER-provider label (openrouter/… — stored as provider=OTHER
      // with providerLabel "OpenRouter"). Either way it must map to an env key.
      const provider = m.split("/")[0].toUpperCase();
      if (!PROVIDER_API_KEY_ENV_VARS[provider]) {
        return NextResponse.json(
          { error: `${label} provider "${provider}" is not supported` },
          { status: 400 },
        );
      }
      // XAI is explicitly excluded from the standard/reasoning pair: the
      // judge model is Anthropic-only by this route's contract (see
      // validateModel above), and pairing a single xAI apiKey with an
      // Anthropic-only judge isn't supported — the run would need two
      // provider credentials, not one. Revisit once paired-model key
      // handling supports two providers.
      if (provider === "XAI") {
        return NextResponse.json(
          { error: `${label} provider "XAI" is not yet supported for benchmark runs` },
          { status: 400 },
        );
      }
      return null;
    };

    const standardErr = validatePairedModel(standardModel, "standardModel");
    if (standardErr) return standardErr;
    const reasoningErr = validatePairedModel(reasoningModel, "reasoningModel");
    if (reasoningErr) return reasoningErr;

    const pairProvider = standardModel.split("/")[0].toUpperCase();
    if (pairProvider !== reasoningModel.split("/")[0].toUpperCase()) {
      return NextResponse.json(
        { error: "standardModel and reasoningModel must be from the same provider" },
        { status: 400 },
      );
    }

    // DB catalog membership for the pair (mirrors validateModel, provider-aware).
    // Providers outside the LlmProvider enum (e.g. OPENROUTER) are stored as
    // OTHER with a providerLabel; match those rows by the getModelValue()-style
    // normalized label.
    {
      const isEnumProvider = pairProvider in LlmProvider;
      const dbModels = await db.llmModel.findMany({
        where: {
          isPublic: true,
          provider: isEnumProvider ? (pairProvider as LlmProvider) : LlmProvider.OTHER,
          OR: [{ dateEnd: null }, { dateEnd: { gt: new Date() } }],
        },
        select: { name: true, providerLabel: true },
      });
      const matchingModels = isEnumProvider
        ? dbModels
        : dbModels.filter(
            (r) =>
              (r.providerLabel ?? "").toLowerCase().replace(/\s+/g, "") ===
              pairProvider.toLowerCase(),
          );
      const knownNames = matchingModels.map((r) => r.name);
      for (const [value, label] of [
        [standardModel, "standardModel"],
        [reasoningModel, "reasoningModel"],
      ] as const) {
        if (!knownNames.includes(bareModelName(value))) {
          return NextResponse.json(
            { error: `${label} "${value}" is not in the available model catalog` },
            { status: 400 },
          );
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // ── Bifrost credential resolution (after body parsing + validation) ───────
    let bifrost: Awaited<ReturnType<typeof getBifrostForLLM>> | undefined;
    try {
      bifrost = await getBifrostForLLM(
        { workspaceId, workspaceSlug: slug, userId: userOrResponse.id },
        { agentName: "plan-agent", model },
      );
    } catch (err) {
      console.warn(
        "[legal/benchmarks/run] Bifrost resolution failed, falling back to env key",
        err,
      );
    }

    const resolvedApiKey = bifrost?.apiKey ?? getApiKeyForModel(model) ?? "";

    // The dispatched `apiKey` var must be correct for the standard/reasoning
    // pair, so resolve it from the pair provider's hive env credential first.
    // Fall back to the legacy (Bifrost/env) resolution only when the pair
    // shares the legacy model's provider — a cross-provider fallback would
    // send a key the runner can't use.
    const pairEnvApiKey = getApiKeyForModel(standardModel);
    const dispatchApiKey =
      pairEnvApiKey ??
      (model.split("/")[0].toUpperCase() === pairProvider ? resolvedApiKey : "");
    if (!dispatchApiKey) {
      console.warn(
        `[legal/benchmarks/run] No API key resolved for standardModel "${standardModel}" — dispatching with empty key (runner may use its own credentials)`,
      );
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Preconditions, still before any write. Order matters: swarmSecretAlias and
    // STAKWORK_HARVEY_RUNNER_WORKFLOW_ID are Stakwork set_var /projects fields
    // only. A strut start must not 500 because either is unset.
    const webhookSecret = process.env.NEXTAUTH_SECRET;
    if (!webhookSecret || webhookSecret.length < MIN_RUN_TOKEN_SECRET_LENGTH) {
      logger.error(
        "[legal/benchmarks/run] NEXTAUTH_SECRET missing or too short — refusing to issue a run_token",
        "legal-benchmarks",
      );
      return NextResponse.json(
        { error: "Service misconfigured: webhook signing secret unavailable" },
        { status: 503 },
      );
    }

    const runnerWorkflowId = process.env.STAKWORK_HARVEY_RUNNER_WORKFLOW_ID;
    if (runner === "stakwork" && !runnerWorkflowId) {
      return NextResponse.json(
        { error: "STAKWORK_HARVEY_RUNNER_WORKFLOW_ID is not configured" },
        { status: 500 },
      );
    }

    if (runner === "stakwork" && !swarmSecretAlias) {
      return NextResponse.json(
        { error: "Swarm secret alias not configured" },
        { status: 500 },
      );
    }

    const strutWorkflowName = process.env.LEGAL_STRUT_WORKFLOW_NAME ?? "";
    if (runner === "strut") {
      if (!LEGAL_STRUT_WORKFLOW_NAME_RE.test(strutWorkflowName)) {
        return NextResponse.json(
          { error: "LEGAL_STRUT_WORKFLOW_NAME is not configured" },
          { status: 503 },
        );
      }
      if (!swarmUrl || !swarmApiKey) {
        return NextResponse.json(
          { error: "Swarm not configured for the strut runner" },
          { status: 503 },
        );
      }
    }

    // agentHost is a Stakwork set_var (swarm_url / repo2graph_url). Strut does
    // not send it. A missing swarm URL on the Stakwork path stays a 400.
    const agentHost = transformSwarmUrlToRepo2Graph(swarmUrl);
    if (runner === "stakwork" && !agentHost) {
      return NextResponse.json(
        { error: "SWARM_URL_MISSING" },
        { status: 400 },
      );
    }

    const jarvisConfig = await getJarvisConfigForWorkspace(workspaceId);
    if (!jarvisConfig) {
      return NextResponse.json({ error: "Swarm not configured for workspace" }, { status: 500 });
    }
    const graphBaseUrl = jarvisConfig.jarvisUrl;

    // Pre-fetch task context for Stakwork workflow vars
    let taskGoal = "";
    let taskOutputDesc = "";
    let canonicalTaskTitle = "";
    let documents: string[] = [];
    let rubrics: NonNullable<TaskJson["criteria"]> = [];

    const [taskJsonRes, docsRes] = await Promise.all([
      fetch(`${HARVEY_BASE}/tasks/${taskSlug}/task.json`),
      fetch(`${GITHUB_API}/tasks/${taskSlug}/documents`, { headers: githubHeaders }),
    ]);

    if (taskJsonRes.ok) {
      try {
        const taskJson = (await taskJsonRes.json()) as TaskJson;
        taskGoal = taskJson.instructions ?? "";
        canonicalTaskTitle = typeof taskJson.title === "string" ? taskJson.title.trim() : "";
        if (taskJson.deliverables && Object.keys(taskJson.deliverables).length > 0) {
          taskOutputDesc = Object.keys(taskJson.deliverables).join(", ");
        } else {
          const outputMatch = taskGoal.match(/###\s*Output[:\s]+([\s\S]+)$/i);
          taskOutputDesc = outputMatch ? outputMatch[1].trim().replace(/`/g, "") : "";
        }
        rubrics = taskJson.criteria ?? [];
      } catch {
        console.error(`[legal/benchmarks/run] Failed to parse task.json for ${taskSlug}`);
      }
    }

    if (docsRes.ok) {
      try {
        const docsData = (await docsRes.json()) as Array<{ type: string; name: string; download_url: string | null }>;
        documents = docsData
          .filter((f) => f.type === "file" && f.download_url !== null)
          .map((f) => f.download_url as string);
      } catch {
        console.error(`[legal/benchmarks/run] Failed to fetch documents for ${taskSlug}`);
      }
    }

    // ── Atomic single-active-run guard + single runner row creation ───────────
    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
    const placeholder = `${baseUrl}/api/webhook/stakwork/response`;

    // Bare model names for storage (no provider prefix)
    const bareModel = bareModelName(model);
    const bareJudgeModel = bareModelName(judgeModel);

    let runnerRun: { id: string };

    // ADVISORY ONLY: this transaction takes no row lock. taskSlug lives only
    // in serialized `result` JSON, so no unique index can enforce
    // single-active-run-per-taskSlug. A concurrent dispatch landing between
    // this read and the create() below can still race through. A partial
    // unique index is out of scope — do not add a migration.
    try {
      runnerRun = await db.$transaction<{ id: string }>(async (tx) => {
        const now = Date.now();

        // Bounded scan, newest first. findFirst (no taskSlug filter, no
        // orderBy) was insufficient: taskSlug lives inside serialized result
        // JSON, so the single row returned may belong to a different task,
        // and a JSON parse failure used to set existingTaskSlug = taskSlug,
        // blocking every task.
        const candidates = await tx.stakworkRun.findMany({
          where: {
            workspaceId,
            type: StakworkRunType.LEGAL_BENCHMARK_RUNNER,
            status: { in: [WorkflowStatus.PENDING, WorkflowStatus.IN_PROGRESS] },
          },
          select: { id: true, result: true, updatedAt: true },
          orderBy: { updatedAt: "desc" },
          take: ACTIVE_RUN_SCAN_LIMIT,
        });

        for (const candidate of candidates) {
          let candidateTaskSlug: string | undefined;
          let malformed = false;
          try {
            const resultJson = candidate.result
              ? (JSON.parse(candidate.result) as Record<string, unknown>)
              : {};
            candidateTaskSlug = resultJson.taskSlug as string | undefined;
          } catch {
            malformed = true;
          }

          const isStale = candidate.updatedAt.getTime() < now - STALE_RUN_THRESHOLD_MS;

          if (malformed) {
            // Owning task slug is unknown. Block only while inside the
            // staleness window. Past that window, ignore it. Never write it:
            // a dispatch for task A must not mutate a row whose owner is unknown.
            if (!isStale) {
              throw Object.assign(new Error("A run is already in progress for this task"), {
                code: "ACTIVE_RUN_EXISTS",
              });
            }
            continue;
          }

          if (candidateTaskSlug !== taskSlug) {
            continue;
          }

          if (isStale) {
            await tx.stakworkRun.update({
              where: { id: candidate.id },
              data: {
                status: WorkflowStatus.FAILED,
                result: JSON.stringify({
                  ...(() => {
                    try {
                      return candidate.result
                        ? (JSON.parse(candidate.result) as Record<string, unknown>)
                        : {};
                    } catch {
                      return {};
                    }
                  })(),
                  staleTimeout: true,
                  reason: "run timed out before webhook arrived",
                }),
              },
            });
            continue;
          }

          throw Object.assign(new Error("A run is already in progress for this task"), {
            code: "ACTIVE_RUN_EXISTS",
          });
        }

        const runnerResultJson: Record<string, unknown> = {
          taskSlug,
          taskTitle,
          // Persist the operator's model choices under clobber-proof keys
          // (the runner never emits requestedModel/requestedJudgeModel, so
          //  the webhook merge cannot overwrite them).
          requestedModel: bareModel,
          requestedJudgeModel: bareJudgeModel,
          // Unlike requestedModel/requestedJudgeModel these keep the provider
          // prefix — the pair can be non-Anthropic, so the provider matters.
          requestedStandardModel: standardModel,
          requestedReasoningModel: reasoningModel,
          // Same clobber-proof guarantee: the runner never emits generateJamieChat,
          // so the completion webhook can read it back and trigger the chat.
          ...(generateJamieChat ? { generateJamieChat: true } : {}),
          // Records that the operator asked for a report bundle. The bundle
          // itself never lands here — it goes to the reportBundle column.
          ...(generateRunReport ? { generateRunReport: true } : {}),
          // Written at create time, only for strut. A crash between create and
          // the lab response must not leave a row indistinguishable from a
          // Stakwork run. A Stakwork start stores no runner field.
          ...(runner === "strut" ? { runner } : {}),
          // evalTriggerRef will be added later (non-fatal Jarvis step)
        };

        const created = await tx.stakworkRun.create({
          data: {
            workspaceId,
            type: StakworkRunType.LEGAL_BENCHMARK_RUNNER,
            status: WorkflowStatus.PENDING,
            webhookUrl: placeholder,
            userId,
            result: JSON.stringify(runnerResultJson),
          },
          select: { id: true },
        });

        return created;
      });
    } catch (err: unknown) {
      if (
        err instanceof Error &&
        (err as Error & { code?: string }).code === "ACTIVE_RUN_EXISTS"
      ) {
        return NextResponse.json(
          { error: "A run is already in progress for this task" },
          { status: 409 },
        );
      }
      throw err;
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Sign with the already-checked NEXTAUTH_SECRET. Same HMAC score URL for
    // both runners. The Stakwork path also keeps statusWebhookUrl on the
    // /projects payload only. Strut has no equivalent caller: the row stays
    // IN_PROGRESS until the score body arrives, or a later start marks it
    // FAILED after 30 minutes. Do not invent a status poller.
    const runToken = createHmac("sha256", webhookSecret).update(runnerRun.id).digest("hex");
    const webhookUrl = `${baseUrl}/api/webhook/stakwork/response?type=${StakworkRunType.LEGAL_BENCHMARK_RUNNER}&run_id=${runnerRun.id}&workspace_id=${workspaceId}&run_token=${runToken}`;
    await db.stakworkRun.update({
      where: { id: runnerRun.id },
      data: { webhookUrl },
    });

    // Status hook receives top-level Stakwork lifecycle callbacks (PENDING → IN_PROGRESS, etc.)
    // while the full scored result still arrives via vars.webhook_url (the run-token'd response URL).
    // This mirrors the pattern used by dispatchLegalBenchmarkEvalRun / dispatchLegalBenchmarkRecursionRun.
    const statusWebhookUrl = `${baseUrl}/api/stakwork/webhook?run_id=${runnerRun.id}`;

    // Prefer the repo-owned title from task.json; fall back to the validated request value
    // when task.json was not fetched (404, network error, or parse failure).
    const resolvedTaskTitle = canonicalTaskTitle || taskTitle.trim();

    // Stakwork payload only. Do not build it for strut, and do not add or
    // remove a set_var. runnerWorkflowId is required only on this path.
    const payload = runner === "stakwork" ? {
      name: `harvey-runner-${runnerRun.id}`,
      workflow_id: parseInt(runnerWorkflowId ?? "0", 10),
      webhook_url: statusWebhookUrl,
      webhook_full_output: false,
      workflow_params: {
        set_var: {
          attributes: {
            vars: {
              task_slug: taskSlug,
              // task_title is resolved from task.json (authoritative) with a fallback to the
              // validated request value. Note: runnerResultJson, ensureHarveyLabEvalNodes, and
              // the EvalTrigger body (~line 460) deliberately continue to use the raw request
              // taskTitle — swapping those would alter persisted records and graph node names,
              // which is out of scope here and tracked separately.
              //
              // Echo-back safety: if the Harvey runner echoes task_title on completion,
              // normalizeLegalBenchmarkPayload nests it under `result`, and the merge in
              // stakwork-run.ts lets incoming fields win. No consumer reads task_title back
              // out of the run result, so an overwrite is inert — no code change needed.
              task_title: resolvedTaskTitle,
              task_goal: taskGoal,
              task_output_desc: taskOutputDesc,
              documents_json: JSON.stringify(documents),
              rubrics_json: JSON.stringify(rubrics),
              webhook_url: webhookUrl,
              graph_base_url: graphBaseUrl,
              swarm_url: agentHost,
              repo2graph_url: agentHost,
              swarm_secret_alias: swarmSecretAlias,
              secret: swarmSecretAlias,
              model: bareModel,
              judge_model: bareJudgeModel,
              // Provider-prefixed (e.g. "anthropic/claude-sonnet-5",
              // "openrouter/stealth/ox-alpha") — the workflow routes by the
              // provider segment; only the legacy model/judge_model vars are bare.
              standard_model: standardModel,
              reasoning_model: reasoningModel,
              // Tells the Harvey runner to build a report bundle and return its
              // S3 URL as `report_url` on the completion webhook. The workflow
              // side of this handshake is a separate Stakwork change; until it
              // lands, setting this is simply a no-op.
              generate_report: generateRunReport,
              apiKey: dispatchApiKey,
              baseUrl: bifrost?.baseUrl ?? "",
              ...(bifrost && Object.keys(bifrost.headers).length > 0
                ? { headers: bifrost.headers }
                : {}),
              tokenReference: getStakworkTokenReference(),
              workspace_id: workspaceId,
            },
          },
        },
      },
    } : null;

    // One dispatch log. Keys only: runner, taskSlug, workflow name, lab-run id.
    // Never log documents, rubrics, model ids, keys, bodies, the webhook URL,
    // or the webhook token. A fetch or JSON error can carry those.
    logger.info("[legal/benchmarks/run] dispatching", "legal-benchmarks", {
      runner,
      taskSlug,
      workflowName: runner === "strut" ? strutWorkflowName : undefined,
    });

    let projectId: number | undefined;
    let strutRunId: string | undefined;

    if (runner === "strut") {
      // Require a confirmed user delegation before spending the workspace
      // swarm key. The helper never throws. The workflow route continues on
      // skipped-gate; legal must not.
      const actor = await resolveStrutActor(userId);
      const delegation = await ensureStrutDelegation(
        { workspaceId, workspaceSlug: slug, userId },
        { swarmUrl, swarmApiKey },
        { actor },
      );
      if (delegation.status !== "fresh" && delegation.status !== "pushed") {
        await deletePendingRun(runnerRun.id);
        return NextResponse.json(
          { error: "Strut delegation unavailable" },
          { status: 503 },
        );
      }

      // labBase is transformSwarmUrlToRepo2Graph(swarmUrl) only. strutLabBaseUrl
      // already appends /lab — do not call it and append /lab again. Interpolate
      // only the regex-checked name.
      const labBase = transformSwarmUrlToRepo2Graph(swarmUrl);
      const labUrl = `${labBase}/lab/workflows/${strutWorkflowName}/run`;
      // Task contract only. Provider keys stay on the Stakwork payload. Strut
      // is expected to use the lab's own credentials. webhook_url is the same
      // HMAC score URL the Stakwork payload sends as vars.webhook_url.
      const strutInput = {
        task_slug: taskSlug,
        task_title: resolvedTaskTitle,
        task_goal: taskGoal,
        task_output_desc: taskOutputDesc,
        documents_json: JSON.stringify(documents),
        rubrics_json: JSON.stringify(rubrics),
        webhook_url: webhookUrl,
        standard_model: standardModel,
        reasoning_model: reasoningModel,
        judge_model: bareJudgeModel,
        graph_base_url: graphBaseUrl,
      };
      const strutResponse = await fetch(labUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-token": swarmApiKey,
          [STRUT_ACTOR_HEADER]: actor,
        },
        body: JSON.stringify({ input: strutInput }),
      });
      if (!strutResponse.ok) {
        await deletePendingRun(runnerRun.id);
        return NextResponse.json(
          { error: "Failed to dispatch job to strut" },
          { status: 502 },
        );
      }
      const strutData = (await strutResponse.json().catch(() => ({}))) as { runId?: unknown };
      strutRunId =
        typeof strutData?.runId === "string" && strutData.runId ? strutData.runId : undefined;
      // Do not write project_id from the lab body. Do not build strutRunUrl.
      projectId = undefined;
    } else {
      const stakworkResponse = await fetch(`${optionalEnvVars.STAKWORK_BASE_URL}/projects`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token token="${optionalEnvVars.STAKWORK_API_KEY}"`,
        },
        body: JSON.stringify(payload),
      });

      if (!stakworkResponse.ok) {
        // Clean up the single PENDING runner row so retries are not blocked
        await deletePendingRun(runnerRun.id);
        return NextResponse.json(
          { error: "Failed to dispatch job to Stakwork" },
          { status: 502 },
        );
      }

      const stakworkData = await stakworkResponse.json();
      projectId = stakworkData?.data?.project_id ?? stakworkData?.project_id;
    }

    // Merge projectId into result; preserve existing result fields
    const runnerRow = await db.stakworkRun.findUnique({
      where: { id: runnerRun.id },
      select: { result: true },
    });
    let updatedRunnerResult: Record<string, unknown> = {};
    try {
      updatedRunnerResult = runnerRow?.result
        ? (JSON.parse(runnerRow.result) as Record<string, unknown>)
        : {};
    } catch {
      // ignore parse errors
    }
    if (runner === "strut") {
      // projectId column stays null. Do not set runnerProjectId. strutRunId is
      // the operator's handle for which lab run a pending row belongs to, not
      // a substitute project link.
      updatedRunnerResult.runner = "strut";
      if (strutRunId !== undefined) updatedRunnerResult.strutRunId = strutRunId;
    } else if (projectId !== undefined) {
      updatedRunnerResult.runnerProjectId = projectId;
    }

    await db.stakworkRun.update({
      where: { id: runnerRun.id },
      data: {
        projectId: runner === "strut" ? null : (projectId ?? null),
        status: WorkflowStatus.IN_PROGRESS,
        result: JSON.stringify(updatedRunnerResult),
      },
    });

    // ── Non-fatal Jarvis eval graph instrumentation ───────────────────────────
    try {
      if (jarvisConfig) {
        const rubricCriteria = await fetchHarveyTaskCriteria(taskSlug);
        const evalNodes = await ensureHarveyLabEvalNodes(
          jarvisConfig,
          taskSlug,
          taskTitle,
          rubricCriteria,
        );
        if (evalNodes) {
          const triggerId = randomUUID();
          const triggerResult = await addNode(jarvisConfig, {
            node_type: "EvalTrigger",
            node_data: {
              id: triggerId,
              agent: "wfe-agent",
              source: "provider_direct",
              environment: process.env.STAKWORK_HARVEY_RUNNER_WORKFLOW_ID,
              start_point: taskSlug,
              end_point: taskSlug,
              body: JSON.stringify({
                prompt_snapshot: { task_slug: taskSlug, task_title: taskTitle, rubric_criteria: rubricCriteria },
                output_snapshot: null,
                tool_call_trace: null,
              }),
            },
          });
          if (triggerResult.success && triggerResult.ref_id) {
            await addEdge(jarvisConfig, {
              edge: { edge_type: "HAS_TRIGGER" },
              source: { ref_id: evalNodes.requirementRef },
              target: { ref_id: triggerResult.ref_id },
            });
            // Store evalTriggerRef in the runner result JSON
            const row = await db.stakworkRun.findUnique({
              where: { id: runnerRun.id },
              select: { result: true },
            });
            let resultJson: Record<string, unknown> = {};
            try {
              resultJson = row?.result
                ? (JSON.parse(row.result) as Record<string, unknown>)
                : {};
            } catch { /* ignore */ }
            resultJson.evalTriggerRef = triggerResult.ref_id;
            await db.stakworkRun.update({
              where: { id: runnerRun.id },
              data: { result: JSON.stringify(resultJson) },
            });

            // Non-fatal ATTRIBUTED_TO (gated on jarvis-backend prereq — skip until deployed)
            try {
              const agentResult = await addNode(jarvisConfig, {
                node_type: "HiveAgent",
                node_data: { name: "wfe-agent", display_name: "Stakwork Workflow Engine" },
              });
              if (agentResult.success) {
                await addEdge(jarvisConfig, {
                  edge: { edge_type: "ATTRIBUTED_TO" },
                  source: { ref_id: triggerResult.ref_id },
                  target: { node_type: "HiveAgent", node_data: { name: "wfe-agent" } },
                });
              }
            } catch { /* ATTRIBUTED_TO not yet registered in jarvis-backend — silently skip */ }
          }
        }
      }
    } catch (err) {
      console.error("[legal/benchmarks/run] Jarvis eval graph write failed (non-fatal):", err);
    }
    // ─────────────────────────────────────────────────────────────────────────

    logger.info("[legal/benchmarks/run] dispatched", "legal-benchmarks", {
      runner,
      taskSlug,
      workflowName: runner === "strut" ? strutWorkflowName : undefined,
      labRunId: strutRunId,
    });

    return NextResponse.json({ run_id: runnerRun.id }, { status: 201 });
  } catch (error) {
    // Do not log the caught exception object. A fetch or JSON error can carry
    // webhookUrl or a provider key. Status code only.
    const statusCode = error instanceof Error && "status" in error
      ? Number((error as { status?: unknown }).status) || undefined
      : undefined;
    logger.error("[legal/benchmarks/run POST] Unexpected error", "legal-benchmarks", {
      statusCode,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * Drop a pending row after a failed dispatch. If the delete itself throws,
 * log the run id and return anyway — the 30-minute stale mark is the escape
 * if the delete did not land. Callers still return 502/503.
 */
async function deletePendingRun(runId: string): Promise<void> {
  try {
    await db.stakworkRun.deleteMany({ where: { id: runId } });
  } catch {
    logger.error("[legal/benchmarks/run] failed to delete pending run", "legal-benchmarks", {
      runId,
    });
  }
}
