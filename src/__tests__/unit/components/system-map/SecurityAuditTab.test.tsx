import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { SecurityAuditTab, defaultMaxCalls, repoFullName } from "@/components/system-map/SecurityAuditTab";

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    workspace: {
      slug: "acme",
      repositories: [
        { id: "1", repositoryUrl: "https://github.com/acme/api" },
        { id: "2", repositoryUrl: "https://github.com/acme/web.git" },
      ],
    },
  }),
}));
vi.mock("@/hooks/useWorkspaceAccess", () => ({ useWorkspaceAccess: () => ({ canWrite: true }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/system-map/SystemMapRuns", () => ({ SystemMapRuns: () => <div data-testid="runs" /> }));

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("helpers", () => {
  it("derives owner/name and default call caps", () => {
    expect(repoFullName("https://github.com/acme/web.git")).toBe("acme/web");
    expect(repoFullName("nope")).toBeNull();
    expect(defaultMaxCalls(1)).toBe(60);
    expect(defaultMaxCalls(0)).toBe(50);
    expect(defaultMaxCalls(100)).toBe(2000);
  });
});

describe("SecurityAuditTab", () => {
  it("renders repos, dry run on, and launch disabled until a repo is chosen", () => {
    render(<SecurityAuditTab />);
    expect(screen.getByLabelText("Select acme/api")).toBeInTheDocument();
    expect(screen.getByLabelText("Select acme/web")).toBeInTheDocument();
    expect(screen.getByRole("switch")).toBeChecked();
    expect(screen.getByTestId("security-audit-launch")).toBeDisabled();
    expect(screen.getByTestId("security-audit-cost")).toBeInTheDocument();
    expect(screen.getByTestId("runs")).toBeInTheDocument();
  });

  it("posts the launch payload", async () => {
    render(<SecurityAuditTab />);
    fireEvent.click(screen.getByLabelText("Select acme/api"));
    fireEvent.click(screen.getByLabelText("Select acme/web"));
    fireEvent.click(screen.getByLabelText("Class Injection"));
    fireEvent.click(screen.getByRole("switch"));
    fireEvent.click(screen.getByTestId("security-audit-launch"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/workspaces/acme/system-map/runs");
    expect(JSON.parse(init.body)).toEqual({
      workflow: "security_audit",
      repos: ["acme/api", "acme/web"],
      classes: ["Injection"],
      apply: true,
      maxAgentCalls: 120,
    });
  });
});
