import React from "react";
import { describe, test, expect, vi, type Mock } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStatusBadge } from "@/app/w/[slug]/task/[...taskParams]/components/WorkflowStatusBadge";
import { WorkflowStatus } from "@/lib/chat";
import * as useAgentEventsModule from "@/hooks/useAgentEvents";

vi.mock("@/lib/utils", () => ({
  cn: (...classes: (string | boolean | undefined)[]) => classes.filter(Boolean).join(" "),
}));

// Default mock: no events
vi.mock("@/hooks/useAgentEvents", () => ({
  useAgentEvents: vi.fn(() => ({ latestEvent: null, status: "idle" })),
}));

const STAKWORK_URL = "https://jobs.stakwork.com/admin/projects/99999";

describe("WorkflowStatusBadge", () => {
  describe("IN_PROGRESS state", () => {
    test("renders an <a> tag linking to Stakwork when stakworkProjectId is present and isSuperAdmin=true", () => {
      render(
        <WorkflowStatusBadge status={WorkflowStatus.IN_PROGRESS} stakworkProjectId="99999" isSuperAdmin={true} />
      );
      const link = screen.getByRole("link");
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", STAKWORK_URL);
      expect(link).toHaveAttribute("target", "_blank");
    });

    test("renders a <div> (not a link) when stakworkProjectId is absent", () => {
      render(<WorkflowStatusBadge status={WorkflowStatus.IN_PROGRESS} />);
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toBeInTheDocument();
      expect(screen.getByRole("status").tagName).toBe("DIV");
    });

    test("renders a <div> (not a link) when stakworkProjectId is null", () => {
      render(
        <WorkflowStatusBadge status={WorkflowStatus.IN_PROGRESS} stakworkProjectId={null} />
      );
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(screen.getByRole("status").tagName).toBe("DIV");
    });

    test("displays 'Working...' label", () => {
      render(
        <WorkflowStatusBadge status={WorkflowStatus.IN_PROGRESS} stakworkProjectId="99999" />
      );
      expect(screen.getByText("Working...")).toBeInTheDocument();
    });
  });

  describe("Terminal states (regression)", () => {
    test("ERROR + stakworkProjectId + isSuperAdmin=true → renders an <a> tag", () => {
      render(
        <WorkflowStatusBadge status={WorkflowStatus.ERROR} stakworkProjectId="99999" isSuperAdmin={true} />
      );
      const link = screen.getByRole("link");
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", STAKWORK_URL);
    });

    test("HALTED + stakworkProjectId + isSuperAdmin=true → renders an <a> tag", () => {
      render(
        <WorkflowStatusBadge status={WorkflowStatus.HALTED} stakworkProjectId="99999" isSuperAdmin={true} />
      );
      const link = screen.getByRole("link");
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", STAKWORK_URL);
    });

    test("FAILED + stakworkProjectId + isSuperAdmin=true → renders an <a> tag", () => {
      render(
        <WorkflowStatusBadge status={WorkflowStatus.FAILED} stakworkProjectId="99999" isSuperAdmin={true} />
      );
      const link = screen.getByRole("link");
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", STAKWORK_URL);
    });

    test("ERROR without stakworkProjectId → renders a <div>", () => {
      render(<WorkflowStatusBadge status={WorkflowStatus.ERROR} />);
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(screen.getByRole("status").tagName).toBe("DIV");
    });
  });

  describe("Non-clickable states", () => {
    test("PENDING renders a <div> regardless of stakworkProjectId", () => {
      render(
        <WorkflowStatusBadge status={WorkflowStatus.PENDING} stakworkProjectId="99999" />
      );
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(screen.getByRole("status").tagName).toBe("DIV");
    });

    test("COMPLETED renders a <div> regardless of stakworkProjectId", () => {
      render(
        <WorkflowStatusBadge status={WorkflowStatus.COMPLETED} stakworkProjectId="99999" />
      );
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(screen.getByRole("status").tagName).toBe("DIV");
    });
  });

  describe("streamContext / useAgentEvents integration", () => {
    const mockUseAgentEvents = useAgentEventsModule.useAgentEvents as Mock;
    const streamCtx = { requestId: "req-1", eventsToken: "tok-1", baseUrl: "https://agent.example.com" };

    test("renders tool_call event line when IN_PROGRESS with tool_call latestEvent", () => {
      mockUseAgentEvents.mockReturnValueOnce({
        latestEvent: { type: "tool_call", toolName: "search_files" },
        status: "streaming",
      });
      render(
        <WorkflowStatusBadge
          status={WorkflowStatus.IN_PROGRESS}
          stakworkProjectId="99999"
          streamContext={streamCtx}
        />
      );
      expect(screen.getByText("🔧 search_files")).toBeInTheDocument();
    });

    test("renders text event line when IN_PROGRESS with text latestEvent", () => {
      mockUseAgentEvents.mockReturnValueOnce({
        latestEvent: { type: "text", text: "Reading the source file now" },
        status: "streaming",
      });
      render(
        <WorkflowStatusBadge
          status={WorkflowStatus.IN_PROGRESS}
          streamContext={streamCtx}
        />
      );
      expect(screen.getByText("Reading the source file now")).toBeInTheDocument();
    });

    test("truncates text event to 80 chars", () => {
      const longText = "A".repeat(100);
      mockUseAgentEvents.mockReturnValueOnce({
        latestEvent: { type: "text", text: longText },
        status: "streaming",
      });
      render(
        <WorkflowStatusBadge
          status={WorkflowStatus.IN_PROGRESS}
          streamContext={streamCtx}
        />
      );
      expect(screen.getByText("A".repeat(80))).toBeInTheDocument();
      expect(screen.queryByText(longText)).not.toBeInTheDocument();
    });

    test("renders nothing extra when streamContext is null (default mock: null event)", () => {
      // default mock returns { latestEvent: null }
      render(
        <WorkflowStatusBadge
          status={WorkflowStatus.IN_PROGRESS}
          stakworkProjectId="99999"
          streamContext={null}
        />
      );
      expect(screen.queryByText(/🔧/)).not.toBeInTheDocument();
      // The existing label should still be present
      expect(screen.getByText("Working...")).toBeInTheDocument();
    });

    test("does not render event line when status is not IN_PROGRESS even with latestEvent", () => {
      mockUseAgentEvents.mockReturnValueOnce({
        latestEvent: { type: "text", text: "some text" },
        status: "streaming",
      });
      render(
        <WorkflowStatusBadge
          status={WorkflowStatus.COMPLETED}
          streamContext={streamCtx}
        />
      );
      expect(screen.queryByText("some text")).not.toBeInTheDocument();
    });
  });

  describe("isSuperAdmin gating", () => {
    test("IN_PROGRESS + stakworkProjectId + isSuperAdmin=false → renders a <div>, no ExternalLink", () => {
      render(
        <WorkflowStatusBadge
          status={WorkflowStatus.IN_PROGRESS}
          stakworkProjectId="99999"
          isSuperAdmin={false}
        />
      );
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(screen.getByRole("status").tagName).toBe("DIV");
    });

    test("FAILED + stakworkProjectId + isSuperAdmin=false → renders a <div>, no link", () => {
      render(
        <WorkflowStatusBadge
          status={WorkflowStatus.FAILED}
          stakworkProjectId="99999"
          isSuperAdmin={false}
        />
      );
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      expect(screen.getByRole("status").tagName).toBe("DIV");
    });

    test("IN_PROGRESS + stakworkProjectId + isSuperAdmin=true → renders an <a> tag (unchanged behaviour)", () => {
      render(
        <WorkflowStatusBadge
          status={WorkflowStatus.IN_PROGRESS}
          stakworkProjectId="99999"
          isSuperAdmin={true}
        />
      );
      const link = screen.getByRole("link");
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute("href", STAKWORK_URL);
    });

    test("ERROR + stakworkProjectId + isSuperAdmin=true → renders an <a> tag (unchanged behaviour)", () => {
      render(
        <WorkflowStatusBadge
          status={WorkflowStatus.ERROR}
          stakworkProjectId="99999"
          isSuperAdmin={true}
        />
      );
      expect(screen.getByRole("link")).toBeInTheDocument();
    });
  });

  describe("streamContext / useAgentEvents integration", () => {
    const mockUseAgentEvents = useAgentEventsModule.useAgentEvents as Mock;
    const streamCtx = { requestId: "req-1", eventsToken: "tok-1", baseUrl: "https://agent.example.com" };

    test("renders tool_call event line when IN_PROGRESS with tool_call latestEvent", () => {
      mockUseAgentEvents.mockReturnValueOnce({
        latestEvent: { type: "tool_call", toolName: "search_files" },
        status: "streaming",
      });
      render(
        <WorkflowStatusBadge
          status={WorkflowStatus.IN_PROGRESS}
          streamContext={streamCtx}
        />
      );
      expect(screen.getByText("🔧 search_files")).toBeInTheDocument();
    });

    test("renders text event line when IN_PROGRESS with text latestEvent", () => {
      mockUseAgentEvents.mockReturnValueOnce({
        latestEvent: { type: "text", text: "Reading the source file now" },
        status: "streaming",
      });
      render(
        <WorkflowStatusBadge
          status={WorkflowStatus.IN_PROGRESS}
          streamContext={streamCtx}
        />
      );
      expect(screen.getByText("Reading the source file now")).toBeInTheDocument();
    });

    test("truncates text event to 80 chars", () => {
      const longText = "A".repeat(100);
      mockUseAgentEvents.mockReturnValueOnce({
        latestEvent: { type: "text", text: longText },
        status: "streaming",
      });
      render(
        <WorkflowStatusBadge
          status={WorkflowStatus.IN_PROGRESS}
          streamContext={streamCtx}
        />
      );
      expect(screen.getByText("A".repeat(80))).toBeInTheDocument();
      expect(screen.queryByText(longText)).not.toBeInTheDocument();
    });

    test("renders nothing extra when streamContext is null (default mock: null event)", () => {
      // default mock returns { latestEvent: null }
      render(
        <WorkflowStatusBadge
          status={WorkflowStatus.IN_PROGRESS}
          stakworkProjectId="99999"
          streamContext={null}
        />
      );
      expect(screen.queryByText(/🔧/)).not.toBeInTheDocument();
      // The existing label should still be present
      expect(screen.getByText("Working...")).toBeInTheDocument();
    });

    test("does not render event line when status is not IN_PROGRESS even with latestEvent", () => {
      mockUseAgentEvents.mockReturnValueOnce({
        latestEvent: { type: "text", text: "some text" },
        status: "streaming",
      });
      render(
        <WorkflowStatusBadge
          status={WorkflowStatus.COMPLETED}
          streamContext={streamCtx}
        />
      );
      expect(screen.queryByText("some text")).not.toBeInTheDocument();
    });
  });
});
