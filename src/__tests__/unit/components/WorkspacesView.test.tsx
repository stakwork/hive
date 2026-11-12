// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("@/hooks/useWorkspaceLogos", () => ({ useWorkspaceLogos: () => ({ logoUrls: {} }) }));
vi.mock("@/hooks/useFeatureFlag", () => ({ useFeatureFlag: () => false }));
vi.mock("@/components/CreateWorkspaceDialog", () => ({ CreateWorkspaceDialog: () => null }));

(globalThis as unknown as { React: typeof React }).React = React;

import { WorkspacesView } from "@/app/org/[githubLogin]/_components/WorkspacesView";

const ws = (id: string, userRole: string) => ({
  id,
  name: `WS ${id}`,
  slug: `ws-${id}`,
  description: null,
  userRole,
  memberCount: 2,
  createdAt: new Date().toISOString(),
});

function mockWorkspaces(rows: unknown[]) {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => rows }) as unknown as typeof fetch;
}

describe("WorkspacesView New workspace button", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["OWNER", "ADMIN"])("shows for %s", async (role) => {
    mockWorkspaces([ws("1", "DEVELOPER"), ws("2", role)]);
    render(<WorkspacesView githubLogin="acme" />);
    expect(await screen.findByRole("button", { name: /new workspace/i })).toBeTruthy();
  });

  it("is hidden when user only has DEVELOPER rows", async () => {
    mockWorkspaces([ws("1", "DEVELOPER"), ws("2", "DEVELOPER")]);
    render(<WorkspacesView githubLogin="acme" />);
    await waitFor(() => expect(screen.getByText("WS 1")).toBeTruthy());
    expect(screen.queryByRole("button", { name: /new workspace/i })).toBeNull();
  });
});
