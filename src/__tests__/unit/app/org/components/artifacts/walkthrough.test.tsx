// @vitest-environment jsdom
/**
 * The walkthrough viewer (strut browser/walkthrough, plans/live-artifacts.md
 * §4): the manifest read through the reader route, the frames scrubbed, and
 * the manifest read again when the job reports the recording changed.
 */
import React from "react";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WalkthroughPanel } from "@/app/org/[githubLogin]/_components/artifacts/viewers/walkthrough";
import { artifactKind } from "@/app/org/[githubLogin]/_components/artifacts/registry";
import { parseArtifactContent, type ArtifactRef } from "@/app/org/[githubLogin]/_state/canvasChatArtifacts";
import { useJobLiveStore } from "@/app/org/[githubLogin]/_state/jobLiveStore";

vi.mock("@/app/org/[githubLogin]/_components/artifacts/useArtifactPanel", () => ({ useChatOrgLogin: () => "acme-org" }));

const JOB = "j-1";
const KEY = `/jobs/${JOB}/files/walkthroughs/001/walkthrough.json`;
const content = parseArtifactContent("walkthrough", { swarmId: "swarm-1", key: KEY })!;
const artifact: ArtifactRef = { id: "billing-walkthrough", kind: "walkthrough", title: "Billing", source: { type: "graph", swarmId: "swarm-1", key: KEY } };
const reader = (key: string) => `/api/orgs/acme-org/strut/artifacts?${new URLSearchParams({ swarmId: "swarm-1", key })}`;

const frames = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ file: `0${i + 1}.png`, caption: ["Open settings", "Click Billing", "Switch to annual"][i], pageUrl: "https://pod/settings", ms: i * 1000 }));
const manifest = (n: number, status = "recording") => ({ title: "Switch billing to annual", url: "https://pod/settings", status, frames: frames(n), failed: [] });

const mockFetch = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", mockFetch);
  useJobLiveStore.setState({ byJob: {}, verifying: {} });
});
afterEach(() => vi.unstubAllGlobals());
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

describe("walkthrough", () => {
  test("the kind: a graph ref's content is where it is on the swarm; a thumbnail in the chat's strip", () => {
    expect(content).toEqual({ swarmId: "swarm-1", key: KEY });
    expect(parseArtifactContent("walkthrough", { swarmId: "swarm-1" })).toBeNull();
    expect(artifactKind("walkthrough").label).toBe("Walkthrough");
    expect(artifactKind("walkthrough").chat?.place).toBe("media");
  });

  test("the panel reads the manifest through the reader, follows the newest frame, scrubs, and reads again on a new frame", async () => {
    mockFetch.mockResolvedValueOnce(json(manifest(2)));
    render(<WalkthroughPanel artifact={artifact} content={content} />);
    expect(await screen.findByTestId("walkthrough-count")).toHaveProperty("textContent", "2 / 2");
    expect(mockFetch.mock.calls[0][0]).toBe(reader(KEY));
    expect(screen.getByText("Recording…")).toBeTruthy();
    const frame = () => screen.getAllByRole("img")[0].getAttribute("src");
    expect(frame()).toBe(reader(`/jobs/${JOB}/files/walkthroughs/001/02.png`));

    fireEvent.change(screen.getByLabelText("Frame"), { target: { value: "0" } });
    expect(screen.getByTestId("walkthrough-count").textContent).toBe("1 / 2");
    expect(frame()).toBe(reader(`/jobs/${JOB}/files/walkthroughs/001/01.png`));

    // The job reports a third frame: the manifest is read again; the reader's pick stays.
    mockFetch.mockResolvedValueOnce(json(manifest(3, "done")));
    act(() => useJobLiveStore.getState().apply({ jobId: JOB, swarmId: "swarm-1", at: "t", kind: "walkthrough", url: KEY, state: "done", detail: { frames: 3 } }));
    await waitFor(() => expect(screen.getByTestId("walkthrough-count").textContent).toBe("1 / 3"));
    expect(screen.getByText("Done")).toBeTruthy();
  });

  test("every frame is mounted, hidden but the one showing, so scrubbing never waits on a load", async () => {
    mockFetch.mockResolvedValueOnce(json(manifest(3, "done")));
    render(<WalkthroughPanel artifact={artifact} content={content} />);
    await screen.findByTestId("walkthrough-count");
    const stacked = Array.from(screen.getByTestId("walkthrough").firstElementChild!.querySelectorAll("img"));
    expect(stacked.map((img) => img.getAttribute("src"))).toEqual(
      ["01.png", "02.png", "03.png"].map((f) => reader(`/jobs/${JOB}/files/walkthroughs/001/${f}`)),
    );
    expect(stacked.map((img) => img.getAttribute("aria-hidden"))).toEqual(["true", "true", null]);
    expect(stacked.map((img) => img.getAttribute("loading"))).toEqual(["lazy", "lazy", "eager"]);

    fireEvent.change(screen.getByLabelText("Frame"), { target: { value: "0" } });
    expect(stacked.map((img) => img.getAttribute("aria-hidden"))).toEqual([null, "true", "true"]);
  });

  test("the bar is a segment per step, in two alternating blues, faded ahead of the frame showing", async () => {
    mockFetch.mockResolvedValueOnce(json(manifest(3, "done")));
    render(<WalkthroughPanel artifact={artifact} content={content} />);
    await screen.findByTestId("walkthrough-count");
    const segments = () => Array.from(screen.getByTestId("walkthrough-steps").children).map((s) => s.className);
    expect(segments()).toHaveLength(2);
    expect(segments()[0]).toContain("bg-blue-500");
    expect(segments()[1]).toContain("bg-blue-400");
    expect(segments().some((c) => c.includes("opacity-40"))).toBe(false);

    fireEvent.change(screen.getByLabelText("Frame"), { target: { value: "1" } });
    expect(segments().map((c) => c.includes("opacity-40"))).toEqual([false, true]);
  });

  test("play steps a frame every 800ms, starting over from the end, and stops on the last", async () => {
    mockFetch.mockResolvedValueOnce(json(manifest(3, "done")));
    render(<WalkthroughPanel artifact={artifact} content={content} />);
    const count = await screen.findByTestId("walkthrough-count");
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "Play" }));
      expect(count.textContent).toBe("1 / 3");
      act(() => vi.advanceTimersByTime(799));
      expect(count.textContent).toBe("1 / 3");
      act(() => vi.advanceTimersByTime(1));
      expect(count.textContent).toBe("2 / 3");

      fireEvent.click(screen.getByRole("button", { name: "Pause" }));
      act(() => vi.advanceTimersByTime(2_000));
      expect(count.textContent).toBe("2 / 3");

      fireEvent.click(screen.getByRole("button", { name: "Play" }));
      act(() => vi.advanceTimersByTime(800));
      expect(count.textContent).toBe("3 / 3");
      expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  test("a stopped recording says why under the frame it stopped on", async () => {
    const stopped = { ...manifest(2, "stopped"), frames: [frames(2)[0], { ...frames(2)[1], failed: "step 1 (click text=Billing) failed: matched nothing" }] };
    mockFetch.mockResolvedValueOnce(json(stopped));
    render(<WalkthroughPanel artifact={artifact} content={content} />);
    expect(await screen.findByText("step 1 (click text=Billing) failed: matched nothing")).toBeTruthy();
    expect(screen.getByText("Stopped")).toBeTruthy();
  });

  test("a manifest that cannot be read says so", async () => {
    mockFetch.mockResolvedValueOnce(new Response("nope", { status: 404 }));
    render(<WalkthroughPanel artifact={artifact} content={content} />);
    expect(await screen.findByText("This recording could not be loaded.")).toBeTruthy();
  });
});
