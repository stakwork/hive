/** A walkthrough's manifest read for the viewer (strut plans/live-artifacts.md §4). */
import { describe, it, expect } from "vitest";
import { parseWalkthroughManifest } from "@/app/org/[githubLogin]/_components/artifacts/walkthroughManifest";

const KEY = "/jobs/j-1/files/walkthroughs/004/walkthrough.json";

describe("parseWalkthroughManifest", () => {
  it("frames as siblings of the manifest, in order; a frame that is not a plain image name there is dropped", () => {
    const m = parseWalkthroughManifest(
      {
        title: "Switch billing to annual",
        url: "https://pod/settings",
        status: "stopped",
        frames: [
          { file: "01.png", caption: "Open settings", pageUrl: "https://pod/settings", ms: 0 },
          { file: "02.png", caption: "Click Billing", ms: 1840, step: { do: "click" } },
          { file: "../../plan.md", caption: "escape" },
          { file: "sub/03.png", caption: "nested" },
          { caption: "no file" },
          { file: "03.png", caption: "Switch to annual", failed: "text=Annual matched nothing" },
        ],
        failed: ["step 2 (click text=Annual) failed: matched nothing"],
      },
      KEY,
    );
    expect(m).toEqual({
      title: "Switch billing to annual",
      status: "stopped",
      frames: [
        { key: "/jobs/j-1/files/walkthroughs/004/01.png", caption: "Open settings", pageUrl: "https://pod/settings" },
        { key: "/jobs/j-1/files/walkthroughs/004/02.png", caption: "Click Billing" },
        { key: "/jobs/j-1/files/walkthroughs/004/03.png", caption: "Switch to annual", failed: "text=Annual matched nothing" },
      ],
      failed: ["step 2 (click text=Annual) failed: matched nothing"],
    });
  });

  it("null for what is not a manifest; a recording with no frames yet is empty", () => {
    expect(parseWalkthroughManifest(null, KEY)).toBeNull();
    expect(parseWalkthroughManifest({ title: "x" }, KEY)).toBeNull();
    expect(parseWalkthroughManifest({ status: "recording", frames: [] }, KEY)).toEqual({ status: "recording", frames: [], failed: [] });
  });
});
