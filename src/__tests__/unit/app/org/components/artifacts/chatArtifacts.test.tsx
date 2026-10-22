/**
 * @vitest-environment jsdom
 *
 * A message's artifacts in the chat (`artifacts/ChatArtifacts.tsx`), laid
 * out by their kind's `chat` placement: rows for what to act on (a PR with
 * its checks and state, claims, a pod), a strip of thumbnails for what to
 * look at — read through the same address the panel uses, so the panel finds
 * the picture already loaded — the first lines of a document, and the rest
 * folded into one line. Anything opens on the artifact panel.
 */

import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChatArtifacts } from "@/app/org/[githubLogin]/_components/artifacts/ChatArtifacts";
import { useCanvasChatStore } from "@/app/org/[githubLogin]/_state/canvasChatStore";
import { artifactIdentity, type ArtifactRef } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";

const { mockRouter, nav } = vi.hoisted(() => ({
  mockRouter: { push: vi.fn(), replace: vi.fn() },
  nav: { search: "" },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  usePathname: () => "/org/acme-org",
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/app/org/[githubLogin]/_components/artifacts/useArtifactPanel", () => ({
  useChatOrgLogin: () => "acme-org",
}));
// jsdom has no IntersectionObserver: everything counts as on screen.
vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("framer-motion")>()),
  useInView: () => true,
}));

const RUN = "run-1";
const inline = (content: Record<string, unknown>) => ({ type: "inline" as const, content });
const shot = (n: number): ArtifactRef => ({
  id: `shot-${n}`,
  kind: "image",
  title: `Screenshot ${n}`,
  label: "Screenshot",
  source: { type: "graph", swarmId: "swarm-1", key: `/artifacts/${RUN}/shot-${n}.png` },
});
const pr: ArtifactRef = {
  id: "pr",
  kind: "pull_request",
  title: "Share up front",
  source: inline({
    url: "https://github.com/stakwork/hive/pull/5531",
    repo: "stakwork/hive",
    number: 5531,
    state: "open",
    checks: [
      { name: "lint", status: "success" },
      { name: "build", status: "pending" },
    ],
  }),
};
const pod: ArtifactRef = {
  id: "pod",
  kind: "url",
  title: "The pod",
  label: "Browser",
  source: inline({ url: "https://pod-7f3a.example.com/org/stakwork" }),
};
const plan: ArtifactRef = {
  id: "plan",
  kind: "markdown",
  label: "Plan",
  title: "Header plan",
  source: inline({
    text: "# Header plan\n\nMove Share up front.\n\nAdd the model chip.\n\nScreenshots of both.\n\nNot shown.",
  }),
};
const log: ArtifactRef = { id: "log", kind: "log", label: "Logs", title: "Build", source: inline({ text: "ok" }) };

const readerUrl = (n: number) =>
  `/api/orgs/acme-org/strut/artifacts?${new URLSearchParams({ swarmId: "swarm-1", key: `/artifacts/${RUN}/shot-${n}.png` })}`;

function renderArtifacts(artifacts: ArtifactRef[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <ChatArtifacts artifacts={artifacts} versions={new Map()} />
    </QueryClientProvider>,
  );
}

const clickable = (artifact: ArtifactRef) =>
  document.querySelector<HTMLElement>(`[data-artifact-id="${artifact.id}"]`)!;

beforeEach(() => {
  useCanvasChatStore.setState({ artifactPanel: null });
  mockRouter.push.mockClear();
  mockRouter.replace.mockClear();
  nav.search = "";
});

describe("ChatArtifacts", () => {
  test("rows for the PR and the pod, its checks and state, the pod's host", async () => {
    renderArtifacts([pr, pod]);
    const row = clickable(pr);
    expect(within(row).getByText("Share up front")).toBeTruthy();
    expect(within(row).getByText("1 of 2 checks")).toBeTruthy();
    expect(within(row).getByText("Open")).toBeTruthy();
    expect(within(clickable(pod)).getByText("pod-7f3a.example.com")).toBeTruthy();
  });

  test("screenshots are thumbnails, read through the reader the panel uses", async () => {
    renderArtifacts([shot(1), shot(2)]);
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(2));
    expect(screen.getAllByRole("img").map((img) => img.getAttribute("src"))).toEqual([readerUrl(1), readerUrl(2)]);
  });

  test("a thumbnail opens its image on the panel", async () => {
    renderArtifacts([shot(1)]);
    fireEvent.click((await screen.findByRole("img")).closest("button")!);
    // Not in the active chat (as here): it opens as a live artifact.
    expect(useCanvasChatStore.getState().artifactPanel).toEqual({
      identity: artifactIdentity(shot(1)),
      version: null,
      live: shot(1),
    });
  });

  test("an image that will not load leaves its tile, without the picture", async () => {
    renderArtifacts([shot(1)]);
    fireEvent.error(await screen.findByRole("img"));
    await waitFor(() => expect(screen.queryByRole("img")).toBeNull());
    expect(screen.getByText("Screenshot 1")).toBeTruthy();
  });

  test("a document shows its first three lines under its title", () => {
    renderArtifacts([plan]);
    const card = clickable(plan);
    expect(within(card).getByText("Header plan")).toBeTruthy();
    expect(card.textContent).toContain("Move Share up front.");
    expect(card.textContent).toContain("Screenshots of both.");
    expect(card.textContent).not.toContain("Not shown.");
  });

  test("reference material folds into one line after the rest, and opens from it", () => {
    renderArtifacts([pr, log]);
    const line = screen.getByTestId("folded-artifacts");
    expect(within(line).getByText("1 more")).toBeTruthy();
    fireEvent.click(within(line).getByText("Logs"));
    // Not in the active chat (as here): it opens as a live artifact.
    expect(useCanvasChatStore.getState().artifactPanel).toEqual({
      identity: artifactIdentity(log),
      version: null,
      live: log,
    });
  });

  test("a row opens its artifact on the panel and shows it is up", () => {
    renderArtifacts([pr]);
    fireEvent.click(clickable(pr));
    // Not in the active chat (as here): it opens as a live artifact.
    expect(useCanvasChatStore.getState().artifactPanel).toEqual({
      identity: artifactIdentity(pr),
      version: null,
      live: pr,
    });
    expect(clickable(pr).getAttribute("aria-pressed")).toBe("true");
  });

  test("a brainstorm tree card opens the desk, not the panel", () => {
    nav.search = "view=canvas";
    const tree: ArtifactRef = {
      id: "brainstorm-tree",
      kind: "graph",
      title: "Brainstorm",
      source: inline({ workspace: "hive", focus: "root-1", layout: "tree" }),
    };
    renderArtifacts([tree]);
    fireEvent.click(clickable(tree));
    expect(mockRouter.push).toHaveBeenCalledWith("/org/acme-org?view=canvas&tab=brainstorm&ws=hive&root=root-1");
    expect(useCanvasChatStore.getState().artifactPanel).toBeNull();
  });

  test("a graph that is not a tree opens on the panel, without navigating", () => {
    nav.search = "view=canvas";
    const graph: ArtifactRef = {
      id: "graph-1",
      kind: "graph",
      title: "Graph",
      source: inline({ workspace: "hive", focus: "n1" }),
    };
    renderArtifacts([graph]);
    fireEvent.click(clickable(graph));
    expect(mockRouter.push).not.toHaveBeenCalled();
    // Not in the active chat (as here): it opens as a live artifact.
    expect(useCanvasChatStore.getState().artifactPanel).toEqual({
      identity: artifactIdentity(graph),
      version: null,
      live: graph,
    });
  });
});
