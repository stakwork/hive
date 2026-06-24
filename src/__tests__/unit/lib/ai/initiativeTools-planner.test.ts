/**
 * Unit tests for `buildInitiativeTools` — `send_to_feature_planner` model forwarding.
 *
 * Verifies that `chatAgentModel` passed to `buildInitiativeTools` is
 * forwarded as the `model` arg to `sendFeatureChatMessage`, covering
 * features whose `Feature.model` is not already set (e.g. features not
 * created via canvas). When absent, `sendFeatureChatMessage` is called
 * without a `model` arg so the existing `getDefaultModel("plan")`
 * fallback is unchanged.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    feature: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: { findUnique: vi.fn() },
    initiative: { findFirst: vi.fn() },
    milestone: { findFirst: vi.fn() },
    workspace: { findFirst: vi.fn() },
  },
}));

vi.mock("@/services/roadmap/feature-chat", () => ({
  sendFeatureChatMessage: vi.fn(),
}));

vi.mock("@/lib/canvas", () => ({
  notifyFeatureReassignmentRefresh: vi.fn(),
  notifyCanvasUpdated: vi.fn(),
}));

vi.mock("@/services/orgs/nodeDetail", () => ({
  loadNodeDetail: vi.fn(),
}));

import { db } from "@/lib/db";
import { sendFeatureChatMessage } from "@/services/roadmap/feature-chat";
import { buildInitiativeTools } from "@/lib/ai/initiativeTools";

const SEND_TO_FEATURE_PLANNER = "send_to_feature_planner";

function getFeaturePlannerTool(chatAgentModel?: string) {
  const tools = buildInitiativeTools("org_1", "user_1", undefined, chatAgentModel);
  const t = tools[SEND_TO_FEATURE_PLANNER];
  if (!t || typeof t !== "object" || !("execute" in t)) {
    throw new Error("send_to_feature_planner tool not registered");
  }
  return t as unknown as {
    execute: (input: { featureId: string; message: string }) => Promise<unknown>;
  };
}

function mockFeature(overrides: Partial<{
  workflowStatus: string;
  parentCanvasConversationId: string | null;
  orgId: string;
}> = {}) {
  (db.feature.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "feat_1",
    title: "Test Feature",
    workspaceId: "ws_1",
    workflowStatus: overrides.workflowStatus ?? "COMPLETED",
    parentCanvasConversationId: overrides.parentCanvasConversationId ?? null,
    workspace: {
      slug: "test-ws",
      name: "Test Workspace",
      sourceControlOrgId: overrides.orgId ?? "org_1",
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (db.feature.update as ReturnType<typeof vi.fn>).mockResolvedValue({});
  (sendFeatureChatMessage as ReturnType<typeof vi.fn>).mockResolvedValue({
    chatMessage: { id: "msg_1" },
    stakworkData: null,
  });
});

describe("send_to_feature_planner — chatAgentModel forwarding", () => {
  it("forwards chatAgentModel as model to sendFeatureChatMessage when supplied", async () => {
    mockFeature();
    const tool = getFeaturePlannerTool("anthropic/claude-opus-4-6");

    const result = await tool.execute({ featureId: "feat_1", message: "Hello planner" });

    expect(result).toMatchObject({ status: "sent" });
    expect(sendFeatureChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        featureId: "feat_1",
        model: "anthropic/claude-opus-4-6",
      }),
    );
  });

  it("does not pass model to sendFeatureChatMessage when chatAgentModel is absent", async () => {
    mockFeature();
    const tool = getFeaturePlannerTool(); // no chatAgentModel

    const result = await tool.execute({ featureId: "feat_1", message: "Hello planner" });

    expect(result).toMatchObject({ status: "sent" });
    const call = (sendFeatureChatMessage as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call).not.toHaveProperty("model");
  });

  it("forwards a non-Anthropic model unchanged", async () => {
    mockFeature();
    const tool = getFeaturePlannerTool("openai/gpt-4o");

    await tool.execute({ featureId: "feat_1", message: "Hello planner" });

    expect(sendFeatureChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({ model: "openai/gpt-4o" }),
    );
  });

  it("does not call sendFeatureChatMessage when the planner is IN_PROGRESS", async () => {
    mockFeature({ workflowStatus: "IN_PROGRESS" });
    const tool = getFeaturePlannerTool("anthropic/claude-opus-4-6");

    const result = await tool.execute({ featureId: "feat_1", message: "Hello planner" }) as { error?: string };

    expect(result.error).toMatch(/planner is currently running/i);
    expect(sendFeatureChatMessage).not.toHaveBeenCalled();
  });
});
