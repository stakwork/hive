/**
 * Unit tests for resolveCaptureSource
 *
 * Covers:
 * - AgentLog found and owned by workspace → returns agent_log kind
 * - AgentLog found but belongs to a different workspace → returns { denied: true }
 * - No AgentLog; SharedConversation found via workspaceId → returns conversation kind
 * - No AgentLog; SharedConversation found via org fallback (workspaceId null) → returns conversation kind
 * - No AgentLog; SharedConversation found but wrong workspaceId → returns { denied: true }
 * - Neither record found → returns null
 * - Workspace itself not found → returns null
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    workspace: { findFirst: vi.fn() },
    agentLog: { findUnique: vi.fn() },
    sharedConversation: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/utils/blob-fetch", () => ({
  fetchBlobContent: vi.fn(),
}));

vi.mock("@/lib/utils/agent-log-stats", () => ({
  parseAgentLogStats: vi.fn(),
}));

vi.mock("@/lib/utils/chat-conversation-log", () => ({
  chatMessagesToParsedMessages: vi.fn((msgs) => msgs), // pass-through for simplicity
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { resolveCaptureSource } from "@/lib/eval-capture/resolve-capture-source";
import { db } from "@/lib/db";
import { fetchBlobContent } from "@/lib/utils/blob-fetch";
import { parseAgentLogStats } from "@/lib/utils/agent-log-stats";
import type { Mock } from "vitest";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const WORKSPACE_ID = "ws-111";
const ORG_ID = "org-222";
const SLUG = "test-ws";
const LOG_ID = "log-abc";
const CONV_ID = "conv-xyz";

const WORKSPACE = { id: WORKSPACE_ID, sourceControlOrgId: ORG_ID };

const AGENT_LOG = {
  workspaceId: WORKSPACE_ID,
  blobUrl: "https://store.private.blob.vercel-storage.com/log.json",
  agent: "coding-agent-cmr123",
  source: "repo_agent",
  metadata: null,
  config: { model: "claude-3" },
};

const CONVERSATION_MSG = { role: "user", content: "hello" };

const CONVERSATION_WS = {
  id: CONV_ID,
  workspaceId: WORKSPACE_ID,
  sourceControlOrgId: null,
  source: "canvas",
  messages: [CONVERSATION_MSG],
};

const CONVERSATION_ORG = {
  id: CONV_ID,
  workspaceId: null, // org-scoped
  sourceControlOrgId: ORG_ID,
  source: "org-canvas",
  messages: [CONVERSATION_MSG],
};

const PARSED_MESSAGES = [{ role: "user", content: "hello" }];
const PARSED_CONFIG = { model: "claude-3" };

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();

  (db.workspace.findFirst as Mock).mockResolvedValue(WORKSPACE);
  (db.agentLog.findUnique as Mock).mockResolvedValue(null);
  (db.sharedConversation.findFirst as Mock).mockResolvedValue(null);
  (fetchBlobContent as Mock).mockResolvedValue("{}");
  (parseAgentLogStats as Mock).mockReturnValue({
    conversation: PARSED_MESSAGES,
    config: PARSED_CONFIG,
  });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("resolveCaptureSource", () => {
  describe("workspace not found", () => {
    test("returns null when workspace does not exist", async () => {
      (db.workspace.findFirst as Mock).mockResolvedValue(null);

      const result = await resolveCaptureSource(SLUG, LOG_ID);

      expect(result).toBeNull();
      expect(db.agentLog.findUnique).not.toHaveBeenCalled();
      expect(db.sharedConversation.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("AgentLog branch", () => {
    test("returns agent_log kind when AgentLog is found and owned by workspace", async () => {
      (db.agentLog.findUnique as Mock).mockResolvedValue(AGENT_LOG);

      const result = await resolveCaptureSource(SLUG, LOG_ID);

      expect(result).not.toBeNull();
      expect(result).not.toEqual({ denied: true });
      if (!result || "denied" in result) throw new Error("expected CaptureSource");
      expect(result.kind).toBe("agent_log");
      expect(result.workspaceId).toBe(WORKSPACE_ID);
      expect(result.agent).toBe(AGENT_LOG.agent);
      expect(result.source).toBe(AGENT_LOG.source);
      expect(result.conversation).toEqual(PARSED_MESSAGES);
      // effectiveConfig should come from DB config
      expect(result.effectiveConfig).toEqual(AGENT_LOG.config);
    });

    test("fetches and parses blob content for AgentLog", async () => {
      (db.agentLog.findUnique as Mock).mockResolvedValue(AGENT_LOG);

      await resolveCaptureSource(SLUG, LOG_ID);

      expect(fetchBlobContent).toHaveBeenCalledWith(AGENT_LOG.blobUrl);
      expect(parseAgentLogStats).toHaveBeenCalled();
    });

    test("returns { denied: true } when AgentLog belongs to a different workspace", async () => {
      (db.agentLog.findUnique as Mock).mockResolvedValue({
        ...AGENT_LOG,
        workspaceId: "other-ws-999",
      });

      const result = await resolveCaptureSource(SLUG, LOG_ID);

      expect(result).toEqual({ denied: true });
      // No blob fetch should occur
      expect(fetchBlobContent).not.toHaveBeenCalled();
    });

    test("does NOT fall through to SharedConversation when AgentLog is found (even if it's denied)", async () => {
      (db.agentLog.findUnique as Mock).mockResolvedValue({
        ...AGENT_LOG,
        workspaceId: "different-ws",
      });

      await resolveCaptureSource(SLUG, LOG_ID);

      expect(db.sharedConversation.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("SharedConversation branch", () => {
    test("returns conversation kind when found via workspaceId", async () => {
      (db.agentLog.findUnique as Mock).mockResolvedValue(null);
      (db.sharedConversation.findFirst as Mock).mockResolvedValue(CONVERSATION_WS);

      const result = await resolveCaptureSource(SLUG, CONV_ID);

      expect(result).not.toBeNull();
      if (!result || "denied" in result) throw new Error("expected CaptureSource");
      expect(result.kind).toBe("conversation");
      expect(result.workspaceId).toBe(WORKSPACE_ID);
      expect(result.conversationId).toBe(CONV_ID);
      expect(result.source).toBe("canvas");
    });

    test("does NOT fetch blob for conversation branch", async () => {
      (db.sharedConversation.findFirst as Mock).mockResolvedValue(CONVERSATION_WS);

      await resolveCaptureSource(SLUG, CONV_ID);

      expect(fetchBlobContent).not.toHaveBeenCalled();
    });

    test("returns conversation kind via org fallback when workspaceId is null", async () => {
      (db.agentLog.findUnique as Mock).mockResolvedValue(null);

      // Primary lookup returns null; org fallback returns the conversation
      (db.sharedConversation.findFirst as Mock)
        .mockResolvedValueOnce(null)          // primary (workspaceId match) → miss
        .mockResolvedValueOnce(CONVERSATION_ORG); // org fallback → hit

      const result = await resolveCaptureSource(SLUG, CONV_ID);

      expect(result).not.toBeNull();
      if (!result || "denied" in result) throw new Error("expected CaptureSource");
      expect(result.kind).toBe("conversation");
      // workspaceId comes from the resolved workspace, not the conversation row
      expect(result.workspaceId).toBe(WORKSPACE_ID);
      expect(result.source).toBe("org-canvas");

      // Org-fallback query must include source filter
      const calls = (db.sharedConversation.findFirst as Mock).mock.calls;
      expect(calls).toHaveLength(2);
      expect(calls[1][0].where.source).toEqual({ in: ["org-canvas", "graph-walk"] });
      expect(calls[1][0].where.sourceControlOrgId).toBe(ORG_ID);
    });

    test("skips org fallback when workspace has no sourceControlOrgId", async () => {
      (db.workspace.findFirst as Mock).mockResolvedValue({ id: WORKSPACE_ID, sourceControlOrgId: null });
      (db.sharedConversation.findFirst as Mock).mockResolvedValueOnce(null); // primary miss

      const result = await resolveCaptureSource(SLUG, CONV_ID);

      expect(result).toBeNull();
      // Only one call (primary); no org fallback
      expect(db.sharedConversation.findFirst).toHaveBeenCalledTimes(1);
    });

    test("returns { denied: true } when conversation has non-null workspaceId that doesn't match", async () => {
      (db.sharedConversation.findFirst as Mock).mockResolvedValueOnce({
        ...CONVERSATION_WS,
        workspaceId: "wrong-ws-999",
      });

      const result = await resolveCaptureSource(SLUG, CONV_ID);

      expect(result).toEqual({ denied: true });
    });

    test("returns null when neither AgentLog nor SharedConversation is found", async () => {
      (db.agentLog.findUnique as Mock).mockResolvedValue(null);
      (db.sharedConversation.findFirst as Mock).mockResolvedValue(null);

      const result = await resolveCaptureSource(SLUG, "nonexistent-id");

      expect(result).toBeNull();
    });
  });
});
