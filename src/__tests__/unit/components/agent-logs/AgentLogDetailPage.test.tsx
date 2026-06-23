/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

globalThis.React = React;

let mockSlug = "other-workspace";
const mockLogId = "log-abc";

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: mockSlug, logId: mockLogId }),
  useRouter: () => ({ push: vi.fn() }),
}));

const capturedOnFlagTurn: Array<((i: number) => void) | undefined> = [];

vi.mock("@/components/agent-logs/LogDetailContent", () => ({
  LogDetailContent: ({ onFlagTurn }: { onFlagTurn?: (i: number) => void }) => {
    capturedOnFlagTurn.push(onFlagTurn);
    return React.createElement("div", { "data-testid": "log-detail-content" });
  },
}));

vi.mock("@/components/evals/FlagAsEvalModal", () => ({
  FlagAsEvalModal: () => React.createElement("div", { "data-testid": "flag-eval-modal" }),
}));

vi.mock("@/components/evals/AgentSessionCaptureModal", () => ({
  AgentSessionCaptureModal: () => React.createElement("div", { "data-testid": "capture-modal" }),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }) =>
    React.createElement("button", { onClick, disabled }, children),
}));

vi.mock("@/components/ui/page-header", () => ({
  PageHeader: () => React.createElement("div", null, "Page Header"),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("lucide-react", () => ({
  ArrowLeft: () => React.createElement("span", null, "←"),
  FileText: () => React.createElement("span", null, "📄"),
  Flag: () => React.createElement("span", null, "🚩"),
  Share2: () => React.createElement("span", null, "🔗"),
}));

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

describe("AgentLogDetailPage — onFlagTurn gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnFlagTurn.length = 0;
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ conversation: [], stats: null }) });
  });

  it("does NOT pass onFlagTurn to LogDetailContent when slug is not 'stakwork'", async () => {
    mockSlug = "other-workspace";
    const { default: AgentLogDetailPage } = await import("@/app/w/[slug]/agent-logs/[logId]/page");
    render(React.createElement(AgentLogDetailPage));
    expect(capturedOnFlagTurn[0]).toBeUndefined();
  });

  it("passes onFlagTurn to LogDetailContent when slug is 'stakwork'", async () => {
    mockSlug = "stakwork";
    const { default: AgentLogDetailPage } = await import("@/app/w/[slug]/agent-logs/[logId]/page");
    render(React.createElement(AgentLogDetailPage));
    expect(capturedOnFlagTurn[0]).toBeTypeOf("function");
  });
});
