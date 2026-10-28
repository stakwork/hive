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

    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => i?.method === "POST")).toBe(true));
    const [url, init] = fetchMock.mock.calls.find(([, i]) => i?.method === "POST")!;
    expect(url).toBe("/api/workspaces/acme/system-map/runs");
    expect(JSON.parse(init.body)).toEqual({
      workflow: "security_audit",
      repos: ["acme/api", "acme/web"],
      classes: ["Injection"],
      apply: true,
      maxAgentCalls: 120,
    });
  });

  it("shows built-in descriptions with a note when the live read fails", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    render(<SecurityAuditTab />);
    expect(screen.getByText(/untrusted input reaches an interpreter/i)).toBeInTheDocument();
    expect(await screen.findByTestId("security-audit-fallback-note")).toBeInTheDocument();
  });

  it("shows live classes, descriptions and the hunt text", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        classes: [
          { name: "Prompt Abuse", description: "Live description.", hunt: "Look at prompts.", fallback: false },
        ],
      }),
    });
    render(<SecurityAuditTab />);
    expect(await screen.findByText("Live description.")).toBeInTheDocument();
    expect(screen.getByLabelText("Class Prompt Abuse")).toBeInTheDocument();
    expect(screen.queryByLabelText("Class Injection")).not.toBeInTheDocument();
    expect(screen.queryByTestId("security-audit-fallback-note")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("What Prompt Abuse hunts"));
    expect(await screen.findByText("Look at prompts.")).toBeInTheDocument();
  });

  it("posts the Concept names of live classes, and drops a stale built-in selection", async () => {
    let resolveClasses: (v: unknown) => void = () => {};
    fetchMock.mockImplementation((_url: string, init?: { method?: string }) =>
      init?.method === "POST"
        ? Promise.resolve({ ok: true, json: async () => ({}) })
        : new Promise((resolve) => (resolveClasses = resolve)),
    );
    render(<SecurityAuditTab />);
    fireEvent.click(screen.getByLabelText("Class Wildcard")); // chosen on the built-in list
    resolveClasses({
      ok: true,
      json: async () => ({
        classes: [
          { name: "Prompt Abuse", description: "Live.", hunt: "", fallback: false },
          { name: "Injection", description: "Live.", hunt: "", fallback: false },
        ],
      }),
    });
    fireEvent.click(await screen.findByLabelText("Class Prompt Abuse"));
    fireEvent.click(screen.getByLabelText("Select acme/api"));
    fireEvent.click(screen.getByTestId("security-audit-launch"));
    await waitFor(() => expect(fetchMock.mock.calls.some(([, i]) => i?.method === "POST")).toBe(true));
    const [, init] = fetchMock.mock.calls.find(([, i]) => i?.method === "POST")!;
    expect(JSON.parse(init.body).classes).toEqual(["Prompt Abuse"]);
  });
});
