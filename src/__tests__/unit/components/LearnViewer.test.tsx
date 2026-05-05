import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

// ---------------------------------------------------------------------------
// next/navigation mocks
// ---------------------------------------------------------------------------
const mockReplace = vi.fn();
const mockSearchParamsGet = vi.fn().mockReturnValue(null);

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => "/w/test-workspace/learn",
  useSearchParams: () => ({ get: mockSearchParamsGet }),
}));

// LearnViewer reads `isPublicViewer` from the workspace context purely to
// thread through to LearnDocViewer; tests don't care about that surface.
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({ isPublicViewer: false }),
}));

// ---------------------------------------------------------------------------
// Child component mocks
// ---------------------------------------------------------------------------
vi.mock("@/app/w/[slug]/learn/components/LearnSidebar", () => ({
  LearnSidebar: (props: {
    onDocClick: (r: string, c: string) => void;
    onConceptClick: (id: string, name: string, content: string) => void;
    onDiagramClick: (id: string, name: string, body: string, desc?: string | null) => void;
    docs: { repoName: string; content: string }[];
    concepts: { id: string; name: string; content?: string }[];
    diagrams: { id: string; name: string; body: string; description?: string | null }[];
  }) => (
    <div>
      {props.docs.map((d) => (
        <button key={d.repoName} data-testid={`doc-${d.repoName}`} onClick={() => props.onDocClick(d.repoName, d.content)}>
          {d.repoName}
        </button>
      ))}
      {props.concepts.map((c) => (
        <button key={c.id} data-testid={`concept-${c.id}`} onClick={() => props.onConceptClick(c.id, c.name, c.content || "")}>
          {c.name}
        </button>
      ))}
      {props.diagrams.map((d) => (
        <button key={d.id} data-testid={`diagram-${d.id}`} onClick={() => props.onDiagramClick(d.id, d.name, d.body, d.description)}>
          {d.name}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("@/app/w/[slug]/learn/components/LearnDocViewer", () => ({
  LearnDocViewer: ({ activeItem }: { activeItem: { name: string } | null }) => (
    <div data-testid="doc-viewer">{activeItem?.name ?? "no-item"}</div>
  ),
}));

vi.mock("@/app/w/[slug]/learn/components/DiagramViewer", () => ({
  DiagramViewer: ({ name }: { name: string }) => <div data-testid="diagram-viewer">{name}</div>,
}));

vi.mock("@/app/w/[slug]/learn/components/CreateDiagramModal", () => ({
  CreateDiagramModal: () => null,
}));

// ---------------------------------------------------------------------------
// fetch mock helpers
// ---------------------------------------------------------------------------
const DOCS_RESPONSE = [{ "org/repo": { documentation: "doc content here" } }];
const CONCEPTS_RESPONSE = { features: [{ id: "concept-abc", name: "Auth Concept", content: "concept content" }] };
const DIAGRAMS_RESPONSE = [{ id: "diag-123", name: "System Diagram", body: "graph TD; A-->B", description: "desc", groupId: "group-abc" }];

function makeFetchMock(overrides?: {
  docs?: unknown;
  concepts?: unknown;
  diagrams?: unknown;
  /** Handler for GET /api/learnings/diagrams/<id> requests */
  diagramById?: (id: string) => { ok: boolean; status?: number; body?: unknown };
}) {
  return vi.fn().mockImplementation((url: string) => {
    if (url.includes("/api/learnings/docs")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(overrides?.docs ?? DOCS_RESPONSE) });
    }
    if (url.includes("/api/learnings/features") && !url.includes("/documentation")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(overrides?.concepts ?? CONCEPTS_RESPONSE) });
    }
    // Match /api/learnings/diagrams/<id> before the list endpoint
    const byIdMatch = url.match(/\/api\/learnings\/diagrams\/([^?]+)/);
    if (byIdMatch) {
      const id = byIdMatch[1];
      if (overrides?.diagramById) {
        const result = overrides.diagramById(id);
        return Promise.resolve({
          ok: result.ok,
          status: result.status ?? (result.ok ? 200 : 404),
          json: () => Promise.resolve(result.body ?? {}),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: "Not found" }) });
    }
    if (url.includes("/api/learnings/diagrams")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(overrides?.diagrams ?? DIAGRAMS_RESPONSE) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

// ---------------------------------------------------------------------------
// Import component under test AFTER mocks are set up
// ---------------------------------------------------------------------------
import { LearnViewer } from "@/app/w/[slug]/learn/components/LearnViewer";

describe("LearnViewer — URL param sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParamsGet.mockReturnValue(null);
    global.fetch = makeFetchMock();
  });

  it("auto-selects first doc when no URL param is present", async () => {
    render(<LearnViewer workspaceSlug="test-workspace" />);
    await waitFor(() => expect(screen.getByTestId("doc-viewer")).toHaveTextContent("org/repo"));
  });

  it("does NOT auto-select first doc when a ?doc param is present (URL restore handles it)", async () => {
    mockSearchParamsGet.mockImplementation((key: string) => (key === "doc" ? "org%2Frepo" : null));
    render(<LearnViewer workspaceSlug="test-workspace" />);
    // After loading, the restore effect should set the doc — viewer should show it
    await waitFor(() => expect(screen.getByTestId("doc-viewer")).toHaveTextContent("org/repo"));
  });

  it("calls router.replace with ?doc=encoded when a doc is clicked", async () => {
    render(<LearnViewer workspaceSlug="test-workspace" />);
    await waitFor(() => screen.getByTestId("doc-org/repo"));
    screen.getByTestId("doc-org/repo").click();
    expect(mockReplace).toHaveBeenCalledWith(
      expect.stringContaining("doc="),
      expect.objectContaining({ scroll: false })
    );
    const [url] = mockReplace.mock.calls[mockReplace.mock.calls.length - 1];
    expect(url).toMatch(/doc=org%252Frepo|doc=org%2Frepo/);
  });

  it("calls router.replace with ?concept=encoded when a concept is clicked", async () => {
    render(<LearnViewer workspaceSlug="test-workspace" />);
    await waitFor(() => screen.getByTestId("concept-concept-abc"));
    screen.getByTestId("concept-concept-abc").click();
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        expect.stringContaining("concept="),
        expect.objectContaining({ scroll: false })
      );
    });
  });

  it("calls router.replace with ?diagram=encoded when a diagram is clicked", async () => {
    render(<LearnViewer workspaceSlug="test-workspace" />);
    await waitFor(() => screen.getByTestId("diagram-diag-123"));
    screen.getByTestId("diagram-diag-123").click();
    expect(mockReplace).toHaveBeenCalledWith(
      expect.stringContaining("diagram=diag-123"),
      expect.objectContaining({ scroll: false })
    );
  });

  it("restores concept from ?concept param after all data loads", async () => {
    mockSearchParamsGet.mockImplementation((key: string) => (key === "concept" ? "concept-abc" : null));
    render(<LearnViewer workspaceSlug="test-workspace" />);
    await waitFor(() => expect(screen.getByTestId("doc-viewer")).toHaveTextContent("Auth Concept"));
  });

  it("restores diagram from ?diagram param after all data loads", async () => {
    mockSearchParamsGet.mockImplementation((key: string) => (key === "diagram" ? "diag-123" : null));
    render(<LearnViewer workspaceSlug="test-workspace" />);
    await waitFor(() => expect(screen.getByTestId("diagram-viewer")).toHaveTextContent("System Diagram"));
  });

  it("falls back to first doc when ?doc param does not match any loaded doc", async () => {
    mockSearchParamsGet.mockImplementation((key: string) => (key === "doc" ? "deleted-repo" : null));
    render(<LearnViewer workspaceSlug="test-workspace" />);
    await waitFor(() => expect(screen.getByTestId("doc-viewer")).toHaveTextContent("org/repo"));
  });

  it("shows nothing (no error) when ?concept param does not match any concept", async () => {
    mockSearchParamsGet.mockImplementation((key: string) => (key === "concept" ? "nonexistent-id" : null));
    // Should not throw, doc viewer renders with no active item
    render(<LearnViewer workspaceSlug="test-workspace" />);
    await waitFor(() => expect(screen.getByTestId("doc-viewer")).toHaveTextContent("no-item"));
  });

  it("shows nothing (no error) when ?diagram param does not match any diagram", async () => {
    mockSearchParamsGet.mockImplementation((key: string) => (key === "diagram" ? "nonexistent-id" : null));
    render(<LearnViewer workspaceSlug="test-workspace" />);
    await waitFor(() => expect(screen.getByTestId("doc-viewer")).toHaveTextContent("no-item"));
  });

  it("uses router.replace (not push) so back button is not polluted", async () => {
    const mockPush = vi.fn();
    const { useRouter } = await import("next/navigation");
    // router.push should never be called
    render(<LearnViewer workspaceSlug="test-workspace" />);
    await waitFor(() => screen.getByTestId("doc-org/repo"));
    screen.getByTestId("doc-org/repo").click();
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // URL-restore: diagram slow path (older-version ID not in list)
  // ---------------------------------------------------------------------------
  it("opens latest diagram version when URL param is an older-version ID not in the list", async () => {
    // The list only has the latest version (diag-123 / group-abc)
    // The URL has an older ID "diag-old-version" which resolves to the same group
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "diagram" ? "diag-old-version" : null
    );

    global.fetch = makeFetchMock({
      diagramById: (id) => {
        if (id === "diag-old-version") {
          return { ok: true, body: { id: "diag-old-version", groupId: "group-abc" } };
        }
        return { ok: false };
      },
    });

    render(<LearnViewer workspaceSlug="test-workspace" />);

    // Should open the latest diagram (diag-123) whose groupId matches "group-abc"
    await waitFor(() => expect(screen.getByTestId("diagram-viewer")).toHaveTextContent("System Diagram"));
  });

  it("rewrites the URL to the latest ID when resolving an older-version diagram param", async () => {
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "diagram" ? "diag-old-version" : null
    );

    global.fetch = makeFetchMock({
      diagramById: (id) => {
        if (id === "diag-old-version") {
          return { ok: true, body: { id: "diag-old-version", groupId: "group-abc" } };
        }
        return { ok: false };
      },
    });

    render(<LearnViewer workspaceSlug="test-workspace" />);

    await waitFor(() =>
      expect(mockReplace).toHaveBeenCalledWith(
        expect.stringContaining("diagram=diag-123"),
        expect.objectContaining({ scroll: false })
      )
    );
  });

  it("falls back to first doc when diagram ID resolves but groupId has no match in list", async () => {
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "diagram" ? "diag-orphan" : null
    );

    global.fetch = makeFetchMock({
      diagramById: (id) => {
        if (id === "diag-orphan") {
          // Returns a groupId that isn't in the diagrams list
          return { ok: true, body: { id: "diag-orphan", groupId: "group-nonexistent" } };
        }
        return { ok: false };
      },
    });

    render(<LearnViewer workspaceSlug="test-workspace" />);

    await waitFor(() => expect(screen.getByTestId("doc-viewer")).toHaveTextContent("org/repo"));
  });

  it("falls back to first doc when the diagram ID lookup returns 404", async () => {
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "diagram" ? "diag-deleted" : null
    );

    global.fetch = makeFetchMock({
      diagramById: () => ({ ok: false, status: 404, body: { error: "Not found" } }),
    });

    render(<LearnViewer workspaceSlug="test-workspace" />);

    await waitFor(() => expect(screen.getByTestId("doc-viewer")).toHaveTextContent("org/repo"));
  });

  it("opens diagram immediately (no extra fetch) when URL param matches latest version in list", async () => {
    // diag-123 is already in DIAGRAMS_RESPONSE (the latest)
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "diagram" ? "diag-123" : null
    );

    const fetchSpy = makeFetchMock();
    global.fetch = fetchSpy;

    render(<LearnViewer workspaceSlug="test-workspace" />);

    await waitFor(() => expect(screen.getByTestId("diagram-viewer")).toHaveTextContent("System Diagram"));

    // Confirm no call was made to the /diagrams/<id> endpoint
    const byIdCalls = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([url]: [string]) => /\/api\/learnings\/diagrams\/[^?]+/.test(url)
    );
    expect(byIdCalls).toHaveLength(0);
  });
});
