/**
 * @vitest-environment jsdom
 *
 * The folded artifacts line (`artifacts/FoldedArtifacts.tsx`): the newest
 * set holding an image shows its images small under the line, read through
 * the same address the panel uses (so the panel finds the image already
 * loaded), and a thumbnail opens its artifact on the panel.
 */

import React from "react";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FoldedArtifacts, lastThumbnailSet } from "@/app/org/[githubLogin]/_components/artifacts/FoldedArtifacts";
import { useCanvasChatStore } from "@/app/org/[githubLogin]/_state/canvasChatStore";
import { artifactIdentity, type ArtifactRef } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";

vi.mock("@/app/org/[githubLogin]/_components/artifacts/useArtifactPanel", () => ({
  useChatOrgLogin: () => "acme-org",
}));

const RUN = "run-1";
const shot = (n: number): ArtifactRef => ({
  id: `shot-${n}`,
  kind: "image",
  title: `Screenshot ${n}`,
  label: "Screenshot",
  source: { type: "graph", swarmId: "swarm-1", key: `/artifacts/${RUN}/shot-${n}.png` },
});
const page: ArtifactRef = {
  id: "pod",
  kind: "url",
  title: "The pod",
  label: "Browser",
  source: { type: "inline", content: { url: "https://pod.example.com" } },
};
const plan: ArtifactRef = {
  id: "plan",
  kind: "markdown",
  title: "Plan",
  source: { type: "inline", content: { text: "# Plan" } },
};

const readerUrl = (n: number) =>
  `/api/orgs/acme-org/strut/artifacts?${new URLSearchParams({ swarmId: "swarm-1", key: `/artifacts/${RUN}/shot-${n}.png` })}`;

function renderLine(props: React.ComponentProps<typeof FoldedArtifacts>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <FoldedArtifacts {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => useCanvasChatStore.setState({ artifactPanel: null }));

describe("lastThumbnailSet", () => {
  test("the newest message carrying an image", () => {
    const messages = [
      { id: "m1", artifacts: [shot(1), page] },
      { id: "m2", artifacts: [plan] },
      { id: "m3", artifacts: [shot(2), page] },
      { id: "m4", artifacts: [plan] },
      { id: "m5" },
    ];
    expect(lastThumbnailSet(messages)).toBe("m3");
  });

  test("null when no message carries one", () => {
    expect(lastThumbnailSet([{ id: "m1", artifacts: [plan, page] }, { id: "m2" }])).toBeNull();
  });
});

describe("FoldedArtifacts", () => {
  test("no thumbnails unless asked", () => {
    renderLine({ artifacts: [shot(1), page], afterCards: false });
    expect(screen.queryByRole("img")).toBeNull();
  });

  test("with thumbnails, each image small through the reader the panel uses — the other kinds stay names", async () => {
    renderLine({ artifacts: [shot(1), page, shot(2)], afterCards: false, thumbnails: true });
    await waitFor(() => expect(screen.getAllByRole("img")).toHaveLength(2));
    const images = screen.getAllByRole("img");
    expect(images.map((img) => img.getAttribute("src"))).toEqual([readerUrl(1), readerUrl(2)]);
    expect(images.map((img) => img.getAttribute("alt"))).toEqual(["Screenshot 1", "Screenshot 2"]);
  });

  test("a thumbnail opens its image on the panel", async () => {
    renderLine({ artifacts: [shot(1)], afterCards: false, thumbnails: true });
    fireEvent.click((await screen.findByRole("img")).closest("button")!);
    expect(useCanvasChatStore.getState().artifactPanel).toEqual({ identity: artifactIdentity(shot(1)), version: null });
  });

  test("an image that will not load drops its thumbnail", async () => {
    renderLine({ artifacts: [shot(1)], afterCards: false, thumbnails: true });
    fireEvent.error(await screen.findByRole("img"));
    await waitFor(() => expect(screen.queryByRole("img")).toBeNull());
  });
});
