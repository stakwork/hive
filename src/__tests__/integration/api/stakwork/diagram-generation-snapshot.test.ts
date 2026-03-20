/**
 * Integration tests: DIAGRAM_GENERATION webhook → whiteboard version snapshots
 *
 * Verifies that `processStakworkRunWebhook` creates a `WhiteboardVersion`
 * snapshot before overwriting whiteboard elements, and that the MAX_VERSIONS=10
 * pruning logic is enforced. Tests cover both the standalone `whiteboard_id`
 * path and the feature-linked `feature_id` (upsert) path.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { processStakworkRunWebhook } from "@/services/stakwork-run";
import { WorkflowStatus, StakworkRunType } from "@prisma/client";
import { generateUniqueId, generateUniqueSlug } from "@/__tests__/support/helpers";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn().mockResolvedValue(undefined) },
  getWorkspaceChannelName: (slug: string) => `workspace-${slug}`,
  getWhiteboardChannelName: (id: string) => `whiteboard-${id}`,
  getFeatureChannelName: (id: string) => `feature-${id}`,
  PUSHER_EVENTS: {
    STAKWORK_RUN_UPDATE: "stakwork-run-update",
    STAKWORK_RUN_DECISION: "stakwork-run-decision",
    WHITEBOARD_CHAT_MESSAGE: "whiteboard-chat-message",
    FEATURE_UPDATED: "feature-updated",
  },
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn((_field: string, value: unknown) => String(value)),
    })),
  },
}));

vi.mock("@/lib/vercel/stakwork-token", () => ({
  getStakworkTokenReference: vi.fn(() => "HIVE_STAGING"),
}));

// Mock the ELK layout so tests don't need a running ELK server
vi.mock("@/services/excalidraw-layout", async () => {
  const actual = await vi.importActual<typeof import("@/services/excalidraw-layout")>(
    "@/services/excalidraw-layout"
  );
  return {
    ...actual,
    relayoutDiagram: vi.fn().mockResolvedValue({
      elements: [{ id: "layouted-el", type: "rectangle", customData: { source: "ai" } }],
      appState: { viewBackgroundColor: "#ffffff" },
    }),
    sanitiseDiagram: vi.fn((d: unknown) => d),
  };
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Minimal diagram payload that passes extractDiagramData (legacy top-level format) */
const DIAGRAM_RESULT = {
  components: [{ id: "comp1", name: "Service A", type: "service" }],
  connections: [],
};

/** New Stakwork artifacts-array format */
const DIAGRAM_RESULT_ARTIFACTS = {feature_id: null,
  message: null,
  artifacts: [
    {
      type: "DIAGRAM",
      content: {
        diagramType: "architecture",
        components: [{ id: "comp1", name: "Service A", type: "service" }],
        connections: [],
      },
    },
  ],
};

/** Webhook payload for a completed DIAGRAM_GENERATION run */
function makeWebhookPayload(projectId: number, result: unknown = DIAGRAM_RESULT) {
  return {
    project_id: projectId,
    project_status: "completed",
    result,
  };
}

async function createUser() {
  return db.users.create({
    data: {
      id: generateUniqueId("user"),
      email: `user-${generateUniqueId()}@test.com`,
      name: "Test User",
    },
  });
}

async function createWorkspace(ownerId: string) {
  return db.workspaces.create({
    data: {
      name: `Workspace ${generateUniqueId()}`,
      slug: generateUniqueSlug("ws"),
      ownerId,
    },
  });
}

async function createWhiteboardWithElements(workspaceId: string, elements: unknown[] = [{ id: "el1", type: "rectangle" }]) {
  return db.whiteboards.create({
    data: {
      name: "Test Whiteboard",
      workspaceId,
      elements: elements as never,
      appState: { viewBackgroundColor: "#ffffff", gridSize: null },
      files: {},
    },
  });
}

async function createFeatureWithWhiteboard(workspaceId: string,owner_id: string, elements: unknown[] = [{ id: "el1" }]) {
  const feature = await db.features.create({
    data: {
      title: `Feature ${generateUniqueId()}`,
      workspaceId,created_by_id: ownerId,updated_by_id: ownerId,
    },
  });

  const whiteboard = await db.whiteboards.create({
    data: {
      name: `${feature.title} - Architecture`,
      workspaceId,feature_id: feature.id,
      elements: elements as never,
      appState: {},
      files: {},
    },
  });

  return { feature, whiteboard };
}

async function createVersion(whiteboardId: string, label: string) {
  return db.whiteboard_versions.create({
    data: {
      whiteboardId,
      elements: [{ id: "snap-el" }] as never,
      appState: {},
      files: {},
      label,
    },
  });
}

/** Creates a StakworkRun and returns it along with its projectId */
async function createDiagramRun(workspaceId: string, opts: { whiteboardId?: string; featureId?: string } = {}) {
  const projectId = Math.floor(Math.random() * 1_000_000) + 1;
  const run = await db.stakwork_runs.create({
    data: {
      type: StakworkRunType.DIAGRAM_GENERATION,
      workspaceId,feature_id: opts.featureId ?? null,
      status: WorkflowStatus.IN_PROGRESS,webhook_url: `http://localhost/api/webhook/stakwork/response?type=DIAGRAM_GENERATION&workspace_id=${workspaceId}${opts.whiteboardId ? `&whiteboard_id=${opts.whiteboardId}` : ""}${opts.featureId ? `&feature_id=${opts.featureId}` : ""}`,data_type: "string",
      projectId,
    },
  });
  return { run, projectId };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DIAGRAM_GENERATION webhook → whiteboard version snapshots", () => {
  let user: Awaited<ReturnType<typeof createUser>>;
  let workspace: Awaited<ReturnType<typeof createWorkspace>>;

  beforeEach(async () => {
    user = await createUser();
    workspace = await createWorkspace(user.id);
  });

  afterEach(async () => {
    // Clean up in dependency order
    await db.whiteboard_versions.deleteMany({ where: { whiteboard: {workspace_id: workspace.id } } });
    await db.whiteboard_messages.deleteMany({ where: { whiteboard: {workspace_id: workspace.id } } });
    await db.stakwork_runs.deleteMany({ where: {workspace_id: workspace.id } });
    await db.whiteboards.deleteMany({ where: {workspace_id: workspace.id } });
    await db.features.deleteMany({ where: {workspace_id: workspace.id } });
    await db.workspaces.delete({ where: { id: workspace.id } });
    await db.users.delete({ where: { id: user.id } });
  });

  // ── Standalone path (whiteboard_id) ────────────────────────────────────────

  describe("standalone path (whiteboard_id)", () => {
    it("creates a snapshot when whiteboard has existing elements", async () => {
      const whiteboard = await createWhiteboardWithElements(workspace.id);
      const { run, projectId } = await createDiagramRun(workspace.id, { whiteboardId: whiteboard.id });

      await processStakworkRunWebhook(makeWebhookPayload(projectId), {
        type: "DIAGRAM_GENERATION",
        workspace_id: workspace.id,
        whiteboard_id: whiteboard.id,
      });

      const versions = await db.whiteboard_versions.findMany({
        where: { whiteboardId: whiteboard.id },
      });

      expect(versions).toHaveLength(1);
      expect(versions[0].label).toMatch(/^Before AI diagram/);
      void run; // used above
    });

    it("does NOT create a snapshot when whiteboard has no elements (first-time create)", async () => {
      const whiteboard = await createWhiteboardWithElements(workspace.id, []);
      const { projectId } = await createDiagramRun(workspace.id, { whiteboardId: whiteboard.id });

      await processStakworkRunWebhook(makeWebhookPayload(projectId), {
        type: "DIAGRAM_GENERATION",
        workspace_id: workspace.id,
        whiteboard_id: whiteboard.id,
      });

      const versions = await db.whiteboard_versions.findMany({
        where: { whiteboardId: whiteboard.id },
      });

      expect(versions).toHaveLength(0);
    });

    it("prunes to MAX_DIAGRAM_VERSIONS=10 when whiteboard already has 10 versions", async () => {
      const whiteboard = await createWhiteboardWithElements(workspace.id);

      // Pre-populate 10 existing versions (at the cap)
      for (let i = 1; i <= 10; i++) {
        await createVersion(whiteboard.id, `v${i}`);
      }

      const { projectId } = await createDiagramRun(workspace.id, { whiteboardId: whiteboard.id });

      await processStakworkRunWebhook(makeWebhookPayload(projectId), {
        type: "DIAGRAM_GENERATION",
        workspace_id: workspace.id,
        whiteboard_id: whiteboard.id,
      });

      const versions = await db.whiteboard_versions.findMany({
        where: { whiteboardId: whiteboard.id },
        orderBy: {created_at: "asc" },
      });

      // Should still be capped at 10
      expect(versions).toHaveLength(10);

      // The newest one should be the AI snapshot (v1 was oldest and got pruned)
      const labels = versions.map((v) => v.label);
      expect(labels).not.toContain("v1");
      expect(labels.at(-1)).toMatch(/^Before AI diagram/);
    });

    it("snapshot elements match the whiteboard state before overwrite", async () => {
      const originalElements = [{ id: "orig-el", type: "ellipse" }];
      const whiteboard = await createWhiteboardWithElements(workspace.id, originalElements);
      const { projectId } = await createDiagramRun(workspace.id, { whiteboardId: whiteboard.id });

      await processStakworkRunWebhook(makeWebhookPayload(projectId), {
        type: "DIAGRAM_GENERATION",
        workspace_id: workspace.id,
        whiteboard_id: whiteboard.id,
      });

      const version = await db.whiteboard_versions.findFirst({
        where: { whiteboardId: whiteboard.id },
      });

      expect(version).not.toBeNull();
      expect(version!.elements).toEqual(originalElements);
    });
  });

  // ── Feature-linked path (feature_id upsert) ─────────────────────────────────

  describe("feature-linked path (feature_id)", () => {
    it("creates a snapshot when feature whiteboard already exists with elements", async () => {
      const { feature, whiteboard } = await createFeatureWithWhiteboard(workspace.id, user.id);
      const { projectId } = await createDiagramRun(workspace.id, {feature_id: feature.id });

      await processStakworkRunWebhook(makeWebhookPayload(projectId), {
        type: "DIAGRAM_GENERATION",
        workspace_id: workspace.id,
        feature_id: feature.id,
      });

      const versions = await db.whiteboard_versions.findMany({
        where: { whiteboardId: whiteboard.id },
      });

      expect(versions).toHaveLength(1);
      expect(versions[0].label).toMatch(/^Before AI diagram/);
    });

    it("does NOT create a snapshot when feature whiteboard has no elements", async () => {
      const { feature, whiteboard } = await createFeatureWithWhiteboard(workspace.id, user.id, []);
      const { projectId } = await createDiagramRun(workspace.id, {feature_id: feature.id });

      await processStakworkRunWebhook(makeWebhookPayload(projectId), {
        type: "DIAGRAM_GENERATION",
        workspace_id: workspace.id,
        feature_id: feature.id,
      });

      const versions = await db.whiteboard_versions.findMany({
        where: { whiteboardId: whiteboard.id },
      });

      expect(versions).toHaveLength(0);
    });

    it("does NOT create a snapshot when no whiteboard yet exists for the feature (first-time upsert)", async () => {
      // Feature with no linked whiteboard
      const feature = await db.features.create({
        data: {
          title: `Feature ${generateUniqueId()}`,workspace_id: workspace.id,created_by_id: user.id,updated_by_id: user.id,
        },
      });
      const { projectId } = await createDiagramRun(workspace.id, {feature_id: feature.id });

      await processStakworkRunWebhook(makeWebhookPayload(projectId), {
        type: "DIAGRAM_GENERATION",
        workspace_id: workspace.id,
        feature_id: feature.id,
      });

      // Whiteboard was created fresh — no versions should exist
      const createdWhiteboard = await db.whiteboards.findUnique({
        where: {feature_id: feature.id },
      });
      expect(createdWhiteboard).not.toBeNull();

      const versions = await db.whiteboard_versions.findMany({
        where: { whiteboardId: createdWhiteboard!.id },
      });
      expect(versions).toHaveLength(0);
    });

    it("prunes to MAX_DIAGRAM_VERSIONS=10 for feature-linked whiteboard", async () => {
      const { feature, whiteboard } = await createFeatureWithWhiteboard(workspace.id, user.id);

      for (let i = 1; i <= 10; i++) {
        await createVersion(whiteboard.id, `v${i}`);
      }

      const { projectId } = await createDiagramRun(workspace.id, {feature_id: feature.id });

      await processStakworkRunWebhook(makeWebhookPayload(projectId), {
        type: "DIAGRAM_GENERATION",
        workspace_id: workspace.id,
        feature_id: feature.id,
      });

      const versions = await db.whiteboard_versions.findMany({
        where: { whiteboardId: whiteboard.id },
        orderBy: {created_at: "asc" },
      });

      expect(versions).toHaveLength(10);
      expect(versions.map((v) => v.label)).not.toContain("v1");
      expect(versions.at(-1)!.label).toMatch(/^Before AI diagram/);
    });

    it("merges: preserves user elements, replaces old AI elements, adds new AI elements", async () => {
      const mixedElements = [
        { id: "user-el", type: "ellipse" },
        { id: "old-ai-el", type: "rectangle", customData: { source: "ai" } },
      ];
      const { feature, whiteboard } = await createFeatureWithWhiteboard(workspace.id, user.id, mixedElements);
      const { projectId } = await createDiagramRun(workspace.id, {feature_id: feature.id });

      await processStakworkRunWebhook(makeWebhookPayload(projectId), {
        type: "DIAGRAM_GENERATION",
        workspace_id: workspace.id,
        feature_id: feature.id,
      });

      const updated = await db.whiteboards.findUnique({
        where: { id: whiteboard.id },
        select: { elements: true },
      });
      const elements = updated!.elements as Array<Record<string, unknown>>;

      const ids = elements.map((e) => e.id);
      // User element must be preserved
      expect(ids).toContain("user-el");
      // Old AI element must be gone
      expect(ids).not.toContain("old-ai-el");
      // New AI element (from mock) must be present
      expect(ids).toContain("layouted-el");
      // New AI element must carry the tag
      const layoutedEl = elements.find((e) => e.id === "layouted-el");
      expect(layoutedEl?.customData).toEqual({ source: "ai" });
    });
  });

  // ── Merge behaviour — standalone path ──────────────────────────────────────

  describe("merge behaviour — standalone path (whiteboard_id)", () => {
    it("merges: preserves user elements, replaces old AI elements, adds new AI elements", async () => {
      const mixedElements = [
        { id: "user-el", type: "ellipse" },
        { id: "old-ai-el", type: "rectangle", customData: { source: "ai" } },
      ];
      const whiteboard = await createWhiteboardWithElements(workspace.id, mixedElements);
      const { projectId } = await createDiagramRun(workspace.id, { whiteboardId: whiteboard.id });

      await processStakworkRunWebhook(makeWebhookPayload(projectId), {
        type: "DIAGRAM_GENERATION",
        workspace_id: workspace.id,
        whiteboard_id: whiteboard.id,
      });

      const updated = await db.whiteboards.findUnique({
        where: { id: whiteboard.id },
        select: { elements: true },
      });
      const elements = updated!.elements as Array<Record<string, unknown>>;

      const ids = elements.map((e) => e.id);
      // User element must be preserved
      expect(ids).toContain("user-el");
      // Old AI element must be gone
      expect(ids).not.toContain("old-ai-el");
      // New AI element (from mock) must be present
      expect(ids).toContain("layouted-el");
      // New AI element must carry the tag
      const layoutedEl = elements.find((e) => e.id === "layouted-el");
      expect(layoutedEl?.customData).toEqual({ source: "ai" });
    });
  });

  // ── New artifacts[] payload format ─────────────────────────────────────────

  describe("artifacts[] payload format (new Stakwork format)", () => {
    it("processes artifacts format without throwing and updates the whiteboard", async () => {
      const whiteboard = await createWhiteboardWithElements(workspace.id);
      const { projectId } = await createDiagramRun(workspace.id, { whiteboardId: whiteboard.id });

      await expect(
        processStakworkRunWebhook(makeWebhookPayload(projectId, DIAGRAM_RESULT_ARTIFACTS), {
          type: "DIAGRAM_GENERATION",
          workspace_id: workspace.id,
          whiteboard_id: whiteboard.id,
        })
      ).resolves.not.toThrow();

      const updated = await db.whiteboards.findUnique({
        where: { id: whiteboard.id },
        select: { elements: true },
      });
      // The mock relayoutDiagram returns { id: "layouted-el" } — confirm it was persisted
      const elements = updated!.elements as Array<Record<string, unknown>>;
      expect(elements.some((e) => e.id === "layouted-el")).toBe(true);
    });

    it("creates a snapshot before overwriting when artifacts format is used", async () => {
      const whiteboard = await createWhiteboardWithElements(workspace.id, [{ id: "orig-el", type: "text" }]);
      const { projectId } = await createDiagramRun(workspace.id, { whiteboardId: whiteboard.id });

      await processStakworkRunWebhook(makeWebhookPayload(projectId, DIAGRAM_RESULT_ARTIFACTS), {
        type: "DIAGRAM_GENERATION",
        workspace_id: workspace.id,
        whiteboard_id: whiteboard.id,
      });

      const versions = await db.whiteboard_versions.findMany({
        where: { whiteboardId: whiteboard.id },
      });

      expect(versions).toHaveLength(1);
      expect(versions[0].label).toMatch(/^Before AI diagram/);
      // Snapshot captures the original elements
      expect(versions[0].elements).toEqual([{ id: "orig-el", type: "text" }]);
    });

    it("works via feature-linked path with artifacts format", async () => {
      const { feature, whiteboard } = await createFeatureWithWhiteboard(workspace.id, user.id);
      const { projectId } = await createDiagramRun(workspace.id, {feature_id: feature.id });

      await expect(
        processStakworkRunWebhook(makeWebhookPayload(projectId, DIAGRAM_RESULT_ARTIFACTS), {
          type: "DIAGRAM_GENERATION",
          workspace_id: workspace.id,
          feature_id: feature.id,
        })
      ).resolves.not.toThrow();

      const updated = await db.whiteboards.findUnique({
        where: { id: whiteboard.id },
        select: { elements: true },
      });
      const elements = updated!.elements as Array<Record<string, unknown>>;
      expect(elements.some((e) => e.id === "layouted-el")).toBe(true);
    });
  });
});
