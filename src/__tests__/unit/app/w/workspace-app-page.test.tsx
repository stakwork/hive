/**
 * The pinned app's page (`/w/[slug]/apps/[...name]`): the app the sidebar
 * links to, framed from the workspace's swarm at its active version.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import React, { Suspense } from "react";

const { frame } = vi.hoisted(() => ({ frame: vi.fn() }));

vi.mock("@/hooks/useWorkspace", () => ({ useWorkspace: vi.fn() }));
vi.mock("@/hooks/useWorkspaceStrutApps", () => ({ useWorkspaceStrutApps: vi.fn() }));
vi.mock("@/components/strut-app-frame", () => ({
  StrutAppFrame: (props: Record<string, unknown>) => {
    frame(props);
    return <div data-testid="app-frame" />;
  },
}));

const { useWorkspace } = await import("@/hooks/useWorkspace");
const { useWorkspaceStrutApps } = await import("@/hooks/useWorkspaceStrutApps");
const { default: WorkspaceAppPage } = await import("@/app/w/[slug]/apps/[...name]/page");

const pinned = { githubLogin: "stakwork", swarmId: "swarm-oh", apps: [{ name: "acme/invoices", title: "Invoices" }] };

async function open(segments: string[]) {
  const params = Promise.resolve({ name: segments });
  // `use(params)` suspends once; resolve it inside act so the page renders.
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <WorkspaceAppPage params={params} />
      </Suspense>,
    );
    await params;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useWorkspace).mockReturnValue({ workspace: { slug: "openhealth" } } as never);
  vi.mocked(useWorkspaceStrutApps).mockReturnValue({ data: pinned, loading: false, error: null });
});

describe("WorkspaceAppPage", () => {
  it("frames a pinned app from the workspace's swarm, its name rejoined from the segments", async () => {
    await open(["acme", "invoices"]);
    expect(await screen.findByTestId("app-frame")).toBeInTheDocument();
    expect(frame.mock.calls[0][0]).toMatchObject({ source: { githubLogin: "stakwork", swarmId: "swarm-oh", app: "acme/invoices" }, title: "Invoices" });
    expect(screen.getByRole("heading")).toHaveTextContent("Invoices");
    expect(useWorkspaceStrutApps).toHaveBeenCalledWith("openhealth");
  });

  it("says so for an app that is not pinned, and frames nothing", async () => {
    await open(["other"]);
    expect(await screen.findByText(/No app "other" is pinned in this workspace/)).toBeInTheDocument();
    expect(frame).not.toHaveBeenCalled();
  });

  it("shows why the list could not be read", async () => {
    vi.mocked(useWorkspaceStrutApps).mockReturnValue({ data: null, loading: false, error: "Could not reach the swarm" });
    await open(["acme", "invoices"]);
    expect(await screen.findByText("Could not reach the swarm")).toBeInTheDocument();
  });
});
