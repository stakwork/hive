import { describe, expect, it } from "vitest";
import { canonicalRepoKey } from "@/lib/utils/error-fingerprint";
import { sameCanonicalRepo } from "@/lib/protect/scope";

describe("sameCanonicalRepo", () => {
  it("treats HTTPS, SSH, and trailing .git as the same repo", () => {
    expect(
      sameCanonicalRepo(
        "https://github.com/acme/hive",
        "git@github.com:acme/hive.git",
      ),
    ).toBe(true);
    expect(
      sameCanonicalRepo(
        "https://github.com/acme/hive.git",
        "https://github.com/acme/hive",
      ),
    ).toBe(true);
    expect(canonicalRepoKey("git@github.com:acme/hive.git")).toBe("acme/hive");
  });

  it("does not match different repositories", () => {
    expect(
      sameCanonicalRepo("https://github.com/acme/hive", "https://github.com/acme/other"),
    ).toBe(false);
  });
});
