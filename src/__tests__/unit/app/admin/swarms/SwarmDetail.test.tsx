// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    variant,
    size,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: string;
    size?: string;
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      data-variant={variant}
      data-size={size}
    >
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <span data-testid="badge" className={className}>
      {children}
    </span>
  ),
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div data-testid="card">{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardHeader: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  CardTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/table", () => ({
  Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
  TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
  TableCell: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <td className={className}>{children}</td>
  ),
  TableHead: ({ children }: { children: React.ReactNode }) => <th>{children}</th>,
  TableHeader: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
  TableRow: ({ children }: { children: React.ReactNode }) => <tr>{children}</tr>,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    children,
    open,
    onOpenChange,
  }: {
    children: React.ReactNode;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div data-testid="dialog-mock" role="dialog">
        {children}
      </div>
    ) : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h3>{children}</h3>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/textarea", () => ({
  Textarea: ({
    value,
    onChange,
    placeholder,
    className,
  }: {
    value: string;
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    placeholder?: string;
    className?: string;
  }) => (
    <textarea
      data-testid="update-node-textarea"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={className}
    />
  ),
}));

// ---------------------------------------------------------------------------
// fetch mock
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
global.fetch = mockFetch;

const MOCK_CONTAINERS = [
  { name: "sphinx", status: "running", image: "sphinxlightning/sphinx-relay:latest" },
  { name: "neo4j", status: "running", image: "neo4j:5" },
  { name: "lnd", status: "stopped", image: "lightninglabs/lnd:v0.18" },
];

function makeListContainersResponse(containers = MOCK_CONTAINERS) {
  return {
    ok: true,
    json: async () => ({ containers }),
  };
}

function makeErrorResponse(status = 500, error = "Internal server error") {
  return {
    ok: false,
    status,
    json: async () => ({ error }),
  };
}

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import SwarmDetail from "@/app/admin/swarms/[instanceId]/SwarmDetail";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SwarmDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("on mount", () => {
    it("fires ListContainers POST to the correct URL", async () => {
      mockFetch.mockResolvedValueOnce(makeListContainersResponse());

      render(<SwarmDetail instanceId="i-123abc" swarmUrl="https://swarm-node-1.sphinx.chat" />);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/admin/swarms/i-123abc/cmd",
          expect.objectContaining({
            method: "POST",
            headers: expect.objectContaining({ "Content-Type": "application/json" }),
            body: expect.stringContaining("ListContainers"),
          })
        );
      });

      const bodyStr = mockFetch.mock.calls[0][1].body as string;
      const body = JSON.parse(bodyStr);
      expect(body.cmd).toEqual({ type: "Swarm", data: { cmd: "ListContainers" } });
      expect(body.swarmUrl).toBe("https://swarm-node-1.sphinx.chat");
    });

    it("passes swarmUrl in the request body", async () => {
      mockFetch.mockResolvedValueOnce(makeListContainersResponse());

      render(<SwarmDetail instanceId="i-abc" swarmUrl="https://swarm-node-2.sphinx.chat" />);

      await waitFor(() => expect(mockFetch).toHaveBeenCalled());

      const body = JSON.parse(mockFetch.mock.calls[0][1].body as string);
      expect(body.swarmUrl).toBe("https://swarm-node-2.sphinx.chat");
    });

    it("shows loading spinner while fetching", () => {
      // Never resolves
      mockFetch.mockImplementation(() => new Promise(() => {}));

      render(<SwarmDetail instanceId="i-123" />);
      expect(screen.getByText("Loading containers…")).toBeInTheDocument();
    });
  });

  describe("container table", () => {
    it("renders container rows with correct Name, Status, and Image", async () => {
      mockFetch.mockResolvedValueOnce(makeListContainersResponse());

      render(<SwarmDetail instanceId="i-123" swarmUrl="https://swarm-node-1.sphinx.chat" />);

      await waitFor(() => {
        expect(screen.getByText("sphinx")).toBeInTheDocument();
        expect(screen.getByText("neo4j")).toBeInTheDocument();
        expect(screen.getByText("lnd")).toBeInTheDocument();
      });

      expect(screen.getByText("sphinxlightning/sphinx-relay:latest")).toBeInTheDocument();
      expect(screen.getByText("neo4j:5")).toBeInTheDocument();
      expect(screen.getByText("lightninglabs/lnd:v0.18")).toBeInTheDocument();
    });

    it("shows Stop button for running containers and Start button for stopped containers", async () => {
      mockFetch.mockResolvedValueOnce(makeListContainersResponse());

      render(<SwarmDetail instanceId="i-123" swarmUrl="https://swarm-node-1.sphinx.chat" />);

      await waitFor(() => expect(screen.getByText("sphinx")).toBeInTheDocument());

      // lnd is stopped — should have Start, no Stop
      const rows = screen.getAllByRole("row");
      // Find row containing "lnd"
      const lndRow = rows.find((r) => r.textContent?.includes("lnd"));
      expect(lndRow).toBeDefined();
      const buttons = lndRow!.querySelectorAll("button");
      const buttonTexts = Array.from(buttons).map((b) => b.textContent);
      expect(buttonTexts).toContain("Start");
      expect(buttonTexts).not.toContain("Stop");

      // sphinx is running — should have Stop, no Start
      const sphinxRow = rows.find((r) => r.textContent?.includes("sphinx"));
      expect(sphinxRow).toBeDefined();
      const sphinxButtons = Array.from(sphinxRow!.querySelectorAll("button")).map((b) => b.textContent);
      expect(sphinxButtons).toContain("Stop");
      expect(sphinxButtons).not.toContain("Start");
    });

    it("always shows Restart and Logs buttons", async () => {
      mockFetch.mockResolvedValueOnce(makeListContainersResponse());

      render(<SwarmDetail instanceId="i-123" swarmUrl="https://swarm-node-1.sphinx.chat" />);

      await waitFor(() => expect(screen.getByText("sphinx")).toBeInTheDocument());

      const restartButtons = screen.getAllByText("Restart");
      const logsButtons = screen.getAllByText("Logs");
      expect(restartButtons).toHaveLength(3); // one per container
      expect(logsButtons).toHaveLength(3);
    });
  });

  describe("container actions", () => {
    it("fires correct cmd payload for Start", async () => {
      mockFetch
        .mockResolvedValueOnce(makeListContainersResponse()) // initial load
        .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) }) // start
        .mockResolvedValueOnce(makeListContainersResponse()); // refresh

      render(<SwarmDetail instanceId="i-123" swarmUrl="https://swarm-node-1.sphinx.chat" />);

      await waitFor(() => expect(screen.getByText("lnd")).toBeInTheDocument());

      fireEvent.click(screen.getByText("Start"));

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));

      const startBody = JSON.parse(mockFetch.mock.calls[1][1].body as string);
      expect(startBody.cmd).toEqual({
        type: "Swarm",
        data: { cmd: "StartContainer", content: "lnd" },
      });
    });

    it("fires correct cmd payload for Stop", async () => {
      mockFetch
        .mockResolvedValueOnce(makeListContainersResponse())
        .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
        .mockResolvedValueOnce(makeListContainersResponse());

      render(<SwarmDetail instanceId="i-123" swarmUrl="https://swarm-node-1.sphinx.chat" />);

      await waitFor(() => expect(screen.getByText("sphinx")).toBeInTheDocument());

      // sphinx row stop button
      const rows = screen.getAllByRole("row");
      const sphinxRow = rows.find((r) => r.textContent?.includes("sphinx"));
      const stopBtn = Array.from(sphinxRow!.querySelectorAll("button")).find(
        (b) => b.textContent === "Stop"
      );
      expect(stopBtn).toBeDefined();
      fireEvent.click(stopBtn!);

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));

      const stopBody = JSON.parse(mockFetch.mock.calls[1][1].body as string);
      expect(stopBody.cmd).toEqual({
        type: "Swarm",
        data: { cmd: "StopContainer", content: "sphinx" },
      });
    });

    it("fires correct cmd payload for Restart", async () => {
      mockFetch
        .mockResolvedValueOnce(makeListContainersResponse())
        .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
        .mockResolvedValueOnce(makeListContainersResponse());

      render(<SwarmDetail instanceId="i-123" swarmUrl="https://swarm-node-1.sphinx.chat" />);

      await waitFor(() => expect(screen.getByText("sphinx")).toBeInTheDocument());

      // Click first Restart button (sphinx)
      fireEvent.click(screen.getAllByText("Restart")[0]);

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));

      const restartBody = JSON.parse(mockFetch.mock.calls[1][1].body as string);
      expect(restartBody.cmd).toEqual({
        type: "Swarm",
        data: { cmd: "RestartContainer", content: "sphinx" },
      });
    });

    it("re-fetches containers after Start/Stop/Restart", async () => {
      mockFetch
        .mockResolvedValueOnce(makeListContainersResponse())
        .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
        .mockResolvedValueOnce(makeListContainersResponse());

      render(<SwarmDetail instanceId="i-123" swarmUrl="https://swarm-node-1.sphinx.chat" />);

      await waitFor(() => expect(screen.getByText("lnd")).toBeInTheDocument());

      fireEvent.click(screen.getByText("Start"));

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));

      // Third call should be ListContainers again
      const refreshBody = JSON.parse(mockFetch.mock.calls[2][1].body as string);
      expect(refreshBody.cmd).toEqual({ type: "Swarm", data: { cmd: "ListContainers" } });
    });

    it("shows success toast after Start", async () => {
      mockFetch
        .mockResolvedValueOnce(makeListContainersResponse())
        .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) })
        .mockResolvedValueOnce(makeListContainersResponse());

      render(<SwarmDetail instanceId="i-123" swarmUrl="https://swarm-node-1.sphinx.chat" />);

      await waitFor(() => expect(screen.getByText("lnd")).toBeInTheDocument());

      fireEvent.click(screen.getByText("Start"));

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith("Container start successful");
      });
    });

    it("shows error toast when container action fails", async () => {
      mockFetch
        .mockResolvedValueOnce(makeListContainersResponse())
        .mockResolvedValueOnce(makeErrorResponse(500, "Command failed"));

      render(<SwarmDetail instanceId="i-123" swarmUrl="https://swarm-node-1.sphinx.chat" />);

      await waitFor(() => expect(screen.getByText("lnd")).toBeInTheDocument());

      fireEvent.click(screen.getByText("Start"));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          "Failed to start container",
          expect.objectContaining({ description: "Command failed" })
        );
      });
    });
  });

  describe("Logs button", () => {
    it("opens dialog with log output", async () => {
      mockFetch
        .mockResolvedValueOnce(makeListContainersResponse())
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ logs: "[mock] 2026-01-01 Container started" }),
        });

      render(<SwarmDetail instanceId="i-123" swarmUrl="https://swarm-node-1.sphinx.chat" />);

      await waitFor(() => expect(screen.getByText("sphinx")).toBeInTheDocument());

      fireEvent.click(screen.getAllByText("Logs")[0]);

      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(screen.getByText("[mock] 2026-01-01 Container started")).toBeInTheDocument();
      });
    });

    it("fires GetContainerLogs cmd with the container name", async () => {
      mockFetch
        .mockResolvedValueOnce(makeListContainersResponse())
        .mockResolvedValueOnce({ ok: true, json: async () => ({ logs: "log data" }) });

      render(<SwarmDetail instanceId="i-123" swarmUrl="https://swarm-node-1.sphinx.chat" />);

      await waitFor(() => expect(screen.getByText("sphinx")).toBeInTheDocument());

      fireEvent.click(screen.getAllByText("Logs")[0]);

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

      const logsBody = JSON.parse(mockFetch.mock.calls[1][1].body as string);
      expect(logsBody.cmd).toEqual({
        type: "Swarm",
        data: { cmd: "GetContainerLogs", content: "sphinx" },
      });
    });
  });

  describe("swarm-level actions", () => {
    it("Get Config fires cmd and displays result in dialog", async () => {
      mockFetch
        .mockResolvedValueOnce(makeListContainersResponse())
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ config: { version: "1.0.0", network: "regtest" } }),
        });

      render(<SwarmDetail instanceId="i-123" swarmUrl="https://swarm-node-1.sphinx.chat" />);

      await waitFor(() => expect(screen.getByText("sphinx")).toBeInTheDocument());

      fireEvent.click(screen.getByText("Get Config"));

      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        // Dialog title appears inside the dialog
        expect(screen.getByText("Command result")).toBeInTheDocument();
      });

      const cmdBody = JSON.parse(mockFetch.mock.calls[1][1].body as string);
      expect(cmdBody.cmd).toEqual({ type: "Swarm", data: { cmd: "GetConfig" } });
    });

    it("List Versions fires correct cmd", async () => {
      mockFetch
        .mockResolvedValueOnce(makeListContainersResponse())
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ versions: ["v1.0.0", "v1.1.0"] }),
        });

      render(<SwarmDetail instanceId="i-123" swarmUrl="https://swarm-node-1.sphinx.chat" />);

      await waitFor(() => expect(screen.getByText("sphinx")).toBeInTheDocument());

      fireEvent.click(screen.getByText("List Versions"));

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

      const body = JSON.parse(mockFetch.mock.calls[1][1].body as string);
      expect(body.cmd).toEqual({ type: "Swarm", data: { cmd: "ListVersions", content: {} } });
    });

    it("Get All Image Versions fires correct cmd", async () => {
      mockFetch
        .mockResolvedValueOnce(makeListContainersResponse())
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ images: { "sphinx-relay": "latest" } }),
        });

      render(<SwarmDetail instanceId="i-123" swarmUrl="https://swarm-node-1.sphinx.chat" />);

      await waitFor(() => expect(screen.getByText("sphinx")).toBeInTheDocument());

      fireEvent.click(screen.getByText("Get All Image Versions"));

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

      const body = JSON.parse(mockFetch.mock.calls[1][1].body as string);
      expect(body.cmd).toEqual({ type: "Swarm", data: { cmd: "GetAllImageActualVersion" } });
    });

    it("Update Node opens dialog, submits JSON payload", async () => {
      mockFetch
        .mockResolvedValueOnce(makeListContainersResponse())
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        });

      render(<SwarmDetail instanceId="i-123" swarmUrl="https://swarm-node-1.sphinx.chat" />);

      await waitFor(() => expect(screen.getByText("sphinx")).toBeInTheDocument());

      fireEvent.click(screen.getByText("Update Node"));

      // Dialog should appear
      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(screen.getByTestId("update-node-textarea")).toBeInTheDocument();
      });

      // Change textarea to custom payload
      fireEvent.change(screen.getByTestId("update-node-textarea"), {
        target: { value: '{"nodeKey": "nodeValue"}' },
      });

      // Submit
      fireEvent.click(screen.getByText("Submit"));

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

      const body = JSON.parse(mockFetch.mock.calls[1][1].body as string);
      expect(body.cmd).toEqual({
        type: "Swarm",
        data: { cmd: "UpdateNode", content: { nodeKey: "nodeValue" } },
      });
    });

    it("shows error toast when swarm action fails", async () => {
      mockFetch
        .mockResolvedValueOnce(makeListContainersResponse())
        .mockResolvedValueOnce(makeErrorResponse(500, "Swarm unreachable"));

      render(<SwarmDetail instanceId="i-123" swarmUrl="https://swarm-node-1.sphinx.chat" />);

      await waitFor(() => expect(screen.getByText("sphinx")).toBeInTheDocument());

      fireEvent.click(screen.getByText("Get Config"));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          "Failed: Get Config",
          expect.objectContaining({ description: "Swarm unreachable" })
        );
      });
    });
  });

  describe("error state", () => {
    it("renders error card when ListContainers fails", async () => {
      mockFetch.mockResolvedValueOnce(makeErrorResponse(502, "Failed to fetch swarm credentials: timeout"));

      render(<SwarmDetail instanceId="i-123" swarmUrl="https://swarm-node-1.sphinx.chat" />);

      await waitFor(() => {
        expect(screen.getByText("Failed to fetch swarm credentials: timeout")).toBeInTheDocument();
      });
    });

    it("renders error when fetch rejects", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      render(<SwarmDetail instanceId="i-123" swarmUrl="https://swarm-node-1.sphinx.chat" />);

      await waitFor(() => {
        expect(screen.getByText("Network error")).toBeInTheDocument();
      });
    });

    it("Retry button re-triggers the fetch", async () => {
      mockFetch
        .mockResolvedValueOnce(makeErrorResponse(502, "Service unavailable"))
        .mockResolvedValueOnce(makeListContainersResponse());

      render(<SwarmDetail instanceId="i-123" swarmUrl="https://swarm-node-1.sphinx.chat" />);

      await waitFor(() => {
        expect(screen.getByText("Service unavailable")).toBeInTheDocument();
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByText("Retry"));

      await waitFor(() => {
        expect(screen.getByText("sphinx")).toBeInTheDocument();
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe("layout", () => {
    it("shows instanceId as title when name is not provided", async () => {
      mockFetch.mockResolvedValueOnce(makeListContainersResponse());

      render(<SwarmDetail instanceId="i-123abc" />);

      await waitFor(() => expect(screen.getByText("i-123abc")).toBeInTheDocument());
    });

    it("shows name prop as title when provided", async () => {
      mockFetch.mockResolvedValueOnce(makeListContainersResponse());

      render(<SwarmDetail instanceId="i-123abc" name="swarm-node-1" />);

      await waitFor(() => expect(screen.getByText("swarm-node-1")).toBeInTheDocument());
    });

    it("renders back link to /admin/swarms", async () => {
      mockFetch.mockResolvedValueOnce(makeListContainersResponse());

      render(<SwarmDetail instanceId="i-123" />);

      const link = screen.getByRole("link", { name: /swarms/i });
      expect(link).toHaveAttribute("href", "/admin/swarms");
    });
  });
});
