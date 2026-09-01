// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import React from "react";

// ---------------------------------------------------------------------------
// Mocks — UI primitives only; the component under test uses the real
// formatBytes + plain text nodes.
// ---------------------------------------------------------------------------

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
    <button onClick={onClick} disabled={disabled} data-variant={variant} data-size={size}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className, ...props }: { children: React.ReactNode; className?: string } & Record<string, unknown>) => (
    <span data-testid="badge" className={className} {...props}>
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

vi.mock("@/components/ui/progress", () => ({
  Progress: ({ value, ...props }: { value?: number } & Record<string, unknown>) => (
    <div role="progressbar" data-value={value} {...props} />
  ),
}));

vi.mock("@/components/ui/table", () => ({
  Table: ({ children }: { children: React.ReactNode }) => <table>{children}</table>,
  TableBody: ({ children }: { children: React.ReactNode }) => <tbody>{children}</tbody>,
  TableCell: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <td className={className}>{children}</td>
  ),
  TableHead: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <th className={className}>{children}</th>
  ),
  TableHeader: ({ children }: { children: React.ReactNode }) => <thead>{children}</thead>,
  TableRow: ({ children }: { children: React.ReactNode }) => <tr>{children}</tr>,
}));

import HostStorageCard from "@/app/admin/swarms/[instanceId]/HostStorageCard";

// ---------------------------------------------------------------------------
// Response builders (the wire shape of GET …/storage)
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function okReading(overrides: Json = {}): Json {
  const gov = {
    mount: "/",
    device: "/dev/nvme0n1p1",
    fstype: "ext4",
    totalBytes: 85899345920, // 80 GB
    usedBytes: 21474836480, // 20 GB
    freeBytes: 64424509440, // 60 GB
    describesHost: true,
  };
  return {
    status: "OK",
    hostVisible: true,
    source: "node_exporter",
    collectedAt: 1730000000,
    cached: false,
    filesystems: [gov],
    dockerRootDir: "/var/lib/docker",
    dockerRootFilesystem: "/",
    governingFilesystem: gov,
    volumes: [{ name: "neo4j.sphinx", sizeBytes: 10737418240, sizeKnown: true }], // 10 GB
    neo4j: { volumes: ["neo4j.sphinx"], sizeBytes: 10737418240, sizeKnown: true },
    errors: [],
    ...overrides,
  };
}

function freshResponse(reading: Json): Json {
  return { outcome: "fresh", reading, collectedAt: reading.collectedAt, cached: false };
}

function fetchResponse(body: Json | null, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  };
}

async function renderWithFetch(response: ReturnType<typeof fetchResponse>) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  render(React.createElement(HostStorageCard, { instanceId: "i-0abc123def" }));
  return fetchMock;
}

describe("HostStorageCard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the headline free bytes, Progress bar and figures for a fresh OK reading", async () => {
    const reading = okReading();
    await renderWithFetch(fetchResponse(freshResponse(reading)));

    await waitFor(() => {
      expect(screen.getByTestId("free-bytes")).toHaveTextContent("60 GB");
    });
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByTestId("source-badge")).toHaveTextContent("node_exporter");
    expect(screen.getByText(/Collected: 2024-10-27 03:33/)).toBeInTheDocument();
    expect(screen.queryByTestId("cached-label")).not.toBeInTheDocument();
  });

  it("renders 'unknown' for null figures, never a fabricated 0", async () => {
    const reading = okReading({
      filesystems: [
        {
          mount: "/",
          device: "/dev/nvme0n1p1",
          fstype: "ext4",
          totalBytes: null,
          usedBytes: null,
          freeBytes: null,
          describesHost: true,
        },
      ],
      governingFilesystem: null,
      volumes: [
        { name: "neo4j.sphinx", sizeBytes: null, sizeKnown: false },
        { name: "sphinx-data", sizeBytes: 536870912, sizeKnown: true },
      ],
      neo4j: { volumes: ["neo4j.sphinx"], sizeBytes: null, sizeKnown: false },
    });
    await renderWithFetch(fetchResponse(freshResponse(reading)));

    await waitFor(() => {
      expect(screen.getAllByText("unknown").length).toBeGreaterThan(0);
    });
    expect(screen.queryByText(/0 B/)).not.toBeInTheDocument();
    // No progress bar without known capacity.
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    // Known volume sizes still render precisely.
    expect(screen.getByText("512 MB")).toBeInTheDocument();
  });

  it("renders 'Not present' when neo4j is null, not an error", async () => {
    const reading = okReading({ neo4j: null });
    // The neo4j volume stays in the volumes list, so "other volumes" = all.
    await renderWithFetch(fetchResponse(freshResponse(reading)));

    await waitFor(() => {
      expect(screen.getByTestId("neo4j-absent")).toHaveTextContent("Not present");
    });
    expect(screen.queryByTestId("neo4j-size")).not.toBeInTheDocument();
  });

  it("with host_visible: false, suppresses host-capacity figures and the Progress bar but keeps volume and Neo4j sizes", async () => {
    const reading = okReading({
      hostVisible: false,
      neo4j: { volumes: ["neo4j.sphinx"], sizeBytes: 10737418240, sizeKnown: true },
      volumes: [
        { name: "neo4j.sphinx", sizeBytes: 10737418240, sizeKnown: true },
        { name: "sphinx-data", sizeBytes: 536870912, sizeKnown: true },
      ],
    });
    await renderWithFetch(fetchResponse(freshResponse(reading)));

    await waitFor(() => {
      expect(screen.getByTestId("host-invisible-notice")).toBeInTheDocument();
    });
    expect(screen.getByText(/could not see the host/i)).toBeInTheDocument();
    // Host-capacity figures suppressed:
    expect(screen.queryByTestId("host-capacity")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.queryByTestId("free-bytes")).not.toBeInTheDocument();
    // Container-level readings stay visible:
    expect(screen.getByText(/Size: 10 GB/)).toBeInTheDocument();
    expect(screen.getByText("512 MB")).toBeInTheDocument();
  });

  it("renders errors[] as inline warnings alongside a valid PARTIAL reading", async () => {
    const reading = okReading({
      status: "PARTIAL",
      errors: [{ collector: "volumes", reason: "docker df timed out after 8s" }],
    });
    await renderWithFetch(fetchResponse(freshResponse(reading)));

    await waitFor(() => {
      expect(screen.getByTestId("errors-warnings")).toBeInTheDocument();
    });
    expect(screen.getByText(/volumes: docker df timed out after 8s/)).toBeInTheDocument();
    // The rest of the reading is still shown (partial success, not failure).
    expect(screen.getByTestId("free-bytes")).toBeInTheDocument();
  });

  it("labels a cached reading as cached, with the original collection time", async () => {
    const reading = okReading();
    const response = {
      outcome: "cached",
      reading,
      collectedAt: 1730000000,
      cached: true,
    };
    await renderWithFetch(fetchResponse(response));

    await waitFor(() => {
      const label = screen.getByTestId("cached-label");
      expect(label).toHaveTextContent(/Cached reading from/);
      expect(label).toHaveTextContent(/2024-10-27 03:33/);
    });
  });

  it("renders 'unreachable now' and 'no linked swarm record' as visibly distinct states", async () => {
    await renderWithFetch(fetchResponse({ outcome: "unreachable", reasonCode: "TIMEOUT", cached: false }));
    await waitFor(() => {
      expect(screen.getByText(/couldn't reach the swarm just now/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/reason: TIMEOUT/i)).toBeInTheDocument();
    expect(screen.queryByText(/no linked swarm record/i)).not.toBeInTheDocument();

    // Now the no-record state (fresh render).
    cleanup();
    await renderWithFetch(fetchResponse({ outcome: "no_swarm_record", reasonCode: "NO_SWARM_RECORD", cached: false }));
    await waitFor(() => {
      expect(screen.getByText(/no linked swarm record/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/couldn't reach the swarm just now/i)).not.toBeInTheDocument();
    expect(screen.getByText(/telemetry is unavailable/i)).toBeInTheDocument();
  });

  it("renders explanatory copy for a failed read (e.g. CONFIG_INVALID) rather than a blank error", async () => {
    await renderWithFetch(
      fetchResponse({ outcome: "failed", reasonCode: "CONFIG_INVALID", cached: false }),
    );
    await waitFor(() => {
      expect(screen.getByText(/not configured for host storage reads/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/CONFIG_INVALID/)).toBeInTheDocument();
  });

  it("renders a 409 ambiguous outcome as its own distinct state", async () => {
    await renderWithFetch(fetchResponse({ outcome: "ambiguous", reasonCode: "AMBIGUOUS", cached: false }, true, 409));
    await waitFor(() => {
      expect(screen.getByText(/multiple linked swarm records/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/rather than an arbitrary one/i)).toBeInTheDocument();
  });

  it("Refresh re-issues the same GET", async () => {
    const reading = okReading();
    const fetchMock = await renderWithFetch(fetchResponse(freshResponse(reading)));

    await waitFor(() => {
      expect(screen.getByTestId("free-bytes")).toBeInTheDocument();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/admin/swarms/i-0abc123def/storage", {
      method: "GET",
    });
  });

  it("truncates over-long swarm-derived strings for display (plain text only)", async () => {
    const longName = "v".repeat(200);
    const reading = okReading({
      volumes: [{ name: longName, sizeBytes: 1024, sizeKnown: true }],
      neo4j: null,
    });
    await renderWithFetch(fetchResponse(freshResponse(reading)));

    await waitFor(() => {
      const cell = screen.getByText(/^v+…$/);
      expect(cell.textContent?.length).toBe(81); // 80 chars + ellipsis
    });
  });
});
