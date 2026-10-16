import { describe, test, expect } from "vitest";
import {
  addTap,
  cellCentre,
  clockOf,
  msLeft,
  overlayCells,
  parseCaptchaManifest,
  removeTap,
  tapFromPointer,
  tapToCell,
  tileSummary,
  toggleCellTap,
} from "@/app/org/[githubLogin]/_components/artifacts/captchaTaps";

const grid = { rows: 3, cols: 3 };

describe("tapFromPointer", () => {
  test("fractions of the rendered box, clamped", () => {
    const rect = { left: 100, top: 50, width: 200, height: 100 };
    expect(tapFromPointer(200, 100, rect)).toEqual({ nx: 0.5, ny: 0.5 });
    expect(tapFromPointer(0, 1000, rect)).toEqual({ nx: 0, ny: 1 });
    expect(tapFromPointer(1, 1, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ nx: 0, ny: 0 });
  });
});

describe("cells", () => {
  test("a tap maps to its cell, the far edge to the last", () => {
    expect(tapToCell({ nx: 0.1, ny: 0.1 }, grid).index).toBe(0);
    expect(tapToCell({ nx: 0.5, ny: 0.5 }, grid).index).toBe(4);
    expect(tapToCell({ nx: 1, ny: 1 }, grid)).toEqual({ row: 2, col: 2, index: 8 });
  });

  test("toggle adds the cell's centre, then removes it", () => {
    const once = toggleCellTap([], { nx: 0.1, ny: 0.2 }, grid);
    expect(once).toEqual([cellCentre(0, grid)]);
    expect(once[0].nx).toBeCloseTo(1 / 6);
    expect(toggleCellTap(once, { nx: 0.3, ny: 0.3 }, grid)).toEqual([]);
    expect(toggleCellTap(once, { nx: 0.9, ny: 0.9 }, grid)).toHaveLength(2);
  });

  test("overlay covers the grid in percent; the summary counts", () => {
    const cells = overlayCells(grid);
    expect(cells).toHaveLength(9);
    expect(cells[4]).toMatchObject({ index: 4, left: expect.closeTo(33.33, 1), top: expect.closeTo(33.33, 1) });
    let taps = toggleCellTap([], cellCentre(0, grid), grid);
    taps = toggleCellTap(taps, cellCentre(1, grid), grid);
    taps = toggleCellTap(taps, cellCentre(2, grid), grid);
    expect(tileSummary(taps, grid)).toBe("3 tiles tapped / 6 not tapped");
  });
});

describe("dots", () => {
  test("added in order, removed by index", () => {
    const taps = addTap(addTap([], { nx: 0.1, ny: 0.1 }), { nx: 0.2, ny: 0.2 });
    expect(removeTap(taps, 0)).toEqual([{ nx: 0.2, ny: 0.2 }]);
  });
});

describe("parseCaptchaManifest", () => {
  const key = "/jobs/j-1/files/captcha/001/captcha.json";
  test("resolves the image beside the manifest; refuses a path", () => {
    expect(parseCaptchaManifest({ image: "crop.png", instruction: "Pick buses", site: "a.com", mode: "tap", round: 2, grid: { rows: 3, cols: 3 }, state: "waiting" }, key)).toEqual({
      imageKey: "/jobs/j-1/files/captcha/001/crop.png",
      instruction: "Pick buses",
      site: "a.com",
      mode: "tap",
      round: 2,
      grid: { rows: 3, cols: 3 },
      state: "waiting",
    });
    expect(parseCaptchaManifest({ image: "../../secret.png" }, key)).toEqual({});
    expect(parseCaptchaManifest([], key)).toBeNull();
  });
});

describe("time left", () => {
  test("msLeft and clockOf", () => {
    expect(msLeft(undefined, 0)).toBeNull();
    expect(msLeft("nope", 0)).toBeNull();
    expect(msLeft("1970-01-01T00:01:00Z", 0)).toBe(60_000);
    expect(clockOf(61_000)).toBe("1:01");
    expect(clockOf(-5)).toBe("0:00");
  });
});
