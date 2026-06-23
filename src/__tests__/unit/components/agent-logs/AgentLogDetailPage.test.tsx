/**
 * @vitest-environment jsdom
 *
 * Tests that AgentLogDetailPage gates onFlagTurn to "stakwork" slug only.
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

globalThis.React = React;

// ── Captured props ────────────────────────────────────────────────────────────
let capturedOnFlagTurn: ((i: number) => void) | undefined;

vi.mock("@/components/agent-logs/LogDetailContent", () => ({
  LogDetailContent: (props: { onFlagTurn?: (i: number) => void; [key: string]: unknown }) => {
    capturedOnFlagTurn = props.onFlagTurn;
    return React.createElement("div", { "data-testid": "log-detail-content" });
  },
}));

vi.mock("@/components/evals/FlagAsEvalModal", () => ({
  FlagAsEvalModal: () => React.createElement("div", { "data-testid": "flag-modal" }),
}));

vi.mock("@/components/evals/AgentSessionCaptureModal", () => ({
  AgentSessionCaptureModal: () => React.createElement("div", { "data-testid": "capture-modal" }),
}));

vi.mock("@/components/ui/page-header", () => ({
  PageHeader: () => React.createElement("div"),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled }: { children?: React.ReactNode; onClick?: () => void; disabled?: boolean }) =>
    React.createElement("button", { onClick, disabled }, children),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("lucide-react", () => ({
  ArrowLeft: () => React.createElement("span"),
  FileText: () => React.createElement("span"),
  Flag: () => React.createElement("span"),
  Share2: () => React.createElement("span"),
}));

let mockSlug = "stakwork";
let mockLogId = "log-abc";

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: mockSlug, logId: mockLogId }),
  useRouter: () => ({ push: vi.fn() }),
}));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

async function renderPage() {
  capturedOnFlagTurn = undefined;
  const { default: AgentLogDetailPage } = await import(
    "@/app/w/[slug]/agent-logs/[logId]/page"
  );
  render(React.createElement(AgentLogDetailPage));
  await waitFor(() => {
    expect(screen.getByTestId("log-detail-content")).toBeTruthy();
  });
}

describe("AgentLogDetailPage — onFlagTurn gating", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        conversation: [{ role: "assistant", content: "hi" }],
        stats: {},
        config: null,
      }),
    });
  });

  it("passes onFlagTurn to LogDetailContent when slug is 'stakwork'", async () => {
    mockSlug = "stakwork";
    await renderPage();
    expect(typeof capturedOnFlagTurn).toBe("function");
  });

  it("does NOT pass onFlagTurn to LogDetailContent when slug is not 'stakwork'", async () => {
    mockSlug = "other-org";
    await renderPage();
    expect(capturedOnFlagTurn).toBeUndefined();
  });

  it("does NOT pass onFlagTurn to LogDetailContent when slug is 'STAKWORK' (case-sensitive)", async () => {
    mockSlug = "STAKWORK";
    await renderPage();
    expect(capturedOnFlagTurn).toBeUndefined();
  });
});
