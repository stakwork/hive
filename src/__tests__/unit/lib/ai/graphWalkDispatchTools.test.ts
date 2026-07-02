/**
 * Unit tests for buildGraphWalkDispatchTools.
 *
 * Coverage:
 *   dispatch_graph_walk:
 *     - Happy path: pushes intent to collector, returns { status: "dispatched" }.
 *     - No-op when collector is absent.
 *     - No-op when currentCanvasConversationId is absent.
 *     - Generated graphWalkId is a valid UUID.
 *
 *   finalize_graph_walk:
 *     - Writes answer to graphWalkAnswerSink when present.
 *     - Returns no-op guidance when sink is absent (parent context).
 */

import { describe, test, expect } from "vitest";
import {
  buildGraphWalkDispatchTools,
  type DispatchedGraphWalkIntent,
} from "@/lib/ai/graphWalkDispatchTools";
import type { CapabilityContext } from "@/lib/ai/capabilities";

// Minimal CapabilityContext factory.
function makeCtx(
  overrides: Partial<CapabilityContext> = {},
): CapabilityContext {
  return {
    orgId: "org-1",
    userId: "user-1",
    capturedWebSearchResults: [],
    ...overrides,
  };
}

const BASE_INPUT = {
  title: "Find files linked to AuthFeature",
  prompt: "Search for all File nodes connected to the AuthFeature HiveFeature node.",
};

// ─── dispatch_graph_walk ────────────────────────────────────────────

describe("dispatch_graph_walk", () => {
  test("pushes an intent and returns { status: 'dispatched' }", async () => {
    const collector: DispatchedGraphWalkIntent[] = [];
    const ctx = makeCtx({
      dispatchedGraphWalks: collector,
      currentCanvasConversationId: "conv-1",
    });
    const tools = buildGraphWalkDispatchTools(ctx);
    const tool = tools["dispatch_graph_walk"] as unknown as { execute: (a: unknown) => Promise<unknown> };
    const result = await tool.execute(BASE_INPUT);

    expect(result).toMatchObject({ status: "dispatched" });
    expect(collector).toHaveLength(1);
    expect(collector[0]).toMatchObject({
      title: BASE_INPUT.title,
      prompt: BASE_INPUT.prompt,
      conversationId: "conv-1",
      orgId: "org-1",
      userId: "user-1",
    });
  });

  test("generated graphWalkId is a valid UUID", async () => {
    const collector: DispatchedGraphWalkIntent[] = [];
    const ctx = makeCtx({
      dispatchedGraphWalks: collector,
      currentCanvasConversationId: "conv-1",
    });
    const tools = buildGraphWalkDispatchTools(ctx);
    const tool = tools["dispatch_graph_walk"] as unknown as { execute: (a: unknown) => Promise<unknown> };
    await tool.execute(BASE_INPUT);

    const { graphWalkId } = collector[0];
    expect(graphWalkId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  test("returned graphWalkId matches the intent in the collector", async () => {
    const collector: DispatchedGraphWalkIntent[] = [];
    const ctx = makeCtx({
      dispatchedGraphWalks: collector,
      currentCanvasConversationId: "conv-1",
    });
    const tools = buildGraphWalkDispatchTools(ctx);
    const tool = tools["dispatch_graph_walk"] as unknown as { execute: (a: unknown) => Promise<{ graphWalkId?: string }> };
    const result = await tool.execute(BASE_INPUT);

    expect(result.graphWalkId).toBe(collector[0].graphWalkId);
  });

  test("no-op when dispatchedGraphWalks collector is absent", async () => {
    const ctx = makeCtx({
      // no dispatchedGraphWalks
      currentCanvasConversationId: "conv-1",
    });
    const tools = buildGraphWalkDispatchTools(ctx);
    const tool = tools["dispatch_graph_walk"] as unknown as { execute: (a: unknown) => Promise<{ status: string }> };
    const result = await tool.execute(BASE_INPUT);

    expect(result.status).toBe("no-op");
  });

  test("no-op when currentCanvasConversationId is absent", async () => {
    const collector: DispatchedGraphWalkIntent[] = [];
    const ctx = makeCtx({
      dispatchedGraphWalks: collector,
      // no currentCanvasConversationId
    });
    const tools = buildGraphWalkDispatchTools(ctx);
    const tool = tools["dispatch_graph_walk"] as unknown as { execute: (a: unknown) => Promise<{ status: string }> };
    const result = await tool.execute(BASE_INPUT);

    expect(result.status).toBe("no-op");
    expect(collector).toHaveLength(0);
  });

  test("multiple dispatches push multiple intents", async () => {
    const collector: DispatchedGraphWalkIntent[] = [];
    const ctx = makeCtx({
      dispatchedGraphWalks: collector,
      currentCanvasConversationId: "conv-1",
    });
    const tools = buildGraphWalkDispatchTools(ctx);
    const tool = tools["dispatch_graph_walk"] as unknown as { execute: (a: unknown) => Promise<unknown> };

    await tool.execute({ title: "Query A", prompt: "Walk from A to B" });
    await tool.execute({ title: "Query B", prompt: "Walk from B to C" });

    expect(collector).toHaveLength(2);
    expect(collector[0].title).toBe("Query A");
    expect(collector[1].title).toBe("Query B");
    // Each has a unique graphWalkId
    expect(collector[0].graphWalkId).not.toBe(collector[1].graphWalkId);
  });
});

// ─── finalize_graph_walk ────────────────────────────────────────────

describe("finalize_graph_walk", () => {
  test("writes answer to the sink and returns { status: 'finalized' }", async () => {
    const sink = { answer: null as string | null };
    const ctx = makeCtx({ graphWalkAnswerSink: sink });
    const tools = buildGraphWalkDispatchTools(ctx);
    const tool = tools["finalize_graph_walk"] as unknown as { execute: (a: unknown) => Promise<unknown> };

    const result = await tool.execute({ answer: "The answer to your question is 42." });

    expect(result).toMatchObject({ status: "finalized" });
    expect(sink.answer).toBe("The answer to your question is 42.");
  });

  test("no-op when graphWalkAnswerSink is absent (parent context)", async () => {
    const ctx = makeCtx({
      // no graphWalkAnswerSink
    });
    const tools = buildGraphWalkDispatchTools(ctx);
    const tool = tools["finalize_graph_walk"] as unknown as { execute: (a: unknown) => Promise<{ status: string }> };

    const result = await tool.execute({ answer: "Some answer" });

    expect(result.status).toBe("no-op");
  });

  test("overwrites a previously written answer", async () => {
    const sink = { answer: "first answer" as string | null };
    const ctx = makeCtx({ graphWalkAnswerSink: sink });
    const tools = buildGraphWalkDispatchTools(ctx);
    const tool = tools["finalize_graph_walk"] as unknown as { execute: (a: unknown) => Promise<unknown> };

    await tool.execute({ answer: "updated answer" });

    expect(sink.answer).toBe("updated answer");
  });
});
