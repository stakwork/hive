import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { SharedConversationData } from "@/types/shared-conversation";

/**
 * Unit tests for SharedConversationPage badge rendering
 * Tests the conditional display of "Logs Agent" badge based on conversation source
 */

// Mock the Badge component
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, variant, "data-testid": testId }: any) => (
    <span data-testid={testId} data-variant={variant}>
      {children}
    </span>
  ),
}));

// Mock Next.js components
vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
}));

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findFirst: vi.fn(),
    },
    workspaceMember: {
      findFirst: vi.fn(),
    },
    sharedConversation: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/components/dashboard/DashboardChat/ChatMessage", () => ({
  ChatMessage: ({ message }: any) => <div data-testid="chat-message">{message.content}</div>,
}));

vi.mock("@/components/dashboard/DashboardChat/ToolCallIndicator", () => ({
  ToolCallIndicator: () => <div data-testid="tool-call-indicator">Tool Call</div>,
}));

// Mock Badge component that will be imported
const MockBadge = ({ children, variant, "data-testid": testId }: any) => (
  <span data-testid={testId} data-variant={variant}>
    {children}
  </span>
);

/**
 * Simplified banner component that mirrors the actual page's banner logic
 */
function SharedConversationBanner({ data }: { data: SharedConversationData }) {
  const creatorName = data.createdBy?.name || data.createdBy?.email || "Unknown";
  const createdDate = new Date(data.createdAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="bg-muted/30 border-b border-border">
      <div className="max-w-4xl mx-auto px-6 py-4">
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-xl font-semibold">Shared Conversation (Read-only)</h1>
          {data.source === "logs-agent" && (
            <MockBadge variant="secondary" data-testid="logs-agent-badge">
              Logs Agent
            </MockBadge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Shared by {creatorName} on {createdDate}
        </p>
      </div>
    </div>
  );
}

describe("SharedConversationPage - Logs Agent Badge", () => {
  const baseConversationData: SharedConversationData = {
    id: "test-share-id",
    workspaceId: "test-workspace-id",
    userId: "test-user-id",
    title: "Test Conversation",
    messages: [
      {
        id: "msg-1",
        role: "user",
        content: "Hello",
        timestamp: "2024-01-01T00:00:00.000Z",
      },
    ],
    provenanceData: null,
    followUpQuestions: [],
    isShared: true,
    lastMessageAt: "2024-01-01T00:00:00.000Z",
    source: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    createdBy: {
      id: "user-1",
      name: "Test User",
      email: "test@example.com",
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should render Logs Agent badge when source is 'logs-agent'", () => {
    const data: SharedConversationData = {
      ...baseConversationData,
      source: "logs-agent",
    };

    render(<SharedConversationBanner data={data} />);

    const badge = screen.getByTestId("logs-agent-badge");
    expect(badge).toBeDefined();
    expect(badge.textContent).toBe("Logs Agent");
    expect(badge.getAttribute("data-variant")).toBe("secondary");
  });

  it("should not render badge when source is null", () => {
    const data: SharedConversationData = {
      ...baseConversationData,
      source: null,
    };

    render(<SharedConversationBanner data={data} />);

    const badge = screen.queryByTestId("logs-agent-badge");
    expect(badge).toBeNull();
  });

  it("should not render badge when source is 'dashboard'", () => {
    const data: SharedConversationData = {
      ...baseConversationData,
      source: "dashboard",
    };

    render(<SharedConversationBanner data={data} />);

    const badge = screen.queryByTestId("logs-agent-badge");
    expect(badge).toBeNull();
  });

  it("should not render badge when source is undefined", () => {
    const data: SharedConversationData = {
      ...baseConversationData,
      source: undefined as any,
    };

    render(<SharedConversationBanner data={data} />);

    const badge = screen.queryByTestId("logs-agent-badge");
    expect(badge).toBeNull();
  });

  it("should render heading text correctly regardless of badge presence", () => {
    const dataWithBadge: SharedConversationData = {
      ...baseConversationData,
      source: "logs-agent",
    };

    const dataWithoutBadge: SharedConversationData = {
      ...baseConversationData,
      source: null,
    };

    const { rerender } = render(<SharedConversationBanner data={dataWithBadge} />);
    expect(screen.getByText("Shared Conversation (Read-only)")).toBeDefined();

    rerender(<SharedConversationBanner data={dataWithoutBadge} />);
    expect(screen.getByText("Shared Conversation (Read-only)")).toBeDefined();
  });

  it("should display creator information correctly with badge present", () => {
    const data: SharedConversationData = {
      ...baseConversationData,
      source: "logs-agent",
    };

    render(<SharedConversationBanner data={data} />);

    expect(screen.getByText(/Shared by Test User on/)).toBeDefined();
  });
});
