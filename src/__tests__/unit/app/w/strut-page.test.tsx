/**
 * Unit tests for `/w/[slug]/strut` (`StrutPage`) — follows the
 * `graph-admin/page.tsx` pattern: session + `getWorkspaceBySlug` (without
 * `allowPublicViewer`) is the page's only gate, since middleware treats
 * `/w/**` as public.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, test, expect, vi, beforeEach } from "vitest";

globalThis.React = React;

vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth/nextauth", () => ({ authOptions: {} }));
vi.mock("@/services/workspace", () => ({ getWorkspaceBySlug: vi.fn() }));
vi.mock("@/components/strut/StrutView", () => ({
  StrutView: ({ embedUrlEndpoint }: { embedUrlEndpoint: string }) => (
    <div data-testid="strut-view">{embedUrlEndpoint}</div>
  ),
}));

class NextNotFoundError extends Error {
  digest = "NEXT_NOT_FOUND";
}
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new NextNotFoundError();
  }),
}));

import { getServerSession } from "next-auth/next";
import { getWorkspaceBySlug } from "@/services/workspace";
import { notFound } from "next/navigation";
import StrutPage from "@/app/w/[slug]/strut/page";

const mockSession = getServerSession as unknown as ReturnType<typeof vi.fn>;
const mockGetWorkspaceBySlug = getWorkspaceBySlug as unknown as ReturnType<typeof vi.fn>;
const mockNotFound = notFound as unknown as ReturnType<typeof vi.fn>;

const SLUG = "acme";
const USER_ID = "user-1";

function makeParams() {
  return Promise.resolve({ slug: SLUG });
}

async function renderOrCatch() {
  try {
    const result = await StrutPage({ params: makeParams() });
    return { result };
  } catch (e) {
    return { error: e };
  }
}

function baseWorkspace(over: Record<string, unknown> = {}) {
  return {
    id: "ws-1",
    slug: SLUG,
    userRole: "OWNER",
    swarmId: "swarm-1",
    swarmStatus: "ACTIVE",
    ...over,
  };
}

describe("StrutPage (/w/[slug]/strut)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession.mockResolvedValue({ user: { id: USER_ID } });
    mockGetWorkspaceBySlug.mockResolvedValue(baseWorkspace());
  });

  test("404s when there is no session", async () => {
    mockSession.mockResolvedValue(null);
    const { error } = await renderOrCatch();
    expect(error).toBeInstanceOf(Error);
    expect(mockGetWorkspaceBySlug).not.toHaveBeenCalled();
  });

  test("404s for a non-member (getWorkspaceBySlug returns null)", async () => {
    mockGetWorkspaceBySlug.mockResolvedValue(null);
    const { error } = await renderOrCatch();
    expect(error).toBeInstanceOf(Error);
    expect(mockNotFound).toHaveBeenCalled();
  });

  test("calls getWorkspaceBySlug WITHOUT allowPublicViewer", async () => {
    await renderOrCatch();
    expect(mockGetWorkspaceBySlug).toHaveBeenCalledWith(SLUG, USER_ID);
  });

  test("shows a static below-admin panel for a DEVELOPER member", async () => {
    mockGetWorkspaceBySlug.mockResolvedValue(baseWorkspace({ userRole: "DEVELOPER" }));
    const { result } = await renderOrCatch();
    render(result as React.ReactElement);
    expect(screen.getByText(/Owner or Admin access/i)).toBeTruthy();
    expect(screen.queryByTestId("strut-view")).toBeNull();
  });

  test("shows a static below-admin panel for a VIEWER member", async () => {
    mockGetWorkspaceBySlug.mockResolvedValue(baseWorkspace({ userRole: "VIEWER" }));
    const { result } = await renderOrCatch();
    render(result as React.ReactElement);
    expect(screen.getByText(/Owner or Admin access/i)).toBeTruthy();
  });

  test("shows a no-swarm message when the workspace has no swarm", async () => {
    mockGetWorkspaceBySlug.mockResolvedValue(baseWorkspace({ swarmId: null, swarmStatus: null }));
    const { result } = await renderOrCatch();
    render(result as React.ReactElement);
    expect(screen.getByText("No swarm configured")).toBeTruthy();
    expect(screen.queryByTestId("strut-view")).toBeNull();
  });

  test("shows a swarm-not-active message when the swarm isn't ACTIVE", async () => {
    mockGetWorkspaceBySlug.mockResolvedValue(baseWorkspace({ swarmStatus: "PENDING" }));
    const { result } = await renderOrCatch();
    render(result as React.ReactElement);
    expect(screen.getByText(/isn.t active/i)).toBeTruthy();
    expect(screen.queryByTestId("strut-view")).toBeNull();
  });

  test("renders StrutView with the encoded endpoint for an OWNER with an active swarm", async () => {
    mockGetWorkspaceBySlug.mockResolvedValue(baseWorkspace({ userRole: "OWNER" }));
    const { result } = await renderOrCatch();
    render(result as React.ReactElement);
    expect(screen.getByTestId("strut-view").textContent).toBe(
      `/api/workspaces/${SLUG}/strut/embed-url`,
    );
  });

  test("renders StrutView for an ADMIN with an active swarm", async () => {
    mockGetWorkspaceBySlug.mockResolvedValue(baseWorkspace({ userRole: "ADMIN" }));
    const { result } = await renderOrCatch();
    render(result as React.ReactElement);
    expect(screen.getByTestId("strut-view")).toBeTruthy();
  });

  test("encodes a slug that needs escaping", async () => {
    mockGetWorkspaceBySlug.mockResolvedValue(baseWorkspace({ slug: "a b" }));
    const result = await StrutPage({ params: Promise.resolve({ slug: "a b" }) });
    render(result as React.ReactElement);
    expect(screen.getByTestId("strut-view").textContent).toBe(
      "/api/workspaces/a%20b/strut/embed-url",
    );
  });
});
