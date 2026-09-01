import { describe, test, expect } from "vitest";
import { formatBytes } from "@/lib/utils/format";

describe("formatBytes", () => {
  test("renders 0 explicitly (a genuine zero, not an unknown)", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  test("renders byte and binary-unit magnitudes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(1048576)).toBe("1 MB");
    expect(formatBytes(536870912)).toBe("512 MB");
    expect(formatBytes(1073741824)).toBe("1 GB");
    expect(formatBytes(64424509440)).toBe("60 GB");
    expect(formatBytes(1099511627776)).toBe("1 TB");
  });

  test("caps at the largest unit instead of overflowing the sizes array", () => {
    expect(formatBytes(1024 ** 6)).toBe("1024 PB");
    expect(formatBytes(1024 ** 7)).toBe("1048576 PB");
  });

  test("unknown values render as 'unknown', never as a fabricated 0", () => {
    expect(formatBytes(null)).toBe("unknown");
    expect(formatBytes(undefined)).toBe("unknown");
    expect(formatBytes(-1)).toBe("unknown");
    expect(formatBytes(Number.NaN)).toBe("unknown");
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("unknown");
  });
});
