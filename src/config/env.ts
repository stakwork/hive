// Mock mode - when true, URLs resolve to local mock endpoints
const USE_MOCKS = process.env.USE_MOCKS === "true";
const MOCK_BASE = process.env.NEXTAUTH_URL || "http://localhost:3000";

const requiredEnvVars = {
  STAKWORK_API_KEY: process.env.STAKWORK_API_KEY,
  POOL_MANAGER_API_KEY: process.env.POOL_MANAGER_API_KEY,
  POOL_MANAGER_API_USERNAME: process.env.POOL_MANAGER_API_USERNAME,
  POOL_MANAGER_API_PASSWORD: process.env.POOL_MANAGER_API_PASSWORD,
  SWARM_SUPERADMIN_API_KEY: process.env.SWARM_SUPERADMIN_API_KEY,
  SWARM_SUPER_ADMIN_URL: process.env.SWARM_SUPER_ADMIN_URL,
  STAKWORK_CUSTOMERS_EMAIL: process.env.STAKWORK_CUSTOMERS_EMAIL,
  STAKWORK_CUSTOMERS_PASSWORD: process.env.STAKWORK_CUSTOMERS_PASSWORD,
  //ENCRYPTION_KEY: process.env.ENCRYPTION_KEY,
} as const;

// Validate environment variables at runtime (skip in mock mode)
export function validateEnvVars(): void {
  if (USE_MOCKS) return;

  for (const [key, value] of Object.entries(requiredEnvVars)) {
    if (!value) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
}

export const env = requiredEnvVars;

// Optional environment variables with defaults
// URLs resolve to mock endpoints when USE_MOCKS=true
export const optionalEnvVars = {
  // GitHub OAuth token exchange URL (used by GitHub App callback)
  GITHUB_OAUTH_TOKEN_URL: USE_MOCKS
    ? `${MOCK_BASE}/api/mock/github/oauth/access_token`
    : "https://github.com/login/oauth/access_token",
  // Gemini API base URL (routes to mock endpoint when USE_MOCKS=true)
  GEMINI_API_BASE_URL: USE_MOCKS ? `${MOCK_BASE}/api/mock/gemini` : "https://generativelanguage.googleapis.com",
  // Discord API base URL (routes to mock endpoint when USE_MOCKS=true)
  DISCORD_API_BASE_URL: USE_MOCKS ? `${MOCK_BASE}/api/mock/discord` : "https://discord.com/api/v10",
  STAKWORK_BASE_URL: USE_MOCKS
    ? `${MOCK_BASE}/api/mock/stakwork`
    : process.env.STAKWORK_BASE_URL || "https://api.stakwork.com/api/v1",
  STAKWORK_API_KEY: process.env.STAKWORK_API_KEY,
  STAKWORK_WORKFLOW_ID: process.env.STAKWORK_WORKFLOW_ID,
  STAKWORK_JANITOR_WORKFLOW_ID: process.env.STAKWORK_JANITOR_WORKFLOW_ID,
  STAKWORK_GRAPHMINDSET_WORKFLOW_ID: process.env.STAKWORK_GRAPHMINDSET_WORKFLOW_ID,
  STAKWORK_USER_JOURNEY_WORKFLOW_ID: process.env.STAKWORK_USER_JOURNEY_WORKFLOW_ID,
  STAKWORK_TRANSCRIPT_WORKFLOW_ID: process.env.STAKWORK_TRANSCRIPT_WORKFLOW_ID,
  STAKWORK_AI_GENERATION_WORKFLOW_ID: process.env.STAKWORK_AI_GENERATION_WORKFLOW_ID,
  STAKWORK_WORKFLOW_EDITOR_WORKFLOW_ID: process.env.STAKWORK_WORKFLOW_EDITOR_WORKFLOW_ID,
  STAKWORK_WORKFLOW_PROJECT_DEBUGGER_ID: process.env.STAKWORK_WORKFLOW_PROJECT_DEBUGGER_ID,
  STAKWORK_POD_REPAIR_WORKFLOW_ID: process.env.STAKWORK_POD_REPAIR_WORKFLOW_ID,
  STAKWORK_TASK_WORKFLOW_ID: process.env.STAKWORK_TASK_WORKFLOW_ID,
  STAKWORK_BOUNTY_WORKFLOW_ID: process.env.STAKWORK_BOUNTY_WORKFLOW_ID,
  STAKWORK_DIAGRAM_WORKFLOW_ID: process.env.STAKWORK_DIAGRAM_WORKFLOW_ID,
  STAKWORK_LEARNING_WORKFLOW_ID: process.env.STAKWORK_LEARNING_WORKFLOW_ID,
  WORKFLOW_GRAPH_PROMPT_STORAGE_ID: process.env.WORKFLOW_GRAPH_PROMPT_STORAGE_ID,
  STAKWORK_PLAN_MODE_WORKFLOW_ID: process.env.STAKWORK_PLAN_MODE_WORKFLOW_ID,
  STAKWORK_EVAL_WORKFLOW_ID: process.env.STAKWORK_EVAL_WORKFLOW_ID,
  STAKWORK_WORKFLOW_ID_LLM_SYNC: process.env.STAKWORK_WORKFLOW_ID_LLM_SYNC,
  STAKWORK_WORKFLOW_SUMMARY_WORKFLOW_ID: process.env.STAKWORK_WORKFLOW_SUMMARY_WORKFLOW_ID,
  STAKWORK_AGENT_TRACE_WORKFLOW_ID: process.env.STAKWORK_AGENT_TRACE_WORKFLOW_ID,
  STAKWORK_DAILY_RECAP_WORKFLOW_ID: process.env.STAKWORK_DAILY_RECAP_WORKFLOW_ID,
  STAKWORK_LINGO_EXTRACTION_WORKFLOW_ID: process.env.STAKWORK_LINGO_EXTRACTION_WORKFLOW_ID,
  JANITOR_WEBHOOK_SECRET: process.env.JANITOR_WEBHOOK_SECRET,
  PLAN_MODE_MODEL: process.env.PLAN_MODE_MODEL,
  POOL_MANAGER_BASE_URL: USE_MOCKS
    ? `${MOCK_BASE}/api/mock/pool-manager`
    : process.env.POOL_MANAGER_BASE_URL || "https://workspaces.sphinx.chat/api",
  SWARM_SUPER_ADMIN_URL: USE_MOCKS ? `${MOCK_BASE}/api/mock/swarm-super-admin` : process.env.SWARM_SUPER_ADMIN_URL,
  LIVEKIT_CALL_BASE_URL: USE_MOCKS
    ? `${MOCK_BASE}/api/mock/livekit/`
    : process.env.LIVEKIT_CALL_BASE_URL || "https://call.livekit.io/",
  SPHINX_API_URL: USE_MOCKS
    ? `${MOCK_BASE}/api/mock/sphinx/action`
    : "https://bots.v2.sphinx.chat/api/action",
  // Sphinx V2 Bot — direct DM messaging (separate server from /action)
  V2_BOT_URL: USE_MOCKS ? `${MOCK_BASE}/api/mock/sphinx/send` : process.env.V2_BOT_URL || "",
  V2_BOT_TOKEN: process.env.V2_BOT_TOKEN || "",
  // HUB push notification endpoint
  HUB_NOTIFY_URL: USE_MOCKS
    ? `${MOCK_BASE}/api/mock/hub/notify`
    : process.env.HUB_NOTIFY_URL || "https://hub.sphinx.chat/api/v1/nodes/notify",
  API_TIMEOUT: parseInt(process.env.API_TIMEOUT || "20000"),
  GITHUB_APP_SLUG: process.env.GITHUB_APP_SLUG,
  GITHUB_APP_CLIENT_ID: process.env.GITHUB_APP_CLIENT_ID,
  GITHUB_APP_CLIENT_SECRET: process.env.GITHUB_APP_CLIENT_SECRET,
  LOG_LEVEL: process.env.LOG_LEVEL || "INFO",
  POOL_SUPERADMINS: process.env.POOL_SUPERADMINS || "",
  SUPER_ADMIN_USER_IDS: process.env.SUPER_ADMIN_USER_IDS || "",
  USE_MOCKS,
  MOCK_BASE,
  REDIS_URL: process.env.REDIS_URL,
  ONBOARDING_FORK_REPOS: process.env.ONBOARDING_FORK_REPOS || "",
  LIGHTNING_NODE_URL: USE_MOCKS
    ? `${MOCK_BASE}/api/mock/lnd`
    : process.env.LIGHTNING_NODE_URL || '',
  LIGHTNING_MACAROON: process.env.LIGHTNING_MACAROON || '',
  LIGHTNING_TLS_CERT: process.env.LIGHTNING_TLS_CERT || '',
  MEMPOOL_BASE_URL: USE_MOCKS
    ? `${MOCK_BASE}/api/mock/mempool`
    : 'https://mempool.space',
  // Bifrost rollout gate. Accepted values:
  //   - unset / "" / "false"         -> off for everyone
  //   - "true" / "all" / "*"          -> on for every workspace
  //   - "<slug1>,<slug2>,…"           -> on only for these workspace slugs
  //
  // When "on" for a workspace, the agent-spawn path provisions a
  // per-(workspace,user) Bifrost Virtual Key (lazy, idempotent) and
  // forwards it to `repo/agent` as `apiKey` + `baseUrl`. When off,
  // LLM calls keep using whatever default the agent/swarm picked
  // (preserves pre-Bifrost behavior). See
  // `gateway/plans/phase-1-reconciler.md`.
  //
  // Callers MUST go through `isBifrostEnabledForWorkspace(slug)` —
  // direct equality checks on this raw string are a bug.
  BIFROST_ENABLED: process.env.BIFROST_ENABLED || "",
  // Per-agent rollout gate. ANDed with `BIFROST_ENABLED`: both the
  // workspace AND the agentName must pass for `getBifrostForLLM` to
  // return real credentials. Accepted shapes mirror `BIFROST_ENABLED`:
  //   - unset / "" / "all" / "*" / "true"   -> every agent allowed
  //                                            (back-compat: no filter)
  //   - "false"                              -> no agents allowed
  //   - "<agent1>,<agent2>,…"                -> only these agentNames
  //
  // Values are the literal `agentName` strings the orchestrator emits
  // (see `BifrostAgentName` in `services/bifrost/orchestrator.ts`).
  // Unlike the workspace gate, the **default is "open"** — an empty
  // value means "don't filter by agent," preserving today's behavior
  // for every workspace already enrolled in `BIFROST_ENABLED`.
  //
  // Callers MUST go through `isBifrostEnabledForAgent(agentName)` —
  // direct equality checks on this raw string are a bug.
  BIFROST_ENABLED_AGENTS: process.env.BIFROST_ENABLED_AGENTS || "",
  // Externally-reachable Hive origin pushed to the Bifrost gateway as
  // the callback base URL during agent-catalog reconciliation. Must be
  // set to the public URL (e.g. "https://hive.example.com") — NOT a
  // localhost address, as the gateway calls back from outside. When
  // unset, the callback push is skipped (logged at warn level).
  HIVE_PUBLIC_URL: process.env.HIVE_PUBLIC_URL || "",
  // Which source-control orgs may use the canvas agent's `prompts`
  // capability (read + propose against the shared, globally-scoped prompt
  // library). CSV of `SourceControlOrg.githubLogin` values, case-
  // insensitive. Defaults to "stakwork" (the org that owns the shared
  // library) when unset — the library has no per-org scoping, so this is
  // the boundary that keeps the capability off every other org's agent.
  // Callers MUST go through `isPromptsCapabilityEnabledForOrgLogin(login)`.
  PROMPTS_CAPABILITY_ORG_LOGINS:
    process.env.PROMPTS_CAPABILITY_ORG_LOGINS || "stakwork",
} as const;

/**
 * Validates and returns Gemini API key
 * Returns mock key when USE_MOCKS=true, else reads from environment
 * @throws Error if GEMINI_API_KEY is not set and USE_MOCKS=false
 */
export function getGeminiApiKey(): string {
  // Return mock API key in mock mode
  if (USE_MOCKS) {
    return "mock-gemini-key-12345";
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not set. " + "Please add it to your .env file.");
  }

  return apiKey;
}

/**
 * Checks if Gemini API key is configured
 */
export function isGeminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

/**
 * Checks if a GitHub username is a superadmin
 * @param githubUsername - GitHub username to check
 * @returns true if the username is in the POOL_SUPERADMINS list
 */
export function isSuperAdmin(githubUsername: string): boolean {
  const list = (process.env.POOL_SUPERADMINS || "")
    .split(",")
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(githubUsername.trim().toLowerCase());
}

/**
 * Checks if a user ID is a platform superadmin
 * @param userId - User ID to check
 * @returns true if the user ID is in the SUPER_ADMIN_USER_IDS list
 */
export function isSuperAdminUserId(userId: string): boolean {
  const list = (process.env.SUPER_ADMIN_USER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return list.includes(userId.trim());
}

/**
 * Decide whether the Bifrost rollout gate is open for a given workspace.
 *
 * `BIFROST_ENABLED` accepts three shapes:
 *   - "true" / "all" / "*"     -> on for every workspace
 *   - "slug1,slug2,…"          -> on only for these workspace slugs
 *   - unset / "" / "false"     -> off for everyone
 *
 * Matching is case-insensitive and trims whitespace. Passing an empty /
 * missing slug always returns `false` so untrusted callers can't accidentally
 * enable the gate via empty input.
 *
 * @param workspaceSlug - The slug of the workspace to check
 * @returns `true` iff Bifrost should be considered enabled for this workspace
 */
export function isBifrostEnabledForWorkspace(
  workspaceSlug: string | null | undefined,
): boolean {
  const raw = (process.env.BIFROST_ENABLED || "").trim().toLowerCase();
  if (!raw || raw === "false") return false;
  if (raw === "true" || raw === "all" || raw === "*") return true;
  //
  // CSV path: empty slug never matches.
  const slug = (workspaceSlug ?? "").trim().toLowerCase();
  if (!slug) return false;

  const allowList = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allowList.includes(slug);
}

/**
 * Decide whether the per-agent Bifrost rollout gate is open for a
 * given `agentName`. ANDed with {@link isBifrostEnabledForWorkspace}
 * inside the orchestrator: both gates must pass for an LLM call to
 * route through Bifrost.
 *
 * `BIFROST_ENABLED_AGENTS` accepts four shapes:
 *   - unset / "" / "true" / "all" / "*"    -> every agent allowed
 *                                              (back-compat default)
 *   - "false"                               -> no agents allowed
 *   - "agent1,agent2,…"                     -> only listed agentNames
 *
 * The default-open posture (empty == allow-all) is intentional: this
 * gate is opt-IN filtering, so adding the env var to an environment
 * that didn't previously set it can only narrow which agents go
 * through Bifrost — never silently disable a workspace that the
 * other gate already enabled.
 *
 * Matching is case-insensitive and trims whitespace. Passing an
 * empty / missing agentName always returns `false` so untrusted
 * callers can't accidentally pass the gate via empty input.
 *
 * @param agentName - The orchestrator's `agentName` (typed as
 *   `BifrostAgentName` at the call site).
 * @returns `true` iff Bifrost should be considered enabled for
 *   this agentName.
 */
export function isBifrostEnabledForAgent(
  agentName: string | null | undefined,
): boolean {
  const raw = (process.env.BIFROST_ENABLED_AGENTS || "").trim().toLowerCase();
  // Default-open: empty / unset / on-tokens all mean "allow every
  // agent." Note the asymmetry with `isBifrostEnabledForWorkspace`,
  // which is default-closed. Rationale lives in the env-var JSDoc.
  if (!raw || raw === "true" || raw === "all" || raw === "*") return true;
  if (raw === "false") return false;
  //
  // CSV path: empty agentName never matches.
  const name = (agentName ?? "").trim().toLowerCase();
  if (!name) return false;

  const allowList = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return allowList.includes(name);
}

/**
 * Decide whether the canvas agent's `prompts` capability is available to a
 * source-control org, identified by its GitHub login.
 *
 * The shared prompt library is globally scoped (the `Prompt` model has no
 * org FK), so this login allow-list — not any row-level filter — is what
 * keeps the read/propose tools from being handed to every org's canvas
 * agent. `PROMPTS_CAPABILITY_ORG_LOGINS` is a case-insensitive CSV of
 * `SourceControlOrg.githubLogin` values; defaults to "stakwork" when unset.
 *
 * Fails closed: an empty/missing login never matches, so an unknown org
 * can't slip through on empty input.
 *
 * @param githubLogin - The acting org's `SourceControlOrg.githubLogin`.
 * @returns `true` iff the `prompts` capability should be composed for it.
 */
export function isPromptsCapabilityEnabledForOrgLogin(
  githubLogin: string | null | undefined,
): boolean {
  const login = (githubLogin ?? "").trim().toLowerCase();
  if (!login) return false;

  const allowList = (process.env.PROMPTS_CAPABILITY_ORG_LOGINS || "stakwork")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return allowList.includes(login);
}

// Combined environment configuration
export const config = {
  ...requiredEnvVars,
  ...optionalEnvVars,
  geminiApiKey: process.env.GEMINI_API_KEY,
} as const;
