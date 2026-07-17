/**
 * Unit tests for buildInfraTools / read_pod_infra.
 *
 * Coverage:
 *   1. Happy path — returns decoded files; pm2.config.js env values masked.
 *   2. Cross-org / unauthorized slug — indistinguishable not-found rejection.
 *   3. Missing swarm / null containerFiles — friendly not-provisioned message.
 *   4. listOnly mode — filenames + services only, no file bodies.
 *   5. file mode — returns single file; unknown file name lists available files.
 *   6. infra appears in capabilities registry as non-core with empty writeToolNames.
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks (must be declared before imports) ─────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    workspace: { findFirst: vi.fn() },
  },
}));

vi.mock("@/services/swarm/db", () => ({
  getSwarmContainerConfig: vi.fn(),
}));

vi.mock("@/utils/devContainerUtils", () => ({
  maskEnvVarsInPM2Config: vi.fn((content: string) =>
    // Simulate masking: replace SECRET_KEY value with ****
    content.replace(/(SECRET_KEY:\s*["'])[^"']*["']/g, '$1****"'),
  ),
}));

// Stub `ai` so `tool()` is a passthrough returning the definition object.
vi.mock("ai", () => ({
  tool: vi.fn((t: unknown) => t),
}));

// Mocks needed when capabilities.ts is imported (prevents pulling in heavy deps).
vi.mock("@/lib/ai/canvasTools", () => ({ buildCanvasTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/connectionTools", () => ({ buildConnectionTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/initiativeTools", () => ({ buildInitiativeTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/researchTools", () => ({ buildResearchTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/graphWalkerTools", () => ({ buildGraphWalkerTools: vi.fn(() => ({})) }));
vi.mock("@/lib/ai/graphWalkDispatchTools", () => ({
  buildGraphWalkDispatchTools: vi.fn(() => ({})),
}));
vi.mock("@/lib/constants/prompt", () => ({
  getRoadmapCapabilitySnippet: vi.fn(() => ""),
  getPlannerCapabilitySnippet: vi.fn(() => ""),
  getWhiteboardCapabilitySnippet: vi.fn(() => ""),
  getResearchCapabilitySnippet: vi.fn(() => ""),
  getConnectionsCapabilitySnippet: vi.fn(() => ""),
  getGraphWalkerCapabilitySnippet: vi.fn(() => ""),
  getInfraCapabilitySnippet: vi.fn(() => "infra-snippet"),
  getWorkflowsCapabilitySnippet: vi.fn(() => "workflows-snippet"),
  getPromptsCapabilitySnippet: vi.fn(() => ""),
  getConceptsCapabilitySnippet: vi.fn(() => ""),
}));
vi.mock("@/lib/proposals/types", () => ({
  PROPOSE_FEATURE_TOOL: "propose_feature",
  PROPOSE_INITIATIVE_TOOL: "propose_initiative",
  PROPOSE_MILESTONE_TOOL: "propose_milestone",
  PROPOSE_NEW_PROMPT_TOOL: "propose_new_prompt",
  PROPOSE_PROMPT_UPDATE_TOOL: "propose_prompt_update",
  PROPOSE_NEW_CONCEPT_TOOL: "propose_new_concept",
  PROPOSE_CONCEPT_UPDATE_TOOL: "propose_concept_update",
}));

// ─── Imports (after mocks) ───────────────────────────────────────────────────

import { db } from "@/lib/db";
import { getSwarmContainerConfig } from "@/services/swarm/db";
import { maskEnvVarsInPM2Config } from "@/utils/devContainerUtils";
import { buildInfraTools } from "@/lib/ai/infraTools";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ORG_ID = "org-abc";
const USER_ID = "user-xyz";

type ReadPodInfraTool = {
  execute: (args: {
    workspace: string;
    file?: string;
    listOnly?: boolean;
  }) => Promise<unknown>;
};

function getReadPodInfra(): ReadPodInfraTool {
  const tools = buildInfraTools(ORG_ID, USER_ID);
  return tools["read_pod_infra"] as ReadPodInfraTool;
}

const WORKSPACE_ROW = { id: "ws-id-1", slug: "my-workspace", name: "My Workspace" };

const PM2_CONTENT = `module.exports = {
  apps: [{
    name: "backend",
    script: "node",
    env: {
      PORT: "3000",
      SECRET_KEY: "super-secret-value",
    }
  }]
};`;

const DOCKERFILE_CONTENT = `FROM node:20-alpine\nWORKDIR /app\nCOPY . .\nRUN npm install`;

const CONTAINER_FILES_DECODED = {
  "pm2.config.js": PM2_CONTENT,
  Dockerfile: DOCKERFILE_CONTENT,
};

const SERVICES = [{ name: "backend", script: "node", env: {} }];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("buildInfraTools / read_pod_infra", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── 1. Happy path ───────────────────────────────────────────────

  it("returns all decoded files with pm2.config.js env values masked (default mode)", async () => {
    (db.workspace.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(WORKSPACE_ROW);
    (getSwarmContainerConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      containerFiles: CONTAINER_FILES_DECODED,
      services: SERVICES,
    });

    const tool = getReadPodInfra();
    const result = (await tool.execute({ workspace: "my-workspace" })) as Record<
      string,
      unknown
    >;

    // maskEnvVarsInPM2Config must be called with the raw pm2 content
    expect(maskEnvVarsInPM2Config).toHaveBeenCalledWith(PM2_CONTENT);

    expect(result.workspace).toBe("my-workspace");
    const files = result.files as Record<string, string>;
    expect(files["Dockerfile"]).toBe(DOCKERFILE_CONTENT);
    // pm2 content should be masked (mock replaces SECRET_KEY value with ****)
    expect(files["pm2.config.js"]).toContain("****");
    expect(result.services).toEqual(SERVICES);
  });

  it("does not call maskEnvVarsInPM2Config when no pm2.config.js is present", async () => {
    (db.workspace.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(WORKSPACE_ROW);
    (getSwarmContainerConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      containerFiles: { Dockerfile: DOCKERFILE_CONTENT },
      services: [],
    });

    const tool = getReadPodInfra();
    await tool.execute({ workspace: "my-workspace" });

    expect(maskEnvVarsInPM2Config).not.toHaveBeenCalled();
  });

  // ─── 2. Cross-org / unauthorized slug (IDOR) ──────────────────────

  it("returns indistinguishable not-found for a workspace belonging to another org", async () => {
    (db.workspace.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const tool = getReadPodInfra();
    const result = (await tool.execute({ workspace: "other-org-workspace" })) as Record<
      string,
      unknown
    >;

    expect(result).toEqual({ error: "Workspace not found or not accessible" });
    // getSwarmContainerConfig must NOT be called — no data leaked
    expect(getSwarmContainerConfig).not.toHaveBeenCalled();
  });

  it("passes org/user scoping filter to db.workspace.findFirst", async () => {
    (db.workspace.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const tool = getReadPodInfra();
    await tool.execute({ workspace: "some-slug" });

    expect(db.workspace.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceControlOrgId: ORG_ID,
          deleted: false,
        }),
      }),
    );
  });

  // ─── 3. Missing swarm / null containerFiles ───────────────────────

  it("returns not_provisioned when getSwarmContainerConfig returns null", async () => {
    (db.workspace.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(WORKSPACE_ROW);
    (getSwarmContainerConfig as ReturnType<typeof vi.fn>).mockResolvedValue(null);

    const tool = getReadPodInfra();
    const result = (await tool.execute({ workspace: "my-workspace" })) as Record<
      string,
      unknown
    >;

    expect(result.status).toBe("not_provisioned");
    expect(typeof result.message).toBe("string");
    expect(result.workspace).toBe("my-workspace");
  });

  it("returns not_provisioned when containerFiles is null", async () => {
    (db.workspace.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(WORKSPACE_ROW);
    (getSwarmContainerConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      containerFiles: null,
      services: [],
    });

    const tool = getReadPodInfra();
    const result = (await tool.execute({ workspace: "my-workspace" })) as Record<
      string,
      unknown
    >;

    expect(result.status).toBe("not_provisioned");
  });

  it("returns not_provisioned when containerFiles is an empty object", async () => {
    (db.workspace.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(WORKSPACE_ROW);
    (getSwarmContainerConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      containerFiles: {},
      services: [],
    });

    const tool = getReadPodInfra();
    const result = (await tool.execute({ workspace: "my-workspace" })) as Record<
      string,
      unknown
    >;

    expect(result.status).toBe("not_provisioned");
  });

  // ─── 4. listOnly mode ─────────────────────────────────────────────

  it("listOnly mode returns filenames and compact services — no file bodies", async () => {
    (db.workspace.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(WORKSPACE_ROW);
    (getSwarmContainerConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      containerFiles: CONTAINER_FILES_DECODED,
      services: SERVICES,
    });

    const tool = getReadPodInfra();
    const result = (await tool.execute({
      workspace: "my-workspace",
      listOnly: true,
    })) as Record<string, unknown>;

    expect(result.workspace).toBe("my-workspace");
    // files is an array of filename strings, not an object with bodies
    expect(Array.isArray(result.files)).toBe(true);
    const files = result.files as string[];
    expect(files).toContain("pm2.config.js");
    expect(files).toContain("Dockerfile");
    for (const f of files) {
      expect(typeof f).toBe("string");
    }
    expect(result.serviceCount).toBe(1);
    const services = result.services as Array<{ name: string }>;
    expect(services[0].name).toBe("backend");
    // No masking should occur in listOnly mode
    expect(maskEnvVarsInPM2Config).not.toHaveBeenCalled();
  });

  // ─── 5. file mode ─────────────────────────────────────────────────

  it("file mode returns a single named file without masking non-pm2 files", async () => {
    (db.workspace.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(WORKSPACE_ROW);
    (getSwarmContainerConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      containerFiles: CONTAINER_FILES_DECODED,
      services: SERVICES,
    });

    const tool = getReadPodInfra();
    const result = (await tool.execute({
      workspace: "my-workspace",
      file: "Dockerfile",
    })) as Record<string, unknown>;

    expect(result.workspace).toBe("my-workspace");
    expect(result.file).toBe("Dockerfile");
    expect(result.content).toBe(DOCKERFILE_CONTENT);
    expect(maskEnvVarsInPM2Config).not.toHaveBeenCalled();
  });

  it("file mode applies pm2 masking when pm2.config.js is requested", async () => {
    (db.workspace.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(WORKSPACE_ROW);
    (getSwarmContainerConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      containerFiles: CONTAINER_FILES_DECODED,
      services: SERVICES,
    });

    const tool = getReadPodInfra();
    const result = (await tool.execute({
      workspace: "my-workspace",
      file: "pm2.config.js",
    })) as Record<string, unknown>;

    expect(result.file).toBe("pm2.config.js");
    expect(maskEnvVarsInPM2Config).toHaveBeenCalledWith(PM2_CONTENT);
    expect(result.content).toContain("****");
  });

  it("file mode returns error listing available files when the requested file is absent", async () => {
    (db.workspace.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(WORKSPACE_ROW);
    (getSwarmContainerConfig as ReturnType<typeof vi.fn>).mockResolvedValue({
      containerFiles: CONTAINER_FILES_DECODED,
      services: SERVICES,
    });

    const tool = getReadPodInfra();
    const result = (await tool.execute({
      workspace: "my-workspace",
      file: "nonexistent.yml",
    })) as Record<string, unknown>;

    expect(typeof result.error).toBe("string");
    const error = result.error as string;
    expect(error).toContain("nonexistent.yml");
    expect(error).toContain("pm2.config.js");
    expect(error).toContain("Dockerfile");
  });

  // ─── 6. Unexpected error handling ────────────────────────────────

  it("returns error message on unexpected db failure", async () => {
    (db.workspace.findFirst as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("DB connection lost"),
    );

    const tool = getReadPodInfra();
    const result = (await tool.execute({ workspace: "my-workspace" })) as Record<
      string,
      unknown
    >;

    expect(result).toEqual({ error: "Failed to read pod infra config" });
  });
});

// ─── Capability registry ──────────────────────────────────────────────────────

describe("infra capability in CAPABILITY_REGISTRY", () => {
  it("infra is non-core with no writeToolNames and has a menuBlurb", async () => {
    const { CAPABILITY_REGISTRY } = await import("@/lib/ai/capabilities");
    const infra = CAPABILITY_REGISTRY["infra"];
    expect(infra).toBeDefined();
    expect(infra.core).toBe(false);
    expect(infra.writeToolNames).toEqual([]);
    expect(typeof infra.menuBlurb).toBe("string");
    expect(infra.menuBlurb).toContain("infra");
  });

  it("resolveCapabilities(['roadmap']) includes 'infra'", async () => {
    const { resolveCapabilities } = await import("@/lib/ai/capabilities");
    const resolved = resolveCapabilities(["roadmap"]);
    expect(resolved).toContain("infra");
  });

  it("ALL_CAPABILITIES includes 'infra'", async () => {
    const { ALL_CAPABILITIES } = await import("@/lib/ai/capabilities");
    expect(ALL_CAPABILITIES).toContain("infra");
  });
});
