// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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
    ...rest
  }: {
    children: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: string;
    size?: string;
    [key: string]: unknown;
  }) => (
    <button
      onClick={onClick}
      disabled={disabled}
      data-variant={variant}
      data-size={size}
      {...rest}
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

const MOCK_IMAGE_VERSIONS = [
  { name: "sphinx", version: "1.0.0", is_latest: false, latest_version: "1.2.0" },
  { name: "neo4j", version: "5", is_latest: true, latest_version: "5" },
  { name: "lnd", version: "unavailable", is_latest: false, latest_version: "v0.18" },
  { name: "orphan", version: "9.9.9", is_latest: false, latest_version: "10.0.0" },
];

type FetchInit = { method?: string; body?: string; headers?: Record<string, string> };

function getPostedCmd(init: FetchInit | undefined): string | undefined {
  if (!init?.body) return undefined;
  try {
    return JSON.parse(init.body)?.cmd?.data?.cmd;
  } catch {
    return undefined;
  }
}

function cmdCalls(cmd: string) {
  return mockFetch.mock.calls.filter(([, init]) => getPostedCmd(init as FetchInit) === cmd);
}

function lastCmdBody(cmd: string) {
  const calls = cmdCalls(cmd);
  expect(calls.length).toBeGreaterThan(0);
  return JSON.parse((calls[calls.length - 1][1] as { body: string }).body);
}

// The real /api/admin/swarms/[instanceId]/cmd route returns the full
// SwarmCmdResponse envelope `{ ok, status, data, rawText }`. For
// ListContainers, sphinx-swarm serializes `Vec<ContainerSummary>` directly,
// so `.data` is a BARE ARRAY of containers (not `{ containers: [...] }`).
function makeListContainersResponse(containers: unknown = MOCK_CONTAINERS) {
  return {
    ok: true,
    json: async () => ({ ok: true, status: 200, data: containers }),
  };
}

function makeImageVersionsResponse(
  versions: unknown = MOCK_IMAGE_VERSIONS,
  extras: { ok?: boolean; status?: number } = {}
) {
  return {
    ok: true,
    json: async () => ({
      ok: extras.ok ?? true,
      status: extras.status ?? 200,
      data: {
        success: true,
        message: "image versions retrieved",
        data: versions,
      },
    }),
  };
}

function makeGenericSuccess(data: unknown = { success: true }) {
  return {
    ok: true,
    json: async () => ({ ok: true, status: 200, data }),
  };
}

function makeInstanceResponse(tags = [{ key: "UserAssignedName", value: "swarm-node-1" }]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      instanceId: "i-123",
      name: "swarm-node-1",
      state: "running",
      tags,
    }),
  };
}

function makeErrorResponse(status = 500, error = "Internal server error") {
  return {
    ok: false,
    status,
    json: async () => ({ error }),
  };
}

function cmdAwareFetch(overrides?: {
  listContainers?: () => Promise<unknown>;
  imageVersions?: () => Promise<unknown>;
  other?: (cmd: string | undefined, url: string, init?: FetchInit) => Promise<unknown> | undefined;
  nonCmd?: (url: string, init?: FetchInit) => Promise<unknown> | undefined;
}) {
  return (url: string, init?: FetchInit) => {
    if (typeof url === "string" && url.endsWith("/cmd") && init?.method === "POST") {
      const cmd = getPostedCmd(init);
      if (cmd === "ListContainers") {
        return overrides?.listContainers
          ? overrides.listContainers()
          : Promise.resolve(makeListContainersResponse());
      }
      if (cmd === "GetAllImageActualVersion") {
        return overrides?.imageVersions
          ? overrides.imageVersions()
          : Promise.resolve(makeImageVersionsResponse());
      }
      const other = overrides?.other?.(cmd, url, init);
      if (other !== undefined) return other;
      return Promise.resolve(makeGenericSuccess());
    }
    const nonCmd = overrides?.nonCmd?.(url, init);
    if (nonCmd !== undefined) return nonCmd;
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  };
}

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import SwarmDetail from "@/app/admin/swarms/[instanceId]/SwarmDetail";
import { toast } from "sonner";

// HostStorageCard / FluentbitStatsCard are their own components with their
// own suites; mocked here so SwarmDetail tests stay scoped to the
// containers/actions behaviour (on-mount GETs would otherwise become
// mockFetch's first calls).
vi.mock("@/app/admin/swarms/[instanceId]/HostStorageCard", () => ({
  default: ({ instanceId }: { instanceId: string }) => (
    <div data-testid="host-storage-card-mock" data-instance-id={instanceId} />
  ),
}));

vi.mock("@/app/admin/swarms/[instanceId]/FluentbitStatsCard", () => ({
  default: ({ instanceId }: { instanceId: string }) => (
    <div data-testid="fluentbit-stats-card-mock" data-instance-id={instanceId} />
  ),
}));

async function renderReady() {
  render(<SwarmDetail instanceId="i-123" swarmUrl="https://swarm-node-1.sphinx.chat" />);
  await waitFor(() => expect(screen.getByText("sphinx")).toBeInTheDocument());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SwarmDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockImplementation(cmdAwareFetch());
  });

  describe("on mount", () => {
    it("fires ListContainers POST to the correct URL", async () => {
      render(<SwarmDetail instanceId="i-123abc" swarmUrl="https://swarm-node-1.sphinx.chat" />);

      await waitFor(() => {
        expect(cmdCalls("ListContainers").length).toBeGreaterThan(0);
      });

      const call = cmdCalls("ListContainers")[0];
      expect(call[0]).toBe("/api/admin/swarms/i-123abc/cmd");
      expect(call[1]).toEqual(
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ "Content-Type": "application/json" }),
        })
      );
      const body = JSON.parse((call[1] as { body: string }).body);
      expect(body.cmd).toEqual({ type: "Swarm", data: { cmd: "ListContainers" } });
      expect(body.swarmUrl).toBe("https://swarm-node-1.sphinx.chat");
    });

    it("passes swarmUrl in the request body", async () => {
      render(<SwarmDetail instanceId="i-abc" swarmUrl="https://swarm-node-2.sphinx.chat" />);

      await waitFor(() => expect(cmdCalls("ListContainers").length).toBeGreaterThan(0));

      const body = lastCmdBody("ListContainers");
      expect(body.swarmUrl).toBe("https://swarm-node-2.sphinx.chat");
    });

    it("renders the Host Storage and FluentBit stats cards for the instance", async () => {
      render(<SwarmDetail instanceId="i-abc" swarmUrl="https://swarm-node-1.sphinx.chat" />);

      await waitFor(() => expect(cmdCalls("ListContainers").length).toBeGreaterThan(0));

      const storage = screen.getByTestId("host-storage-card-mock");
      expect(storage).toHaveAttribute("data-instance-id", "i-abc");
      const fluentbit = screen.getByTestId("fluentbit-stats-card-mock");
      expect(fluentbit).toHaveAttribute("data-instance-id", "i-abc");
    });

    it("shows loading spinner while fetching", () => {
      mockFetch.mockImplementation(() => new Promise(() => {}));

      render(<SwarmDetail instanceId="i-123" />);
      expect(screen.getByText("Loading containers…")).toBeInTheDocument();
    });

    it("silently fetches GetAllImageActualVersion after containers load", async () => {
      await renderReady();

      await waitFor(() => {
        expect(cmdCalls("GetAllImageActualVersion").length).toBe(1);
      });
      expect(toast.error).not.toHaveBeenCalled();
    });
  });

  describe("container table", () => {
    it("renders container rows when the swarm host returns a bare array under data", async () => {
      await renderReady();

      expect(screen.getByText("sphinx")).toBeInTheDocument();
      expect(screen.getByText("neo4j")).toBeInTheDocument();
      expect(screen.getByText("lnd")).toBeInTheDocument();
    });

    it('renders "No containers found." when the swarm host returns an empty array', async () => {
      mockFetch.mockImplementation(
        cmdAwareFetch({
          listContainers: () => Promise.resolve(makeListContainersResponse([])),
        })
      );

      render(<SwarmDetail instanceId="i-123" swarmUrl="https://swarm-node-1.sphinx.chat" />);

      await waitFor(() => {
        expect(screen.getByText("No containers found.")).toBeInTheDocument();
      });
    });

    it("renders container rows with correct Name, Status, and Image", async () => {
      await renderReady();

      expect(screen.getByText("sphinxlightning/sphinx-relay:latest")).toBeInTheDocument();
      expect(screen.getByText("neo4j:5")).toBeInTheDocument();
      expect(screen.getByText("lightninglabs/lnd:v0.18")).toBeInTheDocument();
    });

    it("shows Stop button for running containers and Start button for stopped containers", async () => {
      await renderReady();

      const rows = screen.getAllByRole("row");
      const lndRow = rows.find((r) => r.textContent?.includes("lnd"));
      expect(lndRow).toBeDefined();
      const buttons = lndRow!.querySelectorAll("button");
      const buttonTexts = Array.from(buttons).map((b) => b.textContent);
      expect(buttonTexts).toContain("Start");
      expect(buttonTexts).not.toContain("Stop");

      const sphinxRow = rows.find((r) => r.textContent?.includes("sphinx"));
      expect(sphinxRow).toBeDefined();
      const sphinxButtons = Array.from(sphinxRow!.querySelectorAll("button")).map((b) => b.textContent);
      expect(sphinxButtons).toContain("Stop");
      expect(sphinxButtons).not.toContain("Start");
    });

    it("always shows Restart and Logs buttons", async () => {
      await renderReady();

      const restartButtons = screen.getAllByText("Restart");
      const logsButtons = screen.getAllByText("Logs");
      expect(restartButtons).toHaveLength(3);
      expect(logsButtons).toHaveLength(3);
    });
  });

  describe("pending update indicator", () => {
    it("shows the update-available icon only on the outdated row", async () => {
      await renderReady();

      await waitFor(() => {
        expect(screen.getByTestId("container-update-available-sphinx")).toBeInTheDocument();
      });

      expect(screen.queryByTestId("container-update-available-neo4j")).not.toBeInTheDocument();
      expect(screen.queryByTestId("container-update-available-lnd")).not.toBeInTheDocument();
      expect(screen.queryByTestId("container-update-available-orphan")).not.toBeInTheDocument();

      const icon = screen.getByTestId("container-update-available-sphinx");
      expect(icon).toHaveAttribute("aria-label", "Update available");
      expect(icon).toHaveAttribute("title", "1.0.0 → 1.2.0");
    });

    it("joins boltwall.sphinx container to a boltwall version entry", async () => {
      mockFetch.mockImplementation(
        cmdAwareFetch({
          listContainers: () =>
            Promise.resolve(
              makeListContainersResponse([
                { name: "boltwall.sphinx", status: "running", image: "sphinxlightning/boltwall:latest" },
              ])
            ),
          imageVersions: () =>
            Promise.resolve(
              makeImageVersionsResponse([
                { name: "boltwall", version: "1.0.0", is_latest: false, latest_version: "1.2.0" },
              ])
            ),
        })
      );

      render(<SwarmDetail instanceId="i-123" swarmUrl="https://swarm-node-1.sphinx.chat" />);

      await waitFor(() => {
        expect(screen.getByTestId("container-update-available-boltwall.sphinx")).toBeInTheDocument();
      });

      const icon = screen.getByTestId("container-update-available-boltwall.sphinx");
      expect(icon).toHaveAttribute("title", "1.0.0 → 1.2.0");
    });

    it("joins sphinx-swarm container to a swarm version entry", async () => {
      mockFetch.mockImplementation(
        cmdAwareFetch({
          listContainers: () =>
            Promise.resolve(
              makeListContainersResponse([
                { name: "sphinx-swarm", status: "running", image: "sphinxlightning/sphinx-swarm:latest" },
              ])
            ),
          imageVersions: () =>
            Promise.resolve(
              makeImageVersionsResponse([
                { name: "swarm", version: "1.0.0", is_latest: false, latest_version: "1.2.0" },
              ])
            ),
        })
      );

      render(<SwarmDetail instanceId="i-123" swarmUrl="https://swarm-node-1.sphinx.chat" />);

      await waitFor(() => {
        expect(screen.getByTestId("container-update-available-sphinx-swarm")).toBeInTheDocument();
      });

      const icon = screen.getByTestId("container-update-available-sphinx-swarm");
      expect(icon).toHaveAttribute("title", "1.0.0 → 1.2.0");
    });

    it("does not show a badge while versions are in-flight", async () => {
      mockFetch.mockImplementation(
        cmdAwareFetch({
          imageVersions: () => new Promise(() => {}),
        })
      );

      await renderReady();

      // Update stays visible while versionsLoading so admins can force-update
      // without waiting for the version check to resolve.
      expect(screen.getByTestId("container-update-sphinx")).toBeInTheDocument();
      expect(screen.queryByTestId("container-update-available-sphinx")).not.toBeInTheDocument();
      expect(screen.queryByTestId("container-update-pending-sphinx")).not.toBeInTheDocument();
    });

    it("does not show a badge when the versions fetch fails with an HTTP error", async () => {
      mockFetch.mockImplementation(
        cmdAwareFetch({
          imageVersions: () => Promise.resolve(makeErrorResponse(500, "versions down")),
        })
      );

      await renderReady();

      await waitFor(() => {
        expect(screen.queryByTestId("container-update-sphinx")).not.toBeInTheDocument();
      });

      expect(screen.getByText("sphinx")).toBeInTheDocument();
      expect(screen.queryByTestId("container-update-available-sphinx")).not.toBeInTheDocument();
      expect(toast.error).not.toHaveBeenCalled();
    });

    it("does not show a badge when the versions envelope has ok: false", async () => {
      mockFetch.mockImplementation(
        cmdAwareFetch({
          imageVersions: () => Promise.resolve(makeImageVersionsResponse(MOCK_IMAGE_VERSIONS, { ok: false, status: 502 })),
        })
      );

      await renderReady();

      await waitFor(() => {
        expect(screen.queryByTestId("container-update-sphinx")).not.toBeInTheDocument();
      });

      expect(screen.getByText("sphinx")).toBeInTheDocument();
      expect(screen.queryByTestId("container-update-available-sphinx")).not.toBeInTheDocument();
      expect(toast.error).not.toHaveBeenCalled();
    });

    it("shows an update-pending tag only on the outdated row", async () => {
      await renderReady();

      await waitFor(() => {
        expect(screen.getByTestId("container-update-pending-sphinx")).toBeInTheDocument();
      });

      expect(screen.queryByTestId("container-update-pending-neo4j")).not.toBeInTheDocument();
      expect(screen.queryByTestId("container-update-pending-lnd")).not.toBeInTheDocument();

      const tag = screen.getByTestId("container-update-pending-sphinx");
      expect(tag).toHaveAttribute("title", "1.0.0 → 1.2.0");
      expect(tag).toHaveTextContent("update pending");
    });

    it("does not show an update-pending tag while versions are in-flight", async () => {
      mockFetch.mockImplementation(
        cmdAwareFetch({
          imageVersions: () => new Promise(() => {}),
        })
      );

      await renderReady();

      expect(screen.queryByTestId("container-update-pending-sphinx")).not.toBeInTheDocument();
    });
  });

  describe("container actions", () => {
    it("fires correct cmd payload for Start", async () => {
      await renderReady();

      fireEvent.click(screen.getByText("Start"));

      await waitFor(() => expect(cmdCalls("StartContainer").length).toBe(1));

      expect(lastCmdBody("StartContainer").cmd).toEqual({
        type: "Swarm",
        data: { cmd: "StartContainer", content: "lnd" },
      });
    });

    it("fires correct cmd payload for Stop", async () => {
      await renderReady();

      const rows = screen.getAllByRole("row");
      const sphinxRow = rows.find((r) => r.textContent?.includes("sphinx"));
      const stopBtn = Array.from(sphinxRow!.querySelectorAll("button")).find(
        (b) => b.textContent === "Stop"
      );
      expect(stopBtn).toBeDefined();
      fireEvent.click(stopBtn!);

      await waitFor(() => expect(cmdCalls("StopContainer").length).toBe(1));

      expect(lastCmdBody("StopContainer").cmd).toEqual({
        type: "Swarm",
        data: { cmd: "StopContainer", content: "sphinx" },
      });
    });

    it("fires correct cmd payload for Restart", async () => {
      await renderReady();

      fireEvent.click(screen.getAllByText("Restart")[0]);

      await waitFor(() => expect(cmdCalls("RestartContainer").length).toBe(1));

      expect(lastCmdBody("RestartContainer").cmd).toEqual({
        type: "Swarm",
        data: { cmd: "RestartContainer", content: "sphinx" },
      });
    });

    it("re-fetches containers after Start/Stop/Restart", async () => {
      await renderReady();

      fireEvent.click(screen.getByText("Start"));

      await waitFor(() => expect(cmdCalls("ListContainers").length).toBe(2));

      expect(lastCmdBody("ListContainers").cmd).toEqual({
        type: "Swarm",
        data: { cmd: "ListContainers" },
      });
    });

    it("shows success toast after Start", async () => {
      await renderReady();

      fireEvent.click(screen.getByText("Start"));

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith("Container start successful");
      });
    });

    it("shows error toast when container action fails", async () => {
      mockFetch.mockImplementation(
        cmdAwareFetch({
          other: (cmd) => {
            if (cmd === "StartContainer") {
              return Promise.resolve(makeErrorResponse(500, "Command failed"));
            }
            return undefined;
          },
        })
      );

      await renderReady();

      fireEvent.click(screen.getByText("Start"));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          "Failed to start container",
          expect.objectContaining({ description: "Command failed" })
        );
      });
    });
  });

  describe("container update action", () => {
    it("shows an Update button only on outdated containers after versions settle", async () => {
      await renderReady();

      await waitFor(() => {
        expect(screen.getByTestId("container-update-available-sphinx")).toBeInTheDocument();
      });

      expect(screen.getByTestId("container-update-sphinx")).toBeInTheDocument();
      expect(screen.queryByTestId("container-update-neo4j")).not.toBeInTheDocument();
      expect(screen.queryByTestId("container-update-lnd")).not.toBeInTheDocument();
    });

    it("shows an Update button on a stopped container that has a pending update", async () => {
      mockFetch.mockImplementation(
        cmdAwareFetch({
          listContainers: () =>
            Promise.resolve(
              makeListContainersResponse([
                { name: "relay", status: "stopped", image: "sphinxlightning/relay:1.0.0" },
              ])
            ),
          imageVersions: () =>
            Promise.resolve(
              makeImageVersionsResponse([
                { name: "relay", version: "1.0.0", is_latest: false, latest_version: "1.2.0" },
              ])
            ),
        })
      );

      render(<SwarmDetail instanceId="i-123" swarmUrl="https://swarm-node-1.sphinx.chat" />);

      await waitFor(() => {
        expect(screen.getByTestId("container-update-available-relay")).toBeInTheDocument();
      });

      expect(screen.getByTestId("container-update-relay")).toBeInTheDocument();
    });

    it("hides the Update button for up-to-date containers after versions settle", async () => {
      await renderReady();

      await waitFor(() => {
        expect(screen.getByTestId("container-update-available-sphinx")).toBeInTheDocument();
      });

      expect(screen.queryByTestId("container-update-neo4j")).not.toBeInTheDocument();
    });

    it("opens a confirm dialog naming the container and does not POST until confirm", async () => {
      await renderReady();

      fireEvent.click(screen.getByTestId("container-update-sphinx"));

      const dialog = screen.getByRole("dialog");
      expect(dialog).toBeInTheDocument();
      expect(within(dialog).getByText("Update container sphinx?")).toBeInTheDocument();
      expect(
        within(dialog).getByText(/stops and recreates sphinx from latest/i)
      ).toBeInTheDocument();

      expect(cmdCalls("UpdateNode")).toHaveLength(0);
    });

    it("Cancel closes the dialog and issues no request", async () => {
      await renderReady();

      fireEvent.click(screen.getByTestId("container-update-sphinx"));
      const dialog = screen.getByRole("dialog");
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

      await waitFor(() => {
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      });
      expect(cmdCalls("UpdateNode")).toHaveLength(0);
    });

    it("Confirm posts UpdateNode with id and version latest", async () => {
      await renderReady();

      fireEvent.click(screen.getByTestId("container-update-sphinx"));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Update" }));

      await waitFor(() => expect(cmdCalls("UpdateNode").length).toBe(1));

      expect(lastCmdBody("UpdateNode").cmd).toEqual({
        type: "Swarm",
        data: { cmd: "UpdateNode", content: { id: "sphinx", version: "latest" } },
      });
    });

    it("shows success toast and re-fetches containers after a successful update", async () => {
      await renderReady();

      fireEvent.click(screen.getByTestId("container-update-sphinx"));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Update" }));

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith("Container update successful");
      });

      await waitFor(() => expect(cmdCalls("ListContainers").length).toBe(2));
      expect(lastCmdBody("ListContainers").cmd).toEqual({
        type: "Swarm",
        data: { cmd: "ListContainers" },
      });
    });

    it("shows error toast when update fails", async () => {
      mockFetch.mockImplementation(
        cmdAwareFetch({
          other: (cmd) => {
            if (cmd === "UpdateNode") {
              return Promise.resolve(makeErrorResponse(500, "Command failed"));
            }
            return undefined;
          },
        })
      );

      await renderReady();

      fireEvent.click(screen.getByTestId("container-update-sphinx"));
      fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Update" }));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          "Failed to update container",
          expect.objectContaining({ description: "Command failed" })
        );
      });
    });

    it("does not POST twice when Confirm is clicked rapidly", async () => {
      let resolveUpdate: (value: unknown) => void = () => {};
      const updatePromise = new Promise((resolve) => {
        resolveUpdate = resolve;
      });

      mockFetch.mockImplementation(
        cmdAwareFetch({
          other: (cmd) => {
            if (cmd === "UpdateNode") return updatePromise;
            return undefined;
          },
        })
      );

      await renderReady();

      fireEvent.click(screen.getByTestId("container-update-sphinx"));
      const confirmBtn = within(screen.getByRole("dialog")).getByRole("button", { name: "Update" });
      fireEvent.click(confirmBtn);
      fireEvent.click(confirmBtn);

      await waitFor(() => expect(cmdCalls("UpdateNode").length).toBe(1));
      expect(cmdCalls("UpdateNode")).toHaveLength(1);

      resolveUpdate(makeGenericSuccess());
      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith("Container update successful");
      });
    });
  });

  describe("Logs button", () => {
    it("opens dialog with log output", async () => {
      mockFetch.mockImplementation(
        cmdAwareFetch({
          other: (cmd) => {
            if (cmd === "GetContainerLogs") {
              return Promise.resolve({
                ok: true,
                json: async () => ({ logs: "[mock] 2026-01-01 Container started" }),
              });
            }
            return undefined;
          },
        })
      );

      await renderReady();

      fireEvent.click(screen.getAllByText("Logs")[0]);

      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(screen.getByText("[mock] 2026-01-01 Container started")).toBeInTheDocument();
      });
    });

    it("fires GetContainerLogs cmd with the container name", async () => {
      mockFetch.mockImplementation(
        cmdAwareFetch({
          other: (cmd) => {
            if (cmd === "GetContainerLogs") {
              return Promise.resolve({ ok: true, json: async () => ({ logs: "log data" }) });
            }
            return undefined;
          },
        })
      );

      await renderReady();

      fireEvent.click(screen.getAllByText("Logs")[0]);

      await waitFor(() => expect(cmdCalls("GetContainerLogs").length).toBe(1));

      expect(lastCmdBody("GetContainerLogs").cmd).toEqual({
        type: "Swarm",
        data: {
          cmd: "GetContainerLogs",
          content: { name: "sphinx", before_timestamp: null, since_timestamp: null },
        },
      });
    });

    it("sends content as an object (not a bare string) for GetContainerLogs", async () => {
      mockFetch.mockImplementation(
        cmdAwareFetch({
          other: (cmd) => {
            if (cmd === "GetContainerLogs") {
              return Promise.resolve({ ok: true, json: async () => ({ logs: "log data" }) });
            }
            return undefined;
          },
        })
      );

      await renderReady();

      fireEvent.click(screen.getAllByText("Logs")[1]);

      await waitFor(() => expect(cmdCalls("GetContainerLogs").length).toBe(1));

      const logsBody = lastCmdBody("GetContainerLogs");
      expect(logsBody.cmd.data.content).toEqual({
        name: "neo4j",
        before_timestamp: null,
        since_timestamp: null,
      });
      expect(typeof logsBody.cmd.data.content).not.toBe("string");
    });
  });

  describe("swarm-level actions", () => {
    it("Get Config fires cmd and displays result in dialog", async () => {
      mockFetch.mockImplementation(
        cmdAwareFetch({
          other: (cmd) => {
            if (cmd === "GetConfig") {
              return Promise.resolve({
                ok: true,
                json: async () => ({ config: { version: "1.0.0", network: "regtest" } }),
              });
            }
            return undefined;
          },
        })
      );

      await renderReady();

      fireEvent.click(screen.getByText("Get Config"));

      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(screen.getByText("Command result")).toBeInTheDocument();
      });

      expect(lastCmdBody("GetConfig").cmd).toEqual({ type: "Swarm", data: { cmd: "GetConfig" } });
    });

    it("List Versions fires correct cmd", async () => {
      mockFetch.mockImplementation(
        cmdAwareFetch({
          other: (cmd) => {
            if (cmd === "ListVersions") {
              return Promise.resolve({
                ok: true,
                json: async () => ({ versions: ["v1.0.0", "v1.1.0"] }),
              });
            }
            return undefined;
          },
        })
      );

      await renderReady();

      fireEvent.click(screen.getByText("List Versions"));

      await waitFor(() => expect(cmdCalls("ListVersions").length).toBe(1));

      expect(lastCmdBody("ListVersions").cmd).toEqual({
        type: "Swarm",
        data: { cmd: "ListVersions", content: {} },
      });
    });

    it("Get All Image Versions dumps JSON via a distinct POST from the on-load fetch", async () => {
      await renderReady();

      await waitFor(() => expect(cmdCalls("GetAllImageActualVersion").length).toBe(1));

      fireEvent.click(screen.getByText("Get All Image Versions"));

      await waitFor(() => expect(cmdCalls("GetAllImageActualVersion").length).toBe(2));

      expect(lastCmdBody("GetAllImageActualVersion").cmd).toEqual({
        type: "Swarm",
        data: { cmd: "GetAllImageActualVersion" },
      });

      await waitFor(() => {
        const dialog = screen.getByRole("dialog");
        expect(within(dialog).getByText("Get All Image Versions")).toBeInTheDocument();
        expect(dialog.textContent).toContain('"name": "sphinx"');
        expect(dialog.textContent).toContain('"is_latest": false');
      });
    });

    it("Update Node opens dialog, submits JSON payload", async () => {
      await renderReady();

      fireEvent.click(screen.getByText("Update Node"));

      await waitFor(() => {
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(screen.getByTestId("update-node-textarea")).toBeInTheDocument();
      });

      fireEvent.change(screen.getByTestId("update-node-textarea"), {
        target: { value: '{"nodeKey": "nodeValue"}' },
      });

      fireEvent.click(screen.getByText("Submit"));

      await waitFor(() => expect(cmdCalls("UpdateNode").length).toBe(1));

      expect(lastCmdBody("UpdateNode").cmd).toEqual({
        type: "Swarm",
        data: { cmd: "UpdateNode", content: { nodeKey: "nodeValue" } },
      });
    });

    it("shows error toast when swarm action fails", async () => {
      mockFetch.mockImplementation(
        cmdAwareFetch({
          other: (cmd) => {
            if (cmd === "GetConfig") {
              return Promise.resolve(makeErrorResponse(500, "Swarm unreachable"));
            }
            return undefined;
          },
        })
      );

      await renderReady();

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
      mockFetch.mockImplementation(
        cmdAwareFetch({
          listContainers: () =>
            Promise.resolve(makeErrorResponse(502, "Failed to fetch swarm credentials: timeout")),
        })
      );

      render(<SwarmDetail instanceId="i-123" swarmUrl="https://swarm-node-1.sphinx.chat" />);

      await waitFor(() => {
        expect(screen.getByText("Failed to fetch swarm credentials: timeout")).toBeInTheDocument();
      });
      expect(cmdCalls("GetAllImageActualVersion")).toHaveLength(0);
    });

    it("renders error when fetch rejects", async () => {
      mockFetch.mockImplementation(
        cmdAwareFetch({
          listContainers: () => Promise.reject(new Error("Network error")),
        })
      );

      render(<SwarmDetail instanceId="i-123" swarmUrl="https://swarm-node-1.sphinx.chat" />);

      await waitFor(() => {
        expect(screen.getByText("Network error")).toBeInTheDocument();
      });
    });

    it("Retry button re-triggers the fetch", async () => {
      let listShouldFail = true;
      mockFetch.mockImplementation(
        cmdAwareFetch({
          listContainers: () => {
            if (listShouldFail) {
              return Promise.resolve(makeErrorResponse(502, "Service unavailable"));
            }
            return Promise.resolve(makeListContainersResponse());
          },
        })
      );

      render(<SwarmDetail instanceId="i-123" swarmUrl="https://swarm-node-1.sphinx.chat" />);

      await waitFor(() => {
        expect(screen.getByText("Service unavailable")).toBeInTheDocument();
      });

      expect(cmdCalls("ListContainers")).toHaveLength(1);

      listShouldFail = false;
      fireEvent.click(screen.getByText("Retry"));

      await waitFor(() => {
        expect(screen.getByText("sphinx")).toBeInTheDocument();
      });

      expect(cmdCalls("ListContainers")).toHaveLength(2);
    });
  });

  describe("swarmUrl resolution", () => {
    it("with swarmUrl prop present, does not GET the instance and fires ListContainers once", async () => {
      await renderReady();

      expect(cmdCalls("ListContainers")).toHaveLength(1);
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/admin/swarms/i-123/cmd",
        expect.objectContaining({ method: "POST" })
      );
      expect(mockFetch.mock.calls.some(([url]) => url === "/api/admin/swarms/i-123")).toBe(false);
    });

    it("with swarmUrl absent, waits for GET then fires ListContainers once", async () => {
      let resolveGet: (value: unknown) => void = () => {};
      const getPromise = new Promise((resolve) => {
        resolveGet = resolve;
      });

      mockFetch.mockImplementation(
        cmdAwareFetch({
          nonCmd: (url, init) => {
            if (!init?.method || init.method === "GET") {
              return getPromise;
            }
            return undefined;
          },
        })
      );

      render(<SwarmDetail instanceId="i-123" />);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith("/api/admin/swarms/i-123");
      });

      expect(cmdCalls("ListContainers")).toHaveLength(0);
      expect(screen.getByText("Loading containers…")).toBeInTheDocument();

      resolveGet(makeInstanceResponse());

      await waitFor(() => expect(screen.getByText("sphinx")).toBeInTheDocument());

      expect(cmdCalls("ListContainers")).toHaveLength(1);
      expect(lastCmdBody("ListContainers").swarmUrl).toBe("https://swarm-node-1.sphinx.chat");
    });

    it("surfaces a non-blocking error on 404 and issues no commands", async () => {
      mockFetch.mockImplementation(
        cmdAwareFetch({
          nonCmd: () =>
            Promise.resolve({
              ok: false,
              status: 404,
              json: async () => ({ error: "Instance not found" }),
            }),
        })
      );

      render(<SwarmDetail instanceId="i-missing" />);

      await waitFor(() => {
        expect(screen.getByText("Instance not found")).toBeInTheDocument();
      });

      expect(cmdCalls("ListContainers")).toHaveLength(0);
      expect(cmdCalls("GetAllImageActualVersion")).toHaveLength(0);
    });

    it("surfaces a non-blocking error when UserAssignedName is missing and issues no commands", async () => {
      mockFetch.mockImplementation(
        cmdAwareFetch({
          nonCmd: () => Promise.resolve(makeInstanceResponse([])),
        })
      );

      render(<SwarmDetail instanceId="i-123" />);

      await waitFor(() => {
        expect(
          screen.getByText("Could not resolve swarm URL — UserAssignedName tag is missing")
        ).toBeInTheDocument();
      });

      expect(cmdCalls("ListContainers")).toHaveLength(0);
      expect(cmdCalls("GetAllImageActualVersion")).toHaveLength(0);
    });
  });

  describe("layout", () => {
    it("shows instanceId as title when name is not provided", async () => {
      render(<SwarmDetail instanceId="i-123abc" swarmUrl="https://swarm-node-1.sphinx.chat" />);

      await waitFor(() => expect(screen.getByText("i-123abc")).toBeInTheDocument());
    });

    it("shows name prop as title when provided", async () => {
      render(
        <SwarmDetail instanceId="i-123abc" name="swarm-node-1" swarmUrl="https://swarm-node-1.sphinx.chat" />
      );

      await waitFor(() => expect(screen.getByText("swarm-node-1")).toBeInTheDocument());
    });

    it("renders back link to /admin/swarms", async () => {
      render(<SwarmDetail instanceId="i-123" swarmUrl="https://swarm-node-1.sphinx.chat" />);

      const link = screen.getByRole("link", { name: /swarms/i });
      expect(link).toHaveAttribute("href", "/admin/swarms");

      await waitFor(() => expect(screen.getByText("sphinx")).toBeInTheDocument());
    });
  });
});
